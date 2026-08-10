import type { KnowledgeNote, KnowledgeKeyword } from "../components/types";
import type {
  KeywordExtractionOptions,
  KeywordExtractionResult,
} from "./keywordExtraction";

export type LocalKeywordModelStatus = "unavailable" | "available" | "error";

export interface LocalKeywordModelStatusResult {
  id: string;
  version: string;
  available: boolean;
  status: LocalKeywordModelStatus;
}

export interface LocalKeywordModelAdapter {
  readonly id: string;
  readonly version: string;
  readonly isAvailable: boolean | (() => boolean | Promise<boolean>);
  extract(
    note: Pick<
      KnowledgeNote,
      "title" | "content" | "headings" | "tags" | "aliases"
    >,
    options?: KeywordExtractionOptions,
  ):
    | KeywordExtractionResult
    | Promise<KeywordExtractionResult | KnowledgeKeyword[]>;
}

const unavailableAdapter: LocalKeywordModelAdapter = {
  id: "unavailable",
  version: "0",
  isAvailable: false,
  extract() {
    throw new Error("本地关键词模型不可用。");
  },
};

let registeredAdapter: LocalKeywordModelAdapter = unavailableAdapter;

export const registerLocalKeywordModelAdapter = (
  adapter: LocalKeywordModelAdapter | null | undefined,
): void => {
  registeredAdapter = adapter ?? unavailableAdapter;
};

export const getLocalKeywordModelAdapter = (): LocalKeywordModelAdapter =>
  registeredAdapter;

export const getLocalKeywordModelStatus =
  async (): Promise<LocalKeywordModelStatusResult> => {
    const adapter = getLocalKeywordModelAdapter();
    try {
      const available =
        typeof adapter.isAvailable === "function"
          ? await adapter.isAvailable()
          : adapter.isAvailable;
      return {
        id: adapter.id,
        version: adapter.version,
        available,
        status: available ? "available" : "unavailable",
      };
    } catch {
      return {
        id: adapter.id,
        version: adapter.version,
        available: false,
        status: "error",
      };
    }
  };
