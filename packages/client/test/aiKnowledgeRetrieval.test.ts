import { describe, expect, it } from "vitest";
import type {
  KnowledgeGraphData,
  KnowledgeNote,
} from "../src/components/types";
import { retrieveAIKnowledgeSnippets } from "../src/utils/aiKnowledgeRetrieval";

const note = (id: string, title: string, content: string): KnowledgeNote => ({
  id,
  path: `/vault/${id}`,
  relativePath: id,
  title,
  content,
});

const graph = (notes: KnowledgeNote[]): KnowledgeGraphData => ({
  nodes: notes.map((item) => ({
    id: item.id,
    name: item.title,
    path: item.path,
    relativePath: item.relativePath,
    exists: true,
    category: "note",
  })),
  links: [
    {
      source: "guide.md",
      target: "related.md",
      type: "wiki",
      raw: "[[related]]",
    },
  ],
  notes,
  indexedAt: 1,
});

describe("AI knowledge retrieval", () => {
  it("uses graph neighbors as a secondary boost", () => {
    const notes = [
      note("guide.md", "Guide", "release process"),
      note("related.md", "Related", "context"),
      note("other.md", "Other", "release process release"),
    ];
    const withoutGraph = retrieveAIKnowledgeSnippets("release process", notes, {
      maxSnippets: 2,
    });
    const withGraph = retrieveAIKnowledgeSnippets("release process", notes, {
      maxSnippets: 2,
      graphData: graph(notes),
      includeGraphNeighbors: true,
      graphNeighborBoost: 2,
    });

    expect(withoutGraph.map((item) => item.path)).not.toEqual(
      withGraph.map((item) => item.path),
    );
    expect(withGraph.map((item) => item.path)).toContain("related.md");
  });

  it("keeps keyword retrieval available without graph data", () => {
    const results = retrieveAIKnowledgeSnippets(
      "release",
      [note("release.md", "Release", "release checklist")],
      { maxSnippets: 1, includeGraphNeighbors: true },
    );
    expect(results).toEqual([
      { title: "Release", path: "release.md", content: "release checklist" },
    ]);
  });

  it("ranks keyword, tag, and alias matches above content-only matches", () => {
    const keywordNote = note("keyword.md", "Keyword", "general context");
    keywordNote.keywords = [{ text: "observability", status: "active" }];
    const tagNote = note("tag.md", "Tag", "general context");
    tagNote.tags = ["observability"];
    const aliasNote = note("alias.md", "Alias", "general context");
    aliasNote.aliases = ["observability"];
    const contentNote = note("content.md", "Content", "observability details");

    expect(
      retrieveAIKnowledgeSnippets("observability", [
        contentNote,
        aliasNote,
        tagNote,
        keywordNote,
      ]).map((item) => item.path),
    ).toEqual(["keyword.md", "tag.md", "alias.md", "content.md"]);
  });

  it("ignores candidate and ignored keywords", () => {
    const candidate = note("candidate.md", "Candidate", "unrelated");
    candidate.keywords = [{ text: "secret-term", status: "candidate" }];
    const ignored = note("ignored.md", "Ignored", "unrelated");
    ignored.keywords = [{ text: "secret-term", status: "ignored" }];

    expect(
      retrieveAIKnowledgeSnippets("secret-term", [candidate, ignored]),
    ).toEqual([]);
  });

  it("starts evidence snippets at a keyword match", () => {
    const item = note(
      "evidence.md",
      "Evidence",
      "背景说明\n无关内容\n这里记录 observability 的关键证据\n后续结论",
    );
    item.keywords = [{ text: "Observability", status: "active" }];

    expect(
      retrieveAIKnowledgeSnippets("observability", [item], {
        maxSnippets: 1,
      })[0]?.content,
    ).toContain("这里记录 observability 的关键证据");
  });
});
