import { describe, expect, it, vi } from "vitest";
import { extractKeywordsWithConfiguredMode } from "../src/utils/keywordExtractionOrchestrator";
import { llmFetch } from "../src/utils/llmHttpClient";
import { registerLocalKeywordModelAdapter } from "../src/utils/localKeywordModel";

vi.mock("../src/utils/llmHttpClient", () => ({
  llmFetch: vi.fn(),
}));

const mockedLLMFetch = vi.mocked(llmFetch);
const note = {
  title: "Local Search",
  content: "Local search uses API.",
  headings: [],
  tags: [],
  aliases: [],
};
const channel = {
  provider: "openai" as const,
  baseUrl: "https://example.test",
  model: "test-model",
  apiKey: "secret",
};

const responseFor = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });

describe("keyword extraction orchestrator", () => {
  it("parses LLM JSON", async () => {
    mockedLLMFetch.mockResolvedValueOnce(
      responseFor('{"keywords":[{"text":"API","score":0.9}]}'),
    );
    const result = await extractKeywordsWithConfiguredMode({
      note,
      mode: "llm",
      channel,
    });
    expect(result.degraded).toBe(false);
    expect(result.keywords[0]).toMatchObject({
      text: "API",
      normalized: "api",
      score: 0.9,
    });
  });

  it("parses fenced JSON", async () => {
    mockedLLMFetch.mockResolvedValueOnce(
      responseFor('```json\n{"keywords":["本地搜索"]}\n```'),
    );
    const result = await extractKeywordsWithConfiguredMode({
      note,
      mode: "llm",
      channel,
    });
    expect(result.keywords[0].normalized).toBe("本地搜索");
  });

  it("falls back to algorithm for invalid response and local-ai", async () => {
    mockedLLMFetch.mockClear();
    mockedLLMFetch.mockResolvedValueOnce(responseFor("not-json"));
    const invalid = await extractKeywordsWithConfiguredMode({
      note,
      mode: "llm",
      channel,
    });
    expect(invalid.degraded).toBe(true);
    expect(invalid.algorithm).toBe("local");
    expect(invalid.error).toContain("Unexpected");

    const localAI = await extractKeywordsWithConfiguredMode({
      note,
      mode: "local-ai",
    });
    expect(localAI.degraded).toBe(true);
    expect(localAI.error).toContain("本地关键词模型不可用");
    expect(mockedLLMFetch).toHaveBeenCalledTimes(1);
  });

  it("degrades to the algorithm when the request is aborted", async () => {
    mockedLLMFetch.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const extraction = extractKeywordsWithConfiguredMode({
      note,
      mode: "llm",
      channel,
      signal: controller.signal,
    });
    controller.abort();
    const result = await extraction;

    expect(result.degraded).toBe(true);
    expect(result.algorithm).toBe("local");
    expect(result.error).toContain("aborted");
  }, 1000);

  it("degrades to the algorithm when the LLM request times out", async () => {
    mockedLLMFetch.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            { once: true },
          );
        }),
    );
    const result = await extractKeywordsWithConfiguredMode({
      note,
      mode: "llm",
      channel,
      timeoutMs: 10,
    });

    expect(result.degraded).toBe(true);
    expect(result.algorithm).toBe("local");
    expect(result.error).toContain("aborted");
  }, 1000);

  it("uses a registered local model adapter", async () => {
    registerLocalKeywordModelAdapter({
      id: "mock-model",
      version: "1.0.0",
      isAvailable: true,
      extract: () => ({
        keywords: [{ text: "Mock", normalized: "mock" }],
        algorithm: "local",
        topN: 1,
      }),
    });
    const result = await extractKeywordsWithConfiguredMode({
      note,
      mode: "local-ai",
    });
    expect(result.degraded).toBe(false);
    expect(result.mode).toBe("local-ai");
    expect(result.keywords[0].text).toBe("Mock");
    registerLocalKeywordModelAdapter();
  });

  it("falls back when the local model adapter is unavailable", async () => {
    registerLocalKeywordModelAdapter({
      id: "missing-model",
      version: "1.0.0",
      isAvailable: false,
      extract: vi.fn(),
    });
    const result = await extractKeywordsWithConfiguredMode({
      note,
      mode: "local-ai",
    });
    expect(result.degraded).toBe(true);
    expect(result.error).toContain("missing-model");
    registerLocalKeywordModelAdapter();
  });

  it("uses algorithm mode without network", async () => {
    mockedLLMFetch.mockClear();
    const result = await extractKeywordsWithConfiguredMode({
      note,
      mode: "algorithm",
    });
    expect(result.algorithm).toBe("local");
    expect(result.degraded).toBe(false);
    expect(result.fallback).toBe(false);
    expect(result.durationMs).toEqual(expect.any(Number));
    expect(result.extractor).toBe("algorithm");
    expect(mockedLLMFetch).not.toHaveBeenCalled();
  });
});
