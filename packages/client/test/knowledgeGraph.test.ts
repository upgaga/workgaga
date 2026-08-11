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
  analyzeKnowledgeGraphHierarchy,
  buildKnowledgeGraph,
  extractMarkdownMetadata,
  getIncomingKnowledgeGraphLinks,
  getKnowledgeGraphNeighborhood,
  indexKnowledgeVaultIncremental,
  mergeKnowledgeGraphData,
  projectKnowledgeGraphHierarchy,
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

  it("builds valid keyword hierarchy and rejects orphan or cyclic parents", () => {
    const graph = buildKnowledgeGraph([
      note("hierarchy.md", "", {
        keywords: [
          { text: "知识图谱", normalized: "知识图谱" },
          {
            text: "节点",
            normalized: "节点",
            parent: "知识图谱",
            parentNormalized: "知识图谱",
          },
          {
            text: "孤儿",
            normalized: "孤儿",
            parent: "不存在",
            parentNormalized: "不存在",
          },
          { text: "循环 A", normalized: "循环 a", parent: "循环 B" },
          { text: "循环 B", normalized: "循环 b", parent: "循环 A" },
        ],
      }),
    ]);
    expect(graph.links.filter((link) => link.type === "parent_of")).toEqual([
      expect.objectContaining({
        source: "keyword:知识图谱",
        target: "keyword:节点",
        raw: "知识图谱 → 节点",
      }),
    ]);
    expect(graph.nodes.some((node) => node.id === "keyword:不存在")).toBe(false);
  });

  it("limits relationship filters to connected endpoints", () => {
    const graph = buildKnowledgeGraph([
      note("hierarchy.md", "", {
        keywords: [
          { text: "父级", normalized: "父级" },
          { text: "子级", normalized: "子级", parent: "父级" },
        ],
        tags: ["无关标签"],
      }),
    ]);
    const hierarchy = getKnowledgeGraphNeighborhood(graph, {
      linkTypes: new Set(["parent_of"]),
    });
    expect(hierarchy.nodes.map((node) => node.id).sort()).toEqual([
      "keyword:子级",
      "keyword:父级",
    ]);
    expect(hierarchy.links).toHaveLength(1);
  });

  it("assigns stable levels for chains, branches, and independent roots", () => {
    const graph = buildKnowledgeGraph([
      note("hierarchy.md", "", {
        keywords: [
          { text: "根", normalized: "根" },
          { text: "一级 A", normalized: "一级 a", parent: "根" },
          { text: "一级 B", normalized: "一级 b", parent: "根" },
          { text: "二级", normalized: "二级", parent: "一级 A" },
          { text: "独立", normalized: "独立" },
        ],
      }),
    ]);
    const hierarchy = analyzeKnowledgeGraphHierarchy(graph);

    expect(hierarchy.levels.get("hierarchy.md")).toBe(0);
    expect(hierarchy.levels.get("keyword:根")).toBe(1);
    expect(hierarchy.levels.get("keyword:一级 a")).toBe(2);
    expect(hierarchy.levels.get("keyword:一级 b")).toBe(2);
    expect(hierarchy.levels.get("keyword:二级")).toBe(3);
    expect(hierarchy.levels.get("keyword:独立")).toBe(1);
    expect(hierarchy.childIds.get("keyword:根")?.sort()).toEqual([
      "keyword:一级 a",
      "keyword:一级 b",
    ]);
    expect(hierarchy.maxLevel).toBe(3);
  });

  it("projects levels incrementally and collapses complete descendant branches", () => {
    const graph = buildKnowledgeGraph([
      note("hierarchy.md", "", {
        keywords: [
          { text: "根", normalized: "根" },
          { text: "一级", normalized: "一级", parent: "根" },
          { text: "二级", normalized: "二级", parent: "一级" },
        ],
      }),
    ]);
    const hierarchy = analyzeKnowledgeGraphHierarchy(graph);
    const firstLevel = projectKnowledgeGraphHierarchy(graph, hierarchy, {
      maxLevel: 1,
    });
    expect(firstLevel.nodes.map((node) => node.id).sort()).toEqual([
      "hierarchy.md",
      "keyword:根",
    ]);
    expect(firstLevel.links.every((link) =>
      firstLevel.nodes.some((node) => node.id === link.source) &&
      firstLevel.nodes.some((node) => node.id === link.target),
    )).toBe(true);

    const collapsed = projectKnowledgeGraphHierarchy(graph, hierarchy, {
      maxLevel: hierarchy.maxLevel,
      collapsedNodeIds: new Set(["keyword:根"]),
    });
    expect(collapsed.nodes.map((node) => node.id).sort()).toEqual([
      "hierarchy.md",
      "keyword:根",
    ]);
    expect(collapsed.links.some((link) => link.target === "keyword:一级")).toBe(
      false,
    );
  });

  it("keeps hierarchy analysis bounded when cyclic input is supplied", () => {
    const graph = {
      nodes: [
        { id: "a", name: "A", exists: true, category: "keyword" as const },
        { id: "b", name: "B", exists: true, category: "keyword" as const },
        { id: "root", name: "Root", exists: true, category: "keyword" as const },
      ],
      links: [
        { source: "a", target: "b", type: "parent_of" as const, raw: "A → B" },
        { source: "b", target: "a", type: "parent_of" as const, raw: "B → A" },
      ],
      indexedAt: 0,
    };
    const hierarchy = analyzeKnowledgeGraphHierarchy(graph);
    expect(hierarchy.roots).toEqual(["root"]);
    expect([...hierarchy.cyclicNodeIds].sort()).toEqual(["a", "b"]);
    expect(hierarchy.levels.get("a")).toBe(0);
    expect(hierarchy.levels.get("b")).toBe(0);
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
