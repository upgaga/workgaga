import { describe, expect, it, vi } from "vitest";
import type { KnowledgeNote } from "../src/components/types";
import { extractKeywordsWithConfiguredMode } from "../src/utils/keywordExtractionOrchestrator";
import {
  extractMarkdownMetadata,
  buildKnowledgeGraph,
} from "../src/utils/knowledgeGraph";
import { retrieveAIKnowledgeSnippets } from "../src/utils/aiKnowledgeRetrieval";
import { llmFetch } from "../src/utils/llmHttpClient";

vi.mock("../src/utils/llmHttpClient", () => ({
  llmFetch: vi.fn(),
}));

const mockedLLMFetch = vi.mocked(llmFetch);
const channel = {
  provider: "openai" as const,
  baseUrl: "https://example.test",
  model: "acceptance-model",
  apiKey: "test-key",
};

const note = (
  content: string,
  keywords?: KnowledgeNote["keywords"],
  relativePath = "search-guide.md",
  title = "Search Guide",
): KnowledgeNote => ({
  id: relativePath,
  path: `/vault/${relativePath}`,
  relativePath,
  title,
  content,
  ...(keywords ? { keywords } : {}),
});

describe("keyword acceptance flow", () => {
  it("parses Markdown keywords, classifies algorithm candidates, builds mentions, and retrieves active keywords", async () => {
    const content = [
      "---",
      'keywords: [API, "知识图谱"]',
      "---",
      "# 本地搜索",
      "",
      "本地搜索使用 API 构建知识图谱。",
    ].join("\n");
    const metadata = extractMarkdownMetadata(content, "search-guide.md");
    const extraction = await extractKeywordsWithConfiguredMode({
      note: {
        title: "Search Guide",
        content,
        headings: metadata.headings,
        tags: metadata.tags,
        aliases: metadata.aliases,
      },
      mode: "algorithm",
      options: { topN: 8 },
    });

    expect(metadata.keywords.map((keyword) => keyword.normalized)).toEqual([
      "api",
      "知识图谱",
    ]);
    expect(extraction.keywords.length).toBeGreaterThan(0);
    expect(extraction.algorithm).toBe("local");

    const activeKeywords = metadata.keywords.map((keyword) => ({
      ...keyword,
      status: "active" as const,
      confidence: 1,
      evidence: ["frontmatter:keywords"],
    }));
    const candidateKeywords = extraction.keywords
      .filter(
        (keyword) =>
          !activeKeywords.some(
            (active) => active.normalized === keyword.normalized,
          ),
      )
      .slice(0, 2)
      .map((keyword) => ({ ...keyword, status: "candidate" as const }));
    const indexedNote = note(content, [
      ...activeKeywords,
      ...candidateKeywords,
    ]);
    const graph = buildKnowledgeGraph([indexedNote]);

    expect(indexedNote.keywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ normalized: "api", status: "active" }),
        expect.objectContaining({ normalized: "知识图谱", status: "active" }),
      ]),
    );
    expect(candidateKeywords.length).toBeGreaterThan(0);
    expect(graph.nodes.filter((node) => node.category === "keyword")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "keyword:api" }),
        expect.objectContaining({ id: "keyword:知识图谱" }),
      ]),
    );
    expect(
      graph.nodes.some((node) =>
        candidateKeywords.some(
          (keyword) => node.id === `keyword:${keyword.normalized}`,
        ),
      ),
    ).toBe(false);
    expect(graph.links.filter((link) => link.type === "mentions")).toHaveLength(
      activeKeywords.length,
    );

    expect(
      retrieveAIKnowledgeSnippets("api", [indexedNote], { maxSnippets: 1 }),
    ).toEqual([
      expect.objectContaining({
        path: "search-guide.md",
        title: "Search Guide",
      }),
    ]);
  });

  it("falls back to algorithm on LLM failure and excludes ignored keywords from graph and retrieval", async () => {
    mockedLLMFetch.mockRejectedValueOnce(new Error("LLM unavailable"));
    const content = "# Observability\n\n本文记录 observability 的实践。";
    const metadata = extractMarkdownMetadata(content, "observability.md");
    const extraction = await extractKeywordsWithConfiguredMode({
      note: {
        title: "Observability",
        content,
        headings: metadata.headings,
        tags: metadata.tags,
        aliases: metadata.aliases,
      },
      mode: "llm",
      channel,
      options: { topN: 5 },
    });

    expect(extraction.degraded).toBe(true);
    expect(extraction.fallback).toBe(true);
    expect(extraction.algorithm).toBe("local");
    expect(extraction.error).toContain("LLM unavailable");

    const indexedNote = note(
      content,
      [
        {
          text: "observability",
          normalized: "observability",
          status: "active",
        },
        {
          text: "algorithm-candidate",
          normalized: "algorithm-candidate",
          status: "candidate",
        },
        { text: "secret-term", normalized: "secret-term", status: "ignored" },
      ],
      "observability.md",
      "Observability",
    );
    const graph = buildKnowledgeGraph([indexedNote]);

    expect(graph.nodes.map((node) => node.id)).toContain(
      "keyword:observability",
    );
    expect(graph.nodes.map((node) => node.id)).not.toEqual(
      expect.arrayContaining([
        "keyword:algorithm-candidate",
        "keyword:secret-term",
      ]),
    );
    expect(graph.links.filter((link) => link.type === "mentions")).toEqual([
      expect.objectContaining({ target: "keyword:observability" }),
    ]);
    expect(retrieveAIKnowledgeSnippets("secret-term", [indexedNote])).toEqual(
      [],
    );
    expect(
      retrieveAIKnowledgeSnippets("algorithm-candidate", [indexedNote]),
    ).toEqual([]);
    expect(retrieveAIKnowledgeSnippets("observability", [indexedNote])).toEqual(
      [expect.objectContaining({ path: "observability.md" })],
    );
  });
});
