import { describe, expect, it } from "vitest";
import {
  extractKeywords,
  extractKeywordsWithFrontmatter,
  mergeKeywordExtractionResults,
  normalizeKeyword,
  parseFrontmatterKeywords,
  writeFrontmatterKeywords,
  parseFrontmatterTags,
  writeFrontmatterTags,
} from "../src/utils/keywordExtraction";

describe("keyword extraction", () => {
  it("normalizes keyword spelling and punctuation", () => {
    expect(normalizeKeyword("  ＡＰＩ！  ")).toBe("api");
    expect(normalizeKeyword("  中文  术语 ")).toBe("中文 术语");
  });

  it("parses simple arrays and weighted frontmatter objects", () => {
    expect(
      parseFrontmatterKeywords("---\nkeywords: [API, '本地搜索']\n---\ntext"),
    ).toEqual([
      { text: "API", normalized: "api", source: "frontmatter" },
      { text: "本地搜索", normalized: "本地搜索", source: "frontmatter" },
    ]);
    expect(
      parseFrontmatterKeywords("---\nkeywords: {API: 2, search: 1}\n---\ntext"),
    ).toEqual([
      { text: "API", normalized: "api", score: 2, source: "frontmatter" },
      { text: "search", normalized: "search", score: 1, source: "frontmatter" },
    ]);
  });

  it("writes keywords into existing or new frontmatter", () => {
    const existing = writeFrontmatterKeywords("---\ntitle: Demo\n---\nBody", [
      "API",
      "本地搜索",
    ]);
    expect(existing).toContain('keywords: ["API", "本地搜索"]');
    expect(writeFrontmatterKeywords("Body", [{ text: "API" }])).toBe(
      '---\nkeywords: ["API"]\n---\nBody',
    );
  });

  it("round-trips hierarchical keywords and replaces YAML block lists", () => {
    const content = [
      "---",
      "keywords:",
      "  - name: 知识图谱",
      "  - name: 节点",
      "    parent: 知识图谱",
      "title: Demo",
      "---",
      "Body",
    ].join("\n");
    expect(parseFrontmatterKeywords(content)).toEqual([
      {
        text: "知识图谱",
        normalized: "知识图谱",
        source: "frontmatter",
      },
      {
        text: "节点",
        normalized: "节点",
        parent: "知识图谱",
        parentNormalized: "知识图谱",
        source: "frontmatter",
      },
    ]);
    const written = writeFrontmatterKeywords(content, [
      { text: "知识图谱" },
      { text: "节点", parent: "知识图谱" },
    ]);
    expect(written).toContain(
      'keywords: ["知识图谱", { name: "节点", parent: "知识图谱" }]',
    );
    expect(written).not.toContain("  - name:");
    expect(parseFrontmatterKeywords(written)[1]).toMatchObject({
      text: "节点",
      parent: "知识图谱",
    });
  });

  it("preserves BOM and CRLF when writing hierarchical keywords", () => {
    const content = "\uFEFF---\r\ntitle: Demo\r\n---\r\nBody";
    const written = writeFrontmatterKeywords(content, [
      { text: "父级" },
      { text: "子级", parent: "父级" },
    ]);
    expect(written.startsWith("\uFEFF---\r\n")).toBe(true);
    expect(parseFrontmatterKeywords(written)).toHaveLength(2);
  });

  it("parses and writes normalized frontmatter tags", () => {
    expect(parseFrontmatterTags("---\ntags: [#one, 'two, three']\n---\nBody")).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(parseFrontmatterTags("---\ntag: single\n---\nBody")).toEqual(["single"]);
    expect(parseFrontmatterTags("Body")).toEqual([]);
    expect(writeFrontmatterTags("---\ntitle: Demo\n---\nBody", ["#one", " one ", "two"])).toBe(
      '---\ntitle: Demo\ntags: ["one", "two"]\n---\nBody',
    );
    expect(writeFrontmatterTags("Body", ["#one"])).toBe(
      '---\ntags: ["one"]\n---\nBody',
    );
  });

  it("extracts weighted English and Chinese terms locally", () => {
    const result = extractKeywords(
      {
        title: "Local Search",
        content: "Local search uses API. Search is fast.",
        headings: [{ id: "h", text: "Local Search", level: 1 }],
        tags: ["search"],
        aliases: [],
      },
      { topN: 3 },
    );
    expect(result.algorithm).toBe("local");
    expect(result.extractor).toBe("algorithm");
    expect(result.durationMs).toEqual(expect.any(Number));
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.keywords[0].normalized).toBe("search");
    expect(result.keywords).toHaveLength(3);
    expect(
      result.keywords.some((keyword) => keyword.normalized === "the"),
    ).toBe(false);
  });

  it("merges model and algorithm keywords while preserving evidence and priority", () => {
    const result = mergeKeywordExtractionResults(
      {
        keywords: [{ text: "API", normalized: "api", score: 0.8, confidence: 0.8, evidence: ["model evidence"], modelId: "m", modelVersion: "1" }],
        algorithm: "local",
        topN: 10,
        durationMs: 3,
      },
      {
        keywords: [
          { text: "API", normalized: "api", score: 2, source: "title", evidence: ["title evidence"] },
          { text: "算法词", normalized: "算法词", score: 1, source: "heading" },
        ],
        algorithm: "local",
        topN: 10,
        durationMs: 4,
      },
      { topN: 2 },
    );
    expect(result.algorithm).toBe("combined");
    expect(result.extractor).toBe("local-ai+algorithm");
    expect(result.durationMs).toBe(7);
    expect(result.keywords).toHaveLength(2);
    expect(result.keywords[0]).toMatchObject({ text: "API", source: "title", modelId: "m" });
    expect(result.keywords[0].evidence).toEqual(["model evidence", "title evidence"]);
  });

  it("identifies keywords in a 10,000-character document within the test budget", () => {
    const paragraph =
      "本地搜索使用关键词提取算法处理 Markdown 文档，性能测试验证搜索索引和知识图谱。Local search improves document discovery. ";
    const content = paragraph
      .repeat(Math.ceil(10000 / paragraph.length))
      .slice(0, 10000);
    const startedAt = performance.now();
    const result = extractKeywords(
      {
        title: "本地搜索性能测试",
        content,
        headings: [{ id: "performance", text: "关键词提取性能", level: 1 }],
        tags: ["性能测试"],
        aliases: [],
      },
      { topN: 10 },
    );
    const durationMs = performance.now() - startedAt;
    console.info(
      `10,000-character keyword extraction: ${durationMs.toFixed(2)}ms`,
    );

    expect(result.algorithm).toBe("local");
    expect(result.keywords).toHaveLength(10);
    expect(
      result.keywords.some((keyword) => keyword.normalized === "本地搜索"),
    ).toBe(true);
    expect(
      result.keywords.some((keyword) => keyword.normalized === "性能测试"),
    ).toBe(true);
    expect(durationMs).toBeLessThan(5000);
  }, 10000);

  it("combines frontmatter keywords with local results and respects topN", () => {
    const result = extractKeywordsWithFrontmatter(
      {
        title: "Search",
        content: "---\nkeywords: [重要主题]\n---\nSearch content",
        headings: [],
        tags: [],
        aliases: [],
      },
      { topN: 2 },
    );
    expect(result.algorithm).toBe("combined");
    expect(result.keywords.map((keyword) => keyword.normalized)).toEqual([
      "重要主题",
      "search",
    ]);
  });
});
