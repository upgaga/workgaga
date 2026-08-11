import { describe, expect, it, vi } from "vitest";
import type { KnowledgeNote } from "../src/components/types";

const mockFs = vi.hoisted(() => ({
  directories: new Map<
    string,
    Array<{ name: string; isDirectory?: boolean }>
  >(),
  files: new Map<string, { content: string; size: number; mtime: number }>(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(async (path: string) => mockFs.directories.get(path) || []),
  readTextFile: vi.fn(async (path: string) => {
    const file = mockFs.files.get(path);
    if (!file) throw new Error(`Missing mock file: ${path}`);
    return file.content;
  }),
  stat: vi.fn(async (path: string) => {
    const file = mockFs.files.get(path);
    if (!file) throw new Error(`Missing mock file: ${path}`);
    return { size: file.size, mtime: new Date(file.mtime) };
  }),
}));

import {
  buildKnowledgeGraph,
  extractMarkdownMetadata,
  getIncomingKnowledgeGraphLinks,
  getKnowledgeGraphNeighborhood,
  indexKnowledgeVaultIncremental,
  mergeKnowledgeGraphData,
  summarizeKnowledgeFileChanges,
  type KnowledgeFileSnapshot,
} from "../src/utils/knowledgeGraph";

const note = (
  relativePath: string,
  content: string,
  overrides: Partial<KnowledgeNote> = {},
): KnowledgeNote => ({
  id: relativePath,
  path: `/vault/${relativePath}`,
  relativePath,
  title: relativePath.replace(/\.md$/i, ""),
  content,
  ...overrides,
});

const snapshot = (
  relativePath: string,
  size: number,
  mtime: number,
): KnowledgeFileSnapshot => ({
  path: `/vault/${relativePath}`,
  relativePath,
  size,
  mtime,
});

describe("knowledge graph indexing", () => {
  it("merges multiple vault graphs without colliding note ids", () => {
    const graphA = buildKnowledgeGraph([note("index.md", "# A")]);
    const graphB = buildKnowledgeGraph([note("index.md", "# B")]);
    const merged = mergeKnowledgeGraphData([
      { vaultPath: "/vault-a", graph: graphA },
      { vaultPath: "/vault-b", graph: graphB },
    ]);

    expect(merged.notes).toHaveLength(2);
    expect(new Set(merged.nodes.map((node) => node.id)).size).toBe(
      merged.nodes.length,
    );
    expect(
      merged.nodes.filter((node) => node.category === "note"),
    ).toHaveLength(2);
  });
  it("extracts headings, inline tags, frontmatter tags, and aliases", () => {
    expect(
      extractMarkdownMetadata(
        "---\naliases: [Home, Start]\ntags: [guide, setup]\n---\n# Home\n\nText #work",
        "home.md",
      ),
    ).toEqual({
      headings: [{ id: "home.md#heading-1", text: "Home", level: 1 }],
      tags: ["guide", "setup", "work"],
      aliases: ["Home", "Start"],
      keywords: [],
    });
  });

  it("reads frontmatter keywords and adds keyword mention links", () => {
    const metadata = extractMarkdownMetadata(
      '---\nkeywords: [TypeScript, "Knowledge Graph"]\n---\n# Notes',
      "notes.md",
    );
    expect(metadata.keywords).toEqual([
      {
        text: "TypeScript",
        normalized: "typescript",
        source: "frontmatter",
      },
      {
        text: "Knowledge Graph",
        normalized: "knowledge graph",
        source: "frontmatter",
      },
    ]);

    const graph = buildKnowledgeGraph([
      note("a.md", "", { keywords: metadata.keywords }),
      note("b.md", "", {
        keywords: [{ text: "typescript", normalized: "typescript" }],
      }),
    ]);

    expect(graph.nodes.filter((node) => node.category === "keyword")).toEqual([
      expect.objectContaining({ id: "keyword:typescript", name: "TypeScript" }),
      expect.objectContaining({
        id: "keyword:knowledge graph",
        name: "Knowledge Graph",
      }),
    ]);
    expect(graph.links.filter((link) => link.type === "mentions")).toHaveLength(
      3,
    );
    expect(
      graph.nodes.filter((node) => node.id === "keyword:typescript"),
    ).toHaveLength(1);
    expect(
      graph.links.filter((link) => link.type === "related_by_keyword"),
    ).toEqual([
      expect.objectContaining({
        source: "a.md",
        target: "b.md",
        type: "related_by_keyword",
        weight: 1,
        evidence: ["TypeScript"],
      }),
    ]);
  });

  it("preserves keyword metadata on mentions and excludes non-active keywords", () => {
    const graph = buildKnowledgeGraph([
      note("metadata.md", "", {
        keywords: [
          {
            text: "Active",
            normalized: "active",
            score: 0.8,
            confidence: 0.9,
            source: "frontmatter",
            evidence: ["frontmatter:keywords"],
          },
          { text: "Candidate", normalized: "candidate", status: "candidate" },
          { text: "Ignored", normalized: "ignored", status: "ignored" },
        ],
      }),
    ]);

    expect(
      graph.nodes
        .filter((node) => node.category === "keyword")
        .map((node) => node.id),
    ).toEqual(["keyword:active"]);
    expect(graph.links).toContainEqual(
      expect.objectContaining({
        type: "mentions",
        target: "keyword:active",
        weight: 0.8,
        confidence: 0.9,
        sourceKind: "frontmatter",
        evidence: ["frontmatter:keywords"],
      }),
    );
  });

  it("adds heading and tag nodes with semantic links", () => {
    const graph = buildKnowledgeGraph([
      note("home.md", "# Overview\n\n#guide", {
        headings: [{ id: "home.md#heading-1", text: "Overview", level: 1 }],
        tags: ["guide"],
      }),
    ]);

    expect(graph.nodes.map((node) => node.category)).toEqual([
      "note",
      "heading",
      "tag",
    ]);
    expect(graph.links.map((link) => link.type)).toEqual([
      "contains",
      "tagged_with",
    ]);
  });

  it("returns incoming links and a filtered neighborhood", () => {
    const graph = buildKnowledgeGraph([
      note("a.md", "[[b]]"),
      note("b.md", "[[c]]"),
      note("c.md", "# C"),
    ]);

    expect(getIncomingKnowledgeGraphLinks(graph, "b.md")).toHaveLength(1);
    const neighborhood = getKnowledgeGraphNeighborhood(graph, {
      rootId: "b.md",
      depth: 1,
      linkTypes: new Set(["wiki"]),
    });
    expect(neighborhood.nodes.map((node) => node.id).sort()).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
    expect(neighborhood.links).toHaveLength(2);
  });

  it("filters neighborhood nodes by category", () => {
    const graph = buildKnowledgeGraph([
      note("a.md", "# Intro\n\n#guide", {
        headings: [{ id: "a.md#heading-1", text: "Intro", level: 1 }],
        tags: ["guide"],
      }),
    ]);
    const tags = getKnowledgeGraphNeighborhood(graph, {
      categories: new Set(["tag"]),
    });
    expect(tags.nodes.map((node) => node.id)).toEqual(["tag:guide"]);
    expect(tags.links).toHaveLength(0);
  });

  it("handles a 1,000-node neighborhood without changing graph semantics", () => {
    const notes = Array.from({ length: 1000 }, (_, index) =>
      note(`note-${index}.md`, index === 0 ? "[[note-1]]" : ""),
    );
    const graph = buildKnowledgeGraph(notes);
    const startedAt = performance.now();
    const neighborhood = getKnowledgeGraphNeighborhood(graph, {
      rootId: "note-0.md",
      depth: 1,
      linkTypes: new Set(["wiki"]),
    });
    const durationMs = performance.now() - startedAt;

    expect(graph.nodes).toHaveLength(1000);
    expect(durationMs).toBeLessThan(100);
    expect(neighborhood.nodes.map((node) => node.id).sort()).toEqual([
      "note-0.md",
      "note-1.md",
    ]);
  });

  it("builds the same graph after a modified note is re-indexed", () => {
    const previousNotes = [note("a.md", "[[b]]"), note("b.md", "# B")];
    const nextNotes = [
      note("a.md", "[[c]]", { size: 5, mtime: 2 }),
      note("c.md", "# C", { size: 3, mtime: 2 }),
    ];

    const incrementalGraph = buildKnowledgeGraph(nextNotes);
    const fullGraph = buildKnowledgeGraph(nextNotes);

    expect(incrementalGraph.nodes.map((node) => node.id).sort()).toEqual(
      fullGraph.nodes.map((node) => node.id).sort(),
    );
    expect(incrementalGraph.links).toEqual(fullGraph.links);
    expect(previousNotes).toHaveLength(2);
  });

  it("classifies added, modified, unchanged, and deleted files", () => {
    const previous = [
      snapshot("unchanged.md", 10, 1),
      snapshot("modified.md", 10, 1),
      snapshot("deleted.md", 10, 1),
    ];
    const current = [
      snapshot("unchanged.md", 10, 1),
      snapshot("modified.md", 11, 2),
      snapshot("added.md", 4, 2),
    ];

    expect(summarizeKnowledgeFileChanges(current, previous)).toEqual({
      changedFiles: 2,
      unchangedFiles: 1,
      deletedFiles: 1,
    });
  });

  it("indexes unchanged, changed, and deleted files while preserving keyword graph data", async () => {
    const vaultPath = "/mock-vault";
    const previousNotes = [
      note("unchanged.md", "", {
        size: 10,
        mtime: 1,
        keywords: [{ text: "shared", normalized: "shared" }],
      }),
      note("changed.md", "", {
        size: 10,
        mtime: 1,
        keywords: [{ text: "old", normalized: "old" }],
      }),
      note("deleted.md", "", {
        size: 10,
        mtime: 1,
        keywords: [{ text: "deleted", normalized: "deleted" }],
      }),
    ];
    const previousFiles = [
      snapshot("unchanged.md", 10, 1),
      snapshot("changed.md", 10, 1),
      snapshot("deleted.md", 10, 1),
    ];
    mockFs.directories.clear();
    mockFs.files.clear();
    mockFs.directories.set(vaultPath, [
      { name: "unchanged.md" },
      { name: "changed.md" },
    ]);
    mockFs.files.set(`${vaultPath}/unchanged.md`, {
      content: "---\nkeywords: [shared]\n---\n# Unchanged",
      size: 10,
      mtime: 1,
    });
    mockFs.files.set(`${vaultPath}/changed.md`, {
      content: "---\nkeywords: [shared, changed]\n---\n# Changed",
      size: 22,
      mtime: 2,
    });

    const graph = await indexKnowledgeVaultIncremental(vaultPath, {
      previousNotes,
      previousFiles,
    });

    expect(graph.indexStats).toEqual(
      expect.objectContaining({
        mode: "incremental",
        totalFiles: 2,
        changedFiles: 1,
        unchangedFiles: 1,
        deletedFiles: 1,
        failedFiles: 0,
      }),
    );
    expect(graph.nodes.map((node) => node.id)).not.toContain("deleted.md");
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "unchanged.md",
        "changed.md",
        "keyword:shared",
        "keyword:changed",
      ]),
    );
    expect(graph.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "unchanged.md",
          target: "keyword:shared",
          type: "mentions",
        }),
        expect.objectContaining({
          source: "changed.md",
          target: "keyword:changed",
          type: "mentions",
        }),
        expect.objectContaining({
          source: "unchanged.md",
          target: "changed.md",
          type: "related_by_keyword",
          evidence: ["shared"],
        }),
      ]),
    );
  });

  it("records keyword graph build scale for 1,000 notes and keywords", () => {
    const notes = Array.from({ length: 1000 }, (_, index) =>
      note(`scale-${index}.md`, "", {
        keywords: [
          { text: `keyword-${index}`, normalized: `keyword-${index}` },
        ],
      }),
    );
    const startedAt = performance.now();
    const graph = buildKnowledgeGraph(notes);
    const durationMs = performance.now() - startedAt;

    expect(Number.isFinite(durationMs)).toBe(true);
    expect(graph.nodes).toHaveLength(2000);
    expect(graph.links.filter((link) => link.type === "mentions")).toHaveLength(
      1000,
    );
    expect(
      graph.nodes.filter((node) => node.category === "keyword"),
    ).toHaveLength(1000);
  });

  it("removes deleted note nodes and preserves missing link nodes", () => {
    const graph = buildKnowledgeGraph([note("a.md", "[[missing]]")]);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "a.md",
      "missing:missing",
    ]);
    expect(graph.links).toHaveLength(1);
  });
});
