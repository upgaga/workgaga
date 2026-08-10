import type { KnowledgeNote } from "../components/types";
import {
  extractKeywords,
  mergeKeywordExtractionResults,
  type KeywordExtractionOptions,
  type KeywordExtractionResult,
} from "./keywordExtraction";
import type { LocalKeywordModelAdapter } from "./localKeywordModel";

export const LOCAL_KEYWORD_MODEL_ID = "bert-mini-finetuned-ner-chinese-onnx";
export const LOCAL_KEYWORD_MODEL_VERSION = "1.0.0";
export const LOCAL_KEYWORD_MODEL_PATH = `/models/keyword/${LOCAL_KEYWORD_MODEL_ID}`;

const ENTITY_TYPES = new Set(["PER", "ORG", "LOC", "MISC"]);

type PipelineEntity = {
  entity?: string;
  entity_group?: string;
  word?: string;
  score?: number;
  start?: number;
  end?: number;
  index?: number;
};

type TokenClassificationPipeline = (
  text: string,
  options?: {
    grouped_entities?: boolean;
    truncation?: boolean;
    max_length?: number;
  },
) => Promise<PipelineEntity[]>;

const CHUNK_SIZE = 480;
const CHUNK_OVERLAP = 40;
const MAX_ENTITIES = 1000;
const MAX_MODEL_TOKENS = 512;

let pipelinePromise: Promise<TokenClassificationPipeline> | undefined;

const loadPipeline = async (): Promise<TokenClassificationPipeline> => {
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers").then(
      async ({ pipeline, env }) => {
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        return (await pipeline(
          "token-classification",
          LOCAL_KEYWORD_MODEL_PATH,
          {
            local_files_only: true,
            device: "cpu",
            subfolder: "onnx",
            model_file_name: "model_quantized",
          },
        )) as unknown as TokenClassificationPipeline;
      },
    );
  }
  return pipelinePromise;
};

const modelFileUrl = (file: string): string =>
  `${LOCAL_KEYWORD_MODEL_PATH}/${file}`;

const canFetchModelFiles = async (): Promise<boolean> => {
  if (typeof window === "undefined") return false;
  try {
    const responses = await Promise.all(
      ["config.json", "tokenizer.json", "onnx/model_quantized.onnx"].map(
        (file) => fetch(modelFileUrl(file), { method: "HEAD" }),
      ),
    );
    return responses.every((response) => response.ok);
  } catch {
    return false;
  }
};

const normalize = (value: string): string =>
  value.normalize("NFKC").trim().toLocaleLowerCase();

const cleanEntityText = (value: string): string =>
  value
    .replace(/##/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim();

const extractEntityType = (entity: PipelineEntity): string | undefined => {
  const label = entity.entity_group || entity.entity || "";
  const type = label.replace(/^B-|^I-/, "").toUpperCase();
  return ENTITY_TYPES.has(type) ? type : undefined;
};

const getEntityLabel = (
  entity: PipelineEntity,
): { prefix?: string; type?: string } => {
  const label = entity.entity || entity.entity_group || "";
  const match = label.match(/^(B|I)-(.+)$/i);
  return {
    prefix: match?.[1]?.toUpperCase(),
    type: extractEntityType(entity),
  };
};

const aggregateChunkEntities = (
  chunk: string,
  chunkEntities: PipelineEntity[],
): PipelineEntity[] => {
  const aggregated: PipelineEntity[] = [];
  for (const entity of chunkEntities) {
    const { prefix, type } = getEntityLabel(entity);
    const previous = aggregated[aggregated.length - 1];
    const previousLabel = previous ? getEntityLabel(previous) : {};
    const canContinue =
      prefix === "I" &&
      previousLabel.prefix &&
      previousLabel.type === type &&
      previous?.index !== undefined &&
      entity.index !== undefined &&
      entity.index === previous.index + 1;

    if (!canContinue || prefix !== "I") {
      const word = cleanEntityText(entity.word || "");
      const start = prefix && word ? chunk.indexOf(word) : -1;
      aggregated.push({
        ...entity,
        ...(prefix ? { entity_group: type } : {}),
        ...(prefix && entity.start === undefined
          ? {
              start: start >= 0 ? start : undefined,
              end: start >= 0 ? start + word.length : undefined,
            }
          : {}),
      });
      continue;
    }

    const word = cleanEntityText(`${previous.word || ""}${entity.word || ""}`);
    const scoreValues = [previous.score, entity.score].filter(
      (score): score is number => typeof score === "number",
    );
    const start = chunk.indexOf(word);
    aggregated[aggregated.length - 1] = {
      ...previous,
      word,
      score: scoreValues.length
        ? scoreValues.reduce((sum, score) => sum + score, 0) /
          scoreValues.length
        : undefined,
      start: start >= 0 ? start : undefined,
      end: start >= 0 ? start + word.length : undefined,
      index: entity.index,
    };
  }
  return aggregated;
};

export const onnxLocalKeywordModel: LocalKeywordModelAdapter = {
  id: LOCAL_KEYWORD_MODEL_ID,
  version: LOCAL_KEYWORD_MODEL_VERSION,
  isAvailable: async () => {
    if (!(await canFetchModelFiles())) return false;
    try {
      await loadPipeline();
      return true;
    } catch {
      return false;
    }
  },
  extract: async (
    note: Pick<
      KnowledgeNote,
      "title" | "content" | "headings" | "tags" | "aliases"
    >,
    options: KeywordExtractionOptions = {},
  ): Promise<KeywordExtractionResult> => {
    const startedAt = performance.now();
    const extractor = await loadPipeline();
    const entities: Array<PipelineEntity & { offset: number }> = [];
    for (
      let offset = 0;
      offset < note.content.length;
      offset += Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP)
    ) {
      const chunk = note.content.slice(offset, offset + CHUNK_SIZE);
      const chunkEntities = await extractor(chunk, {
        grouped_entities: true,
        truncation: true,
        max_length: MAX_MODEL_TOKENS,
      });
      entities.push(
        ...aggregateChunkEntities(chunk, chunkEntities).map((entity) => ({
          ...entity,
          offset,
          ...(entity.start !== undefined
            ? { start: entity.start + offset }
            : {}),
          ...(entity.end !== undefined ? { end: entity.end + offset } : {}),
        })),
      );
      if (entities.length >= MAX_ENTITIES) break;
    }
    const localResult: KeywordExtractionResult = {
      keywords: entities
        .slice(0, MAX_ENTITIES)
        .filter((entity) => extractEntityType(entity))
        .map((entity) => {
          const text = cleanEntityText(entity.word || "");
          const normalized = normalize(text);
          const score = typeof entity.score === "number" ? entity.score : 0;
          return {
            text,
            normalized,
            score,
            confidence: score,
            evidence: [
              note.content.slice(entity.start ?? 0, entity.end ?? 0) || text,
            ],
            modelId: LOCAL_KEYWORD_MODEL_ID,
            modelVersion: LOCAL_KEYWORD_MODEL_VERSION,
            source: "content" as const,
          };
        })
        .filter(
          (keyword, index, all) =>
            keyword.normalized &&
            all.findIndex((item) => item.normalized === keyword.normalized) ===
              index,
        ),
      algorithm: "local",
      topN: Math.max(0, options.topN ?? 20),
      durationMs: Math.max(0, performance.now() - startedAt),
      extractor: "local-ai",
      modelId: LOCAL_KEYWORD_MODEL_ID,
      modelVersion: LOCAL_KEYWORD_MODEL_VERSION,
    };
    const algorithmResult = extractKeywords(note, options);
    return mergeKeywordExtractionResults(localResult, algorithmResult, options);
  },
};

export const resetOnnxLocalKeywordModelForTests = (): void => {
  pipelinePromise = undefined;
};
