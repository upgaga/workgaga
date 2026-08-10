import { describe, expect, it, vi } from "vitest";
import {
  onnxLocalKeywordModel,
  resetOnnxLocalKeywordModelForTests,
} from "../src/utils/onnxLocalKeywordModel";

const { mockedPipeline } = vi.hoisted(() => ({ mockedPipeline: vi.fn() }));

vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: mockedPipeline,
}));

describe("ONNX local keyword model adapter", () => {
  it("does not report a real model as available in tests", async () => {
    expect(await onnxLocalKeywordModel.isAvailable!()).toBe(false);
    expect(mockedPipeline).not.toHaveBeenCalled();
  });

  it("chunks long content and applies source offsets", async () => {
    resetOnnxLocalKeywordModelForTests();
    mockedPipeline.mockResolvedValueOnce(async (text: string) => {
      const index = text.indexOf("目标词");
      return index >= 0
        ? [
            {
              entity_group: "ORG",
              word: "目标词",
              score: 0.8,
              start: index,
              end: index + 3,
            },
          ]
        : [];
    });
    const content = "x".repeat(500) + "目标词" + "y".repeat(500);
    const result = await onnxLocalKeywordModel.extract(
      { title: "", content, headings: [], tags: [], aliases: [] },
      { topN: 5 },
    );
    expect(result.keywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "目标词", evidence: ["目标词"] }),
      ]),
    );
  });

  it("aggregates B/I token entities into complete keywords", async () => {
    resetOnnxLocalKeywordModelForTests();
    mockedPipeline.mockResolvedValueOnce(async () => [
      { entity: "B-PER", word: "张", score: 0.9, index: 1 },
      { entity: "I-PER", word: "三", score: 0.8, index: 2 },
      { entity: "B-ORG", word: "北", score: 0.9, index: 3 },
      { entity: "I-ORG", word: "京", score: 0.9, index: 4 },
      { entity: "I-ORG", word: "工", score: 0.8, index: 5 },
      { entity: "I-ORG", word: "作", score: 0.8, index: 6 },
      { entity: "I-ORG", word: "室", score: 0.8, index: 7 },
    ]);

    const result = await onnxLocalKeywordModel.extract(
      {
        title: "",
        content: "张三在北京工作室",
        headings: [],
        tags: [],
        aliases: [],
      },
      { topN: 20 },
    );

    const localKeywords = result.keywords.filter(
      (keyword) => keyword.modelId === "bert-mini-finetuned-ner-chinese-onnx",
    );
    expect(localKeywords.map((keyword) => keyword.text)).toEqual(
      expect.arrayContaining(["张三", "北京工作室"]),
    );
    expect(localKeywords.map((keyword) => keyword.text)).not.toEqual(
      expect.arrayContaining(["张", "三", "北", "京"]),
    );
  });

  it("converts mocked NER entities to deduplicated keywords", async () => {
    resetOnnxLocalKeywordModelForTests();
    mockedPipeline.mockResolvedValueOnce(async () => [
      { entity_group: "PER", word: "张三", score: 0.95, start: 0, end: 2 },
      { entity_group: "ORG", word: "工作室", score: 0.8, start: 4, end: 7 },
      { entity_group: "O", word: "无关", score: 0.99, start: 8, end: 10 },
      { entity_group: "PER", word: "张三", score: 0.7, start: 0, end: 2 },
    ]);

    const result = await onnxLocalKeywordModel.extract(
      {
        title: "",
        content: "张三在工作室",
        headings: [],
        tags: [],
        aliases: [],
      },
      { topN: 2 },
    );

    expect(result.keywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "张三",
          score: expect.any(Number),
          confidence: expect.any(Number),
          source: "content",
          modelId: "bert-mini-finetuned-ner-chinese-onnx",
          modelVersion: "1.0.0",
        }),
        expect.objectContaining({ text: "工作室", score: expect.any(Number) }),
      ]),
    );
    expect(result.keywords).toHaveLength(2);
  });
});
