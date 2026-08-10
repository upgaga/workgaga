import type { KnowledgeKeyword, KnowledgeNote } from "../components/types";
import {
  extractKeywords,
  type KeywordExtractionOptions,
  type KeywordExtractionResult,
} from "./keywordExtraction";
import { llmFetch } from "./llmHttpClient";
import {
  buildLLMRequestSpec,
  createDetailedLLMStatusError,
  extractProviderReply,
  getLLMStatusFallbackMessage,
} from "./aiRuntime/llmRequest";
import type { AIModelProvider } from "./aiRuntime/llmTypes";
import { getLocalKeywordModelAdapter } from "./localKeywordModel";

export type KeywordExtractionMode =
  | "algorithm"
  | "local-ai"
  | "llm"
  | "fallback";

export interface KeywordExtractionChannel {
  provider: AIModelProvider;
  baseUrl?: string;
  model: string;
  apiKey: string;
}

export interface KeywordExtractionOrchestratorInput {
  note: Pick<
    KnowledgeNote,
    "title" | "content" | "headings" | "tags" | "aliases"
  >;
  mode: KeywordExtractionMode;
  options?: KeywordExtractionOptions;
  channel?: KeywordExtractionChannel;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface KeywordExtractionOrchestratorResult extends KeywordExtractionResult {
  mode: KeywordExtractionMode;
  degraded: boolean;
  fallback?: boolean;
  error?: string;
}

const fallbackResult = (
  note: KeywordExtractionOrchestratorInput["note"],
  options: KeywordExtractionOptions | undefined,
  mode: KeywordExtractionMode,
  startedAt: number,
  error?: unknown,
): KeywordExtractionOrchestratorResult => ({
  ...extractKeywords(note, options),
  mode,
  degraded: true,
  fallback: true,
  durationMs: Math.max(0, performance.now() - startedAt),
  extractor: "algorithm",
  ...(error
    ? { error: error instanceof Error ? error.message : String(error) }
    : {}),
});

const parseKeywordResponse = (
  reply: string,
  topN: number,
): KnowledgeKeyword[] => {
  const fenced =
    reply.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] || reply.trim();
  const parsed: unknown = JSON.parse(fenced);
  const values = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { keywords?: unknown }).keywords)
      ? (parsed as { keywords: unknown[] }).keywords
      : null;
  if (!values) throw new Error("模型返回的关键词不是数组。\n");
  const seen = new Set<string>();
  const keywords = values.flatMap((item): KnowledgeKeyword[] => {
    const value =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? (item as { text?: unknown }).text
          : null;
    if (typeof value !== "string" || !value.trim()) return [];
    const text = value.trim();
    const normalized = text.normalize("NFKC").toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    const record =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const status =
      record.status === "active" ||
      record.status === "candidate" ||
      record.status === "ignored"
        ? record.status
        : undefined;
    const metadata: Partial<KnowledgeKeyword> = {
      ...(typeof record.score === "number" ? { score: record.score } : {}),
      ...(status ? { status } : {}),
      ...(typeof record.confidence === "number"
        ? { confidence: record.confidence }
        : {}),
      ...(Array.isArray(record.evidence) &&
      record.evidence.every((value) => typeof value === "string")
        ? { evidence: record.evidence as string[] }
        : {}),
      ...(typeof record.modelId === "string"
        ? { modelId: record.modelId }
        : {}),
      ...(typeof record.modelVersion === "string"
        ? { modelVersion: record.modelVersion }
        : {}),
    };
    return [{ text, normalized, ...metadata }];
  });
  if (!keywords.length) throw new Error("模型未返回有效关键词。");
  return keywords.slice(0, Math.max(0, topN));
};

const runLLM = async (
  input: KeywordExtractionOrchestratorInput,
): Promise<KeywordExtractionResult> => {
  if (!input.channel?.apiKey || !input.channel.model)
    throw new Error("LLM 关键词识别未配置渠道、模型或 API Key。");
  const topN = Math.max(1, input.options?.topN ?? 20);
  const note = input.note;
  const prompt = [
    "请从下面的 Markdown 笔记中提取最重要的关键词。",
    `只返回 JSON，不要解释，格式为 {\"keywords\":[{\"text\":\"关键词\",\"score\":0.9}]}，最多 ${topN} 个。`,
    JSON.stringify({
      title: note.title,
      headings: note.headings,
      tags: note.tags,
      aliases: note.aliases,
      content: note.content,
    }),
  ].join("\n");
  const spec = buildLLMRequestSpec({
    provider: input.channel.provider,
    baseUrl: input.channel.baseUrl,
    apiKey: input.channel.apiKey,
    model: input.channel.model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: Math.max(256, topN * 40),
  });
  const response = await llmFetch(spec.targetUrl, {
    method: "POST",
    headers: spec.headers,
    body: JSON.stringify(spec.body),
    signal: input.signal,
  });
  if (!response.ok)
    throw await createDetailedLLMStatusError(
      response,
      spec.targetUrl,
      getLLMStatusFallbackMessage(response.status),
    );
  const reply = extractProviderReply(
    input.channel.provider,
    await response.json(),
  );
  const keywords = parseKeywordResponse(reply, topN);
  return {
    keywords,
    algorithm: "local",
    topN,
    extractor: "llm",
    modelId: input.channel.model,
  };
};

export const extractKeywordsWithConfiguredMode = async (
  input: KeywordExtractionOrchestratorInput,
): Promise<KeywordExtractionOrchestratorResult> => {
  const startedAt = performance.now();
  if (input.mode === "algorithm" || input.mode === "fallback") {
    return {
      ...extractKeywords(input.note, input.options),
      mode: input.mode,
      degraded: input.mode === "fallback",
      fallback: input.mode === "fallback",
      extractor: "algorithm",
      durationMs: Math.max(0, performance.now() - startedAt),
    };
  }
  if (input.mode === "local-ai") {
    const adapter = getLocalKeywordModelAdapter();
    try {
      const available =
        typeof adapter.isAvailable === "function"
          ? await adapter.isAvailable()
          : adapter.isAvailable;
      if (!available)
        throw new Error(
          `本地关键词模型不可用：${adapter.id}@${adapter.version}`,
        );
      const extracted = await adapter.extract(input.note, input.options);
      const result = Array.isArray(extracted)
        ? {
            keywords: extracted,
            algorithm: "local" as const,
            topN: Math.max(0, input.options?.topN ?? 20),
          }
        : extracted;
      return {
        ...result,
        mode: "local-ai",
        degraded: false,
        fallback: false,
        extractor: "local-ai",
        modelId: adapter.id,
        modelVersion: adapter.version,
        durationMs: Math.max(0, performance.now() - startedAt),
      };
    } catch (error) {
      return fallbackResult(
        input.note,
        input.options,
        "local-ai",
        startedAt,
        error,
      );
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 30000,
  );
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await runLLM({ ...input, signal: controller.signal });
    return { ...result, mode: "llm", degraded: false };
  } catch (error) {
    return fallbackResult(input.note, input.options, "llm", startedAt, error);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }
};
