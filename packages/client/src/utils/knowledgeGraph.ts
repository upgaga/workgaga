import { readDir, readTextFile, stat } from "@tauri-apps/plugin-fs";
import {
  normalizeKeyword,
  parseFrontmatterKeywords,
} from "./keywordExtraction";
import type {
  KnowledgeGraphData,
  KnowledgeGraphIndexStats,
  KnowledgeGraphLink,
  KnowledgeGraphNode,
  KnowledgeNote,
} from "../components/types";

interface ParsedLink {
  target: string;
  raw: string;
  type: "wiki" | "markdown";
}

export interface ParsedMarkdownMetadata {
  headings: { id: string; text: string; level: number }[];
  tags: string[];
  aliases: string[];
  keywords: KnowledgeNote["keywords"];
}

export const extractMarkdownMetadata = (
  content: string,
  noteId: string,
): ParsedMarkdownMetadata => {
  const headings: ParsedMarkdownMetadata["headings"] = [];
  const tags = new Set<string>();
  const aliases: string[] = [];
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let inFrontmatter = false;
  let frontmatterClosed = false;

  lines.forEach((line, index) => {
    if (index === 0 && line.trim() === "---") {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      frontmatterClosed = true;
      return;
    }
    if (inFrontmatter) {
      const aliasMatch = line.match(/^aliases?\s*:\s*(.*)$/i);
      if (aliasMatch) {
        const value = aliasMatch[1].trim();
        if (value.startsWith("[")) {
          aliases.push(
            ...value
              .slice(1, -1)
              .split(",")
              .map((alias) => alias.trim().replace(/^['\"]|['\"]$/g, ""))
              .filter(Boolean),
          );
        } else if (value) {
          aliases.push(value.replace(/^['\"]|['\"]$/g, ""));
        }
      }
      const tagsMatch = line.match(/^tags?\s*:\s*(.*)$/i);
      if (tagsMatch) {
        tagsMatch[1]
          .replace(/[\[\]]/g, "")
          .split(",")
          .map((tag) => tag.trim().replace(/^['\"]|['\"]$/g, ""))
          .filter(Boolean)
          .forEach((tag) => tags.add(tag.replace(/^#/, "")));
      }
      return;
    }
    if (!frontmatterClosed && index === 0) return;
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const text = headingMatch[2].trim();
      headings.push({
        id: `${noteId}#heading-${headings.length + 1}`,
        text,
        level: headingMatch[1].length,
      });
    }
    const tagMatches = line.match(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu) || [];
    tagMatches.forEach((tag) => tags.add(tag.replace(/^.*#/, "")));
  });

  return {
    headings,
    tags: Array.from(tags),
    aliases,
    keywords: parseFrontmatterKeywords(content.replace(/^\uFEFF/, "")),
  };
};

export interface KnowledgeFileSnapshot {
  path: string;
  relativePath: string;
  size: number;
  mtime: number | null;
}

export interface KnowledgeScanResult {
  notes: KnowledgeNote[];
  files: KnowledgeFileSnapshot[];
  failedFiles: number;
  warnings: string[];
  changedFiles: number;
  unchangedFiles: number;
  deletedFiles: number;
}

export interface KnowledgeIncrementalInput {
  previousNotes: KnowledgeNote[];
  previousFiles: KnowledgeFileSnapshot[];
}

export interface KnowledgeFileChangeSummary {
  changedFiles: number;
  unchangedFiles: number;
  deletedFiles: number;
}

export const summarizeKnowledgeFileChanges = (
  currentFiles: KnowledgeFileSnapshot[],
  previousFiles: KnowledgeFileSnapshot[],
): KnowledgeFileChangeSummary => {
  const previousByPath = new Map(
    previousFiles.map((file) => [
      normalizePath(file.relativePath).toLowerCase(),
      file,
    ]),
  );
  const currentPaths = new Set(
    currentFiles.map((file) => normalizePath(file.relativePath).toLowerCase()),
  );
  let unchangedFiles = 0;

  currentFiles.forEach((file) => {
    const previous = previousByPath.get(
      normalizePath(file.relativePath).toLowerCase(),
    );
    if (
      previous &&
      previous.size === file.size &&
      previous.mtime === file.mtime
    ) {
      unchangedFiles += 1;
    }
  });

  return {
    changedFiles: currentFiles.length - unchangedFiles,
    unchangedFiles,
    deletedFiles: previousFiles.filter(
      (file) =>
        !currentPaths.has(normalizePath(file.relativePath).toLowerCase()),
    ).length,
  };
};

const MARKDOWN_EXTENSIONS = ["md", "markdown"];
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".obsidian",
  "dist",
  "target",
]);
const MAX_KNOWLEDGE_DEPTH = 128;

const isExcludedDirectory = (name: string): boolean =>
  EXCLUDED_DIRECTORIES.has(name.toLowerCase());

export const normalizePath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/\/+/g, "/");

const trimTrailingSlash = (path: string): string =>
  normalizePath(path).replace(/\/+$/, "");

const joinPath = (base: string, name: string): string =>
  `${trimTrailingSlash(base)}/${name}`;

const dirname = (path: string): string => {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
};

const basename = (path: string): string => {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
};

const stripMarkdownExtension = (path: string): string =>
  path.replace(/\.(md|markdown)$/i, "");

const hasMarkdownExtension = (path: string): boolean =>
  MARKDOWN_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(`.${ext}`));

const normalizeRelativePath = (path: string): string => {
  const parts: string[] = [];
  normalizePath(path)
    .split("/")
    .filter(Boolean)
    .forEach((part) => {
      if (part === ".") return;
      if (part === "..") {
        parts.pop();
        return;
      }
      parts.push(part);
    });
  return parts.join("/");
};

export const getRelativePath = (
  vaultPath: string,
  filePath: string,
): string => {
  const root = trimTrailingSlash(vaultPath);
  const normalizedFile = normalizePath(filePath);
  return normalizedFile.startsWith(`${root}/`)
    ? normalizedFile.slice(root.length + 1)
    : basename(normalizedFile);
};

export const getNoteTitle = (path: string): string =>
  stripMarkdownExtension(basename(path));

const extractWikiLinks = (content: string): ParsedLink[] => {
  const links: ParsedLink[] = [];
  const regexp = /\[\[([^\]\n]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regexp.exec(content)) !== null) {
    const rawTarget = match[1].split("|")[0].split("#")[0].trim();
    if (!rawTarget) continue;
    links.push({
      target: normalizePath(rawTarget),
      raw: match[0],
      type: "wiki",
    });
  }

  return links;
};

const isExternalMarkdownTarget = (target: string): boolean =>
  /^(https?:|mailto:|tel:|file:|data:)/i.test(target);

const extractMarkdownLinks = (
  content: string,
  currentRelativePath: string,
): ParsedLink[] => {
  const links: ParsedLink[] = [];
  const regexp = /(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regexp.exec(content)) !== null) {
    const cleanTarget = match[1]
      .trim()
      .replace(/^<|>$/g, "")
      .split("#")[0]
      .split("?")[0]
      .trim();
    if (
      !cleanTarget ||
      cleanTarget.startsWith("#") ||
      isExternalMarkdownTarget(cleanTarget)
    )
      continue;

    const currentDir = dirname(currentRelativePath);
    const target = normalizeRelativePath(
      currentDir ? `${currentDir}/${cleanTarget}` : cleanTarget,
    );
    links.push({ target, raw: match[0], type: "markdown" });
  }

  return links;
};

const buildNoteIndexes = (notes: KnowledgeNote[]) => {
  const byRelativePath = new Map<string, KnowledgeNote>();
  const byStemPath = new Map<string, KnowledgeNote[]>();
  const byTitle = new Map<string, KnowledgeNote[]>();
  const byAlias = new Map<string, KnowledgeNote[]>();

  notes.forEach((note) => {
    const relativePath = normalizePath(note.relativePath);
    const stemPath = stripMarkdownExtension(relativePath);
    const title = note.title.trim().toLowerCase();

    byRelativePath.set(relativePath.toLowerCase(), note);
    byStemPath.set(stemPath.toLowerCase(), [
      ...(byStemPath.get(stemPath.toLowerCase()) || []),
      note,
    ]);
    byTitle.set(title, [...(byTitle.get(title) || []), note]);
    (note.aliases || []).forEach((alias) => {
      const key = alias.trim().toLowerCase();
      if (key) byAlias.set(key, [...(byAlias.get(key) || []), note]);
    });
  });

  return { byRelativePath, byStemPath, byTitle, byAlias };
};

const resolveLinkTarget = (
  link: ParsedLink,
  source: KnowledgeNote,
  indexes: ReturnType<typeof buildNoteIndexes>,
): KnowledgeNote | null => {
  const rawTarget = normalizeRelativePath(link.target);
  const sourceDir = dirname(source.relativePath);
  const sameDirTarget =
    sourceDir && !rawTarget.includes("/")
      ? `${sourceDir}/${rawTarget}`
      : rawTarget;
  const candidates = [sameDirTarget, rawTarget];

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate).toLowerCase();
    const direct = indexes.byRelativePath.get(normalized);
    if (direct) return direct;

    for (const ext of MARKDOWN_EXTENSIONS) {
      const withExt = indexes.byRelativePath.get(`${normalized}.${ext}`);
      if (withExt) return withExt;
    }

    const stemMatches = indexes.byStemPath.get(
      stripMarkdownExtension(normalized),
    );
    if (stemMatches?.length) return stemMatches[0];
  }

  if (!rawTarget.includes("/")) {
    const normalizedTitle = stripMarkdownExtension(rawTarget).toLowerCase();
    const aliasMatches = indexes.byAlias.get(normalizedTitle);
    if (aliasMatches?.length) return aliasMatches[0];
    const titleMatches = indexes.byTitle.get(normalizedTitle);
    if (titleMatches?.length) return titleMatches[0];
  }

  return null;
};

const createMissingNodeId = (source: KnowledgeNote, target: string): string => {
  const sourceDir = dirname(source.relativePath);
  const normalized = normalizeRelativePath(
    target.includes("/") || !sourceDir ? target : `${sourceDir}/${target}`,
  );
  return `missing:${stripMarkdownExtension(normalized)}`;
};

export interface KnowledgeGraphNeighborhoodOptions {
  rootId?: string;
  depth?: number;
  categories?: Set<KnowledgeGraphNode["category"]>;
  linkTypes?: Set<KnowledgeGraphLink["type"]>;
}

export interface KnowledgeGraphHierarchy {
  levels: Map<string, number>;
  parentIds: Map<string, string[]>;
  childIds: Map<string, string[]>;
  roots: string[];
  cyclicNodeIds: Set<string>;
  maxLevel: number;
}

const HIERARCHY_LINK_TYPES = new Set<KnowledgeGraphLink["type"]>([
  "contains",
  "tagged_with",
  "mentions",
  "parent_of",
]);

export const analyzeKnowledgeGraphHierarchy = (
  graph: KnowledgeGraphData,
): KnowledgeGraphHierarchy => {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const parentIds = new Map<string, string[]>();
  const childIds = new Map<string, string[]>();
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));

  graph.links.forEach((link) => {
    if (
      !HIERARCHY_LINK_TYPES.has(link.type) ||
      !nodeIds.has(link.source) ||
      !nodeIds.has(link.target) ||
      link.source === link.target
    ) {
      return;
    }
    const parents = parentIds.get(link.target) || [];
    if (!parents.includes(link.source)) {
      parentIds.set(link.target, [...parents, link.source]);
      childIds.set(link.source, [
        ...(childIds.get(link.source) || []),
        link.target,
      ]);
      indegree.set(link.target, (indegree.get(link.target) || 0) + 1);
    }
  });

  const roots = graph.nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id)
    .sort();
  const queue = [...roots];
  const levels = new Map(roots.map((id) => [id, 0]));
  const remainingIndegree = new Map(indegree);

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    const currentLevel = levels.get(current) || 0;
    (childIds.get(current) || []).forEach((childId) => {
      levels.set(childId, Math.max(levels.get(childId) || 0, currentLevel + 1));
      const nextIndegree = (remainingIndegree.get(childId) || 0) - 1;
      remainingIndegree.set(childId, nextIndegree);
      if (nextIndegree === 0) queue.push(childId);
    });
  }

  const cyclicNodeIds = new Set(
    graph.nodes
      .map((node) => node.id)
      .filter((id) => !levels.has(id)),
  );
  cyclicNodeIds.forEach((id) => levels.set(id, 0));
  const maxLevel = Math.max(0, ...levels.values());

  return { levels, parentIds, childIds, roots, cyclicNodeIds, maxLevel };
};

export const projectKnowledgeGraphHierarchy = (
  graph: KnowledgeGraphData,
  hierarchy: KnowledgeGraphHierarchy,
  options: { maxLevel?: number; collapsedNodeIds?: Set<string> } = {},
): KnowledgeGraphData => {
  const maxLevel = options.maxLevel ?? hierarchy.maxLevel;
  const hiddenIds = new Set<string>();
  const queue = [...(options.collapsedNodeIds || [])];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    (hierarchy.childIds.get(current) || []).forEach((childId) => {
      hiddenIds.add(childId);
      queue.push(childId);
    });
  }
  const nodes = graph.nodes.filter(
    (node) =>
      (hierarchy.levels.get(node.id) || 0) <= maxLevel &&
      !hiddenIds.has(node.id),
  );
  const visibleIds = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    links: graph.links.filter(
      (link) => visibleIds.has(link.source) && visibleIds.has(link.target),
    ),
  };
};

export const getKnowledgeGraphNeighborhood = (
  graph: KnowledgeGraphData,
  options: KnowledgeGraphNeighborhoodOptions = {},
): KnowledgeGraphData => {
  const { rootId, depth = 0, categories, linkTypes } = options;
  const links = graph.links.filter(
    (link) => !linkTypes || linkTypes.has(link.type),
  );
  const allowedIds = new Set<string>();

  if (!rootId) {
    if (linkTypes) {
      links.forEach((link) => {
        allowedIds.add(link.source);
        allowedIds.add(link.target);
      });
    } else {
      graph.nodes.forEach((node) => allowedIds.add(node.id));
    }
  } else {
    const queue: Array<{ id: string; distance: number }> = [
      { id: rootId, distance: 0 },
    ];
    const distances = new Map<string, number>([[rootId, 0]]);
    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      allowedIds.add(current.id);
      if (current.distance >= Math.max(0, depth)) continue;
      links.forEach((link) => {
        const neighbor =
          link.source === current.id
            ? link.target
            : link.target === current.id
              ? link.source
              : null;
        if (neighbor && !distances.has(neighbor)) {
          distances.set(neighbor, current.distance + 1);
          queue.push({ id: neighbor, distance: current.distance + 1 });
        }
      });
    }
  }

  const filteredNodes = graph.nodes.filter(
    (node) =>
      allowedIds.has(node.id) && (!categories || categories.has(node.category)),
  );
  const uniqueNodeIds = new Set<string>();
  const dedupFilteredNodes = filteredNodes.filter((node) => {
    if (uniqueNodeIds.has(node.id)) return false;
    uniqueNodeIds.add(node.id);
    return true;
  });
  const filteredNodeIds = new Set(dedupFilteredNodes.map((node) => node.id));
  const filteredLinks = links.filter(
    (link) =>
      filteredNodeIds.has(link.source) && filteredNodeIds.has(link.target),
  );
  const uniqueLinkKeys = new Set<string>();
  const dedupFilteredLinks = filteredLinks.filter((link) => {
    const key = `${link.source}->${link.target}:${link.type}:${link.raw}`;
    if (uniqueLinkKeys.has(key)) return false;
    uniqueLinkKeys.add(key);
    return true;
  });
  return {
    ...graph,
    nodes: dedupFilteredNodes,
    links: dedupFilteredLinks,
  };
};

export const getIncomingKnowledgeGraphLinks = (
  graph: KnowledgeGraphData,
  targetId: string,
): KnowledgeGraphLink[] =>
  graph.links.filter((link) => link.target === targetId);

export const namespaceKnowledgeGraphData = (
  graph: KnowledgeGraphData,
  vaultPath: string,
): KnowledgeGraphData => {
  const prefix = `vault:${encodeURIComponent(normalizePath(vaultPath))}:`;
  const idMap = new Map<string, string>();
  graph.nodes.forEach((node) => idMap.set(node.id, `${prefix}${node.id}`));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id) || `${prefix}${node.id}`,
    })),
    links: graph.links.map((link) => ({
      ...link,
      source: idMap.get(link.source) || `${prefix}${link.source}`,
      target: idMap.get(link.target) || `${prefix}${link.target}`,
    })),
    notes: graph.notes?.map((note) => ({
      ...note,
      id: idMap.get(note.id) || `${prefix}${note.id}`,
    })),
  };
};

export const mergeKnowledgeGraphData = (
  graphs: Array<{ vaultPath: string; graph: KnowledgeGraphData }>,
): KnowledgeGraphData => {
  const namespaced = graphs.map(({ vaultPath, graph }) =>
    namespaceKnowledgeGraphData(graph, vaultPath),
  );
  const warnings = namespaced.flatMap(
    (graph) => graph.indexStats?.warnings || [],
  );
  const stats = namespaced.reduce(
    (result, graph) => {
      const current = graph.indexStats;
      if (!current) return result;
      result.totalFiles += current.totalFiles;
      result.changedFiles += current.changedFiles;
      result.unchangedFiles += current.unchangedFiles;
      result.deletedFiles += current.deletedFiles;
      result.failedFiles += current.failedFiles;
      result.durationMs = Math.max(result.durationMs, current.durationMs);
      return result;
    },
    {
      totalFiles: 0,
      changedFiles: 0,
      unchangedFiles: 0,
      deletedFiles: 0,
      failedFiles: 0,
      durationMs: 0,
    },
  );

  const dedupNodes = new Map<string, KnowledgeGraphNode>();
  namespaced.forEach((graph) =>
    graph.nodes.forEach((node) => {
      if (!dedupNodes.has(node.id)) dedupNodes.set(node.id, node);
    }),
  );
  const dedupLinks = new Map<string, KnowledgeGraphLink>();
  namespaced.forEach((graph) =>
    graph.links.forEach((link) => {
      const key = `${link.source}->${link.target}:${link.type}:${link.raw}`;
      if (!dedupLinks.has(key)) dedupLinks.set(key, link);
    }),
  );
  const dedupNotes = new Map<string, KnowledgeNote>();
  namespaced.forEach((graph) =>
    (graph.notes || []).forEach((note) => {
      if (!dedupNotes.has(note.id)) dedupNotes.set(note.id, note);
    }),
  );

  return {
    nodes: Array.from(dedupNodes.values()),
    links: Array.from(dedupLinks.values()),
    notes: Array.from(dedupNotes.values()),
    indexedAt: Date.now(),
    indexStats: {
      ...stats,
      warnings,
      mode: namespaced.some((graph) => graph.indexStats?.mode === "incremental")
        ? "incremental"
        : "full",
    },
  };
};

export const buildKnowledgeGraph = (
  notes: KnowledgeNote[],
): KnowledgeGraphData => {
  const indexes = buildNoteIndexes(notes);
  const nodes = new Map<string, KnowledgeGraphNode>();
  const links = new Map<string, KnowledgeGraphLink>();
  const notesByKeyword = new Map<string, KnowledgeNote[]>();
  const keywordEvidence = new Map<string, Map<string, string>>();

  notes.forEach((note) => {
    const activeKeywords = (note.keywords || []).filter(
      (keyword) =>
        keyword.status !== "ignored" && keyword.status !== "candidate",
    );
    const activeKeywordIds = new Set(
      activeKeywords
        .map((keyword) =>
          normalizeKeyword(keyword.normalized || keyword.text),
        )
        .filter(Boolean),
    );
    const parentByKeyword = new Map<string, string>();
    activeKeywords.forEach((keyword) => {
      const childId = normalizeKeyword(keyword.normalized || keyword.text);
      const parentId = normalizeKeyword(
        keyword.parentNormalized || keyword.parent || "",
      );
      if (
        childId &&
        parentId &&
        childId !== parentId &&
        activeKeywordIds.has(parentId)
      ) {
        parentByKeyword.set(childId, parentId);
      }
    });
    const hasParentCycle = (childId: string): boolean => {
      const visited = new Set<string>([childId]);
      let current = parentByKeyword.get(childId);
      while (current) {
        if (visited.has(current)) return true;
        visited.add(current);
        current = parentByKeyword.get(current);
      }
      return false;
    };
    nodes.set(note.id, {
      id: note.id,
      name: note.title,
      path: note.path,
      relativePath: note.relativePath,
      exists: true,
      category: "note",
    });

    (note.headings || []).forEach((heading) => {
      nodes.set(heading.id, {
        id: heading.id,
        name: heading.text,
        path: note.path,
        relativePath: note.relativePath,
        exists: true,
        category: "heading",
        level: heading.level,
      });
      const linkId = `${note.id}->${heading.id}:contains`;
      links.set(linkId, {
        source: note.id,
        target: heading.id,
        type: "contains",
        raw: heading.text,
      });
    });

    (note.tags || []).forEach((tag) => {
      const tagId = `tag:${tag.toLowerCase()}`;
      nodes.set(tagId, {
        id: tagId,
        name: `#${tag}`,
        exists: true,
        category: "tag",
      });
      const linkId = `${note.id}->${tagId}:tagged_with`;
      links.set(linkId, {
        source: note.id,
        target: tagId,
        type: "tagged_with",
        raw: `#${tag}`,
      });
    });

    activeKeywords.forEach((keyword) => {
      const normalized = normalizeKeyword(keyword.normalized || keyword.text);
      if (!normalized) return;
      const keywordId = `keyword:${normalized}`;
      if (!nodes.has(keywordId)) {
        nodes.set(keywordId, {
          id: keywordId,
          name: keyword.text,
          exists: true,
          category: "keyword",
        });
      }
      links.set(`${note.id}->${keywordId}:mentions`, {
        source: note.id,
        target: keywordId,
        type: "mentions",
        raw: keyword.text,
        ...(keyword.score !== undefined ? { weight: keyword.score } : {}),
        ...(keyword.confidence !== undefined
          ? { confidence: keyword.confidence }
          : {}),
        ...(keyword.source ? { sourceKind: keyword.source } : {}),
        ...(keyword.evidence?.length ? { evidence: keyword.evidence } : {}),
      });
      const relatedNotes = notesByKeyword.get(normalized) || [];
      if (!relatedNotes.includes(note) && relatedNotes.length < 20) {
        relatedNotes.push(note);
      }
      notesByKeyword.set(normalized, relatedNotes);
      const evidenceByNote =
        keywordEvidence.get(normalized) || new Map<string, string>();
      if (!evidenceByNote.has(note.id))
        evidenceByNote.set(note.id, keyword.text);
      keywordEvidence.set(normalized, evidenceByNote);
      if (keyword.parentNormalized || keyword.parent) {
        const parentNormalized = normalizeKeyword(
          keyword.parentNormalized || keyword.parent || "",
        );
        if (
          parentNormalized &&
          parentNormalized !== normalized &&
          activeKeywordIds.has(parentNormalized) &&
          !hasParentCycle(normalized)
        ) {
          const parentId = `keyword:${parentNormalized}`;
          links.set(`${parentId}->${keywordId}:parent_of`, {
            source: parentId,
            target: keywordId,
            type: "parent_of",
            raw: `${keyword.parent || parentNormalized} → ${keyword.text}`,
            sourceKind: "frontmatter",
          });
        }
      }
    });
  });

  const relatedPairs = new Map<
    string,
    { source: KnowledgeNote; target: KnowledgeNote; evidence: string[] }
  >();
  notesByKeyword.forEach((relatedNotes, normalized) => {
    for (let index = 0; index < relatedNotes.length; index += 1) {
      for (
        let otherIndex = index + 1;
        otherIndex < relatedNotes.length;
        otherIndex += 1
      ) {
        const source = relatedNotes[index];
        const target = relatedNotes[otherIndex];
        const linkId = `${source.id}->${target.id}:related_by_keyword`;
        const pair = relatedPairs.get(linkId) || {
          source,
          target,
          evidence: [],
        };
        const keyword =
          keywordEvidence.get(normalized)?.get(source.id) || normalized;
        if (!pair.evidence.includes(keyword)) pair.evidence.push(keyword);
        relatedPairs.set(linkId, pair);
      }
    }
  });
  Array.from(relatedPairs.values())
    .sort((a, b) => b.evidence.length - a.evidence.length)
    .slice(0, 500)
    .forEach(({ source, target, evidence }) => {
      links.set(`${source.id}->${target.id}:related_by_keyword`, {
        source: source.id,
        target: target.id,
        type: "related_by_keyword",
        raw: "shared keyword",
        weight: evidence.length,
        evidence,
      });
    });

  notes.forEach((note) => {
    const parsedLinks = [
      ...extractWikiLinks(note.content),
      ...extractMarkdownLinks(note.content, note.relativePath),
    ];

    parsedLinks.forEach((link) => {
      const targetNote = resolveLinkTarget(link, note, indexes);
      const targetId = targetNote?.id || createMissingNodeId(note, link.target);

      if (!targetNote && !nodes.has(targetId)) {
        nodes.set(targetId, {
          id: targetId,
          name: getNoteTitle(link.target),
          relativePath: targetId.replace(/^missing:/, ""),
          exists: false,
          category: "missing",
        });
      }

      const linkId = `${note.id}->${targetId}:${link.type}:${link.raw}`;
      links.set(linkId, {
        source: note.id,
        target: targetId,
        type: link.type,
        raw: link.raw,
      });
    });
  });

  return {
    nodes: Array.from(nodes.values()),
    links: Array.from(links.values()),
    notes,
    indexedAt: Date.now(),
  };
};

const scanMarkdownFiles = async (
  vaultPath: string,
  currentPath: string,
  depth: number,
  notes: KnowledgeNote[],
  files: KnowledgeFileSnapshot[],
  failedFiles: { count: number },
  warnings: string[],
): Promise<void> => {
  if (depth > MAX_KNOWLEDGE_DEPTH) return;
  let entries;
  try {
    entries = await readDir(currentPath);
  } catch (error) {
    failedFiles.count += 1;
    warnings.push(
      `${currentPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.warn("读取知识库目录失败:", currentPath, error);
    return;
  }

  for (const entry of entries) {
    if (!entry.name) continue;

    const fullPath = joinPath(currentPath, entry.name);

    if (entry.isDirectory) {
      if (isExcludedDirectory(entry.name)) continue;
      await scanMarkdownFiles(
        vaultPath,
        fullPath,
        depth + 1,
        notes,
        files,
        failedFiles,
        warnings,
      );
      continue;
    }

    if (!hasMarkdownExtension(entry.name)) continue;

    try {
      const info = await stat(fullPath);
      const content = await readTextFile(fullPath);
      const relativePath = getRelativePath(vaultPath, fullPath);
      files.push({
        path: fullPath,
        relativePath,
        size: info.size,
        mtime: info.mtime?.getTime() ?? null,
      });
      notes.push({
        id: normalizePath(relativePath),
        path: fullPath,
        relativePath,
        title: getNoteTitle(relativePath),
        content,
        ...extractMarkdownMetadata(
          content.replace(/^\uFEFF/, ""),
          normalizePath(relativePath),
        ),
        size: info.size,
        mtime: info.mtime?.getTime(),
      });
    } catch (error) {
      failedFiles.count += 1;
      warnings.push(
        `${fullPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.warn("读取知识库文件失败:", fullPath, error);
    }
  }
};

export const scanKnowledgeVault = async (
  vaultPath: string,
): Promise<KnowledgeScanResult> => {
  const notes: KnowledgeNote[] = [];
  const files: KnowledgeFileSnapshot[] = [];
  const failedFiles = { count: 0 };
  const warnings: string[] = [];
  await scanMarkdownFiles(
    vaultPath,
    vaultPath,
    0,
    notes,
    files,
    failedFiles,
    warnings,
  );
  return {
    notes,
    files,
    failedFiles: failedFiles.count,
    warnings,
    changedFiles: files.length,
    unchangedFiles: 0,
    deletedFiles: 0,
  };
};

const createIndexStats = (
  mode: KnowledgeGraphIndexStats["mode"],
  totalFiles: number,
  changedFiles: number,
  unchangedFiles: number,
  deletedFiles: number,
  failedFiles: number,
  warnings: string[],
  startedAt: number,
): KnowledgeGraphIndexStats => ({
  mode,
  totalFiles,
  changedFiles,
  unchangedFiles,
  deletedFiles,
  failedFiles,
  warnings,
  durationMs: Date.now() - startedAt,
});

export const indexKnowledgeVault = async (
  vaultPath: string,
  options: { overlayNotes?: KnowledgeNote[] } = {},
): Promise<KnowledgeGraphData> => {
  const startedAt = Date.now();
  const scan = await scanKnowledgeVault(vaultPath);
  const notesByPath = new Map(
    scan.notes.map((note) => [normalizePath(note.relativePath).toLowerCase(), note]),
  );
  options.overlayNotes?.forEach((note) => {
    notesByPath.set(normalizePath(note.relativePath).toLowerCase(), note);
  });
  const notes = Array.from(notesByPath.values());
  return {
    ...buildKnowledgeGraph(notes),
    indexStats: createIndexStats(
      "full",
      notes.length,
        notes.length,
        0,
      0,
      scan.failedFiles,
      scan.warnings,
      startedAt,
    ),
  };
};

const scanKnowledgeFileSnapshots = async (
  vaultPath: string,
  currentPath: string,
  depth: number,
  files: KnowledgeFileSnapshot[],
): Promise<void> => {
  if (depth > MAX_KNOWLEDGE_DEPTH) return;
  const entries = await readDir(currentPath);
  for (const entry of entries) {
    if (!entry.name) continue;
    const fullPath = joinPath(currentPath, entry.name);
    if (entry.isDirectory) {
      if (!isExcludedDirectory(entry.name)) {
        await scanKnowledgeFileSnapshots(vaultPath, fullPath, depth + 1, files);
      }
      continue;
    }
    if (!hasMarkdownExtension(entry.name)) continue;
    try {
      const info = await stat(fullPath);
      files.push({
        path: fullPath,
        relativePath: getRelativePath(vaultPath, fullPath),
        size: info.size,
        mtime: info.mtime?.getTime() ?? null,
      });
    } catch (error) {
      console.warn("读取知识库文件信息失败:", fullPath, error);
    }
  }
};

const readKnowledgeNote = async (
  file: KnowledgeFileSnapshot,
): Promise<KnowledgeNote> => {
  const content = await readTextFile(file.path);
  return {
    id: normalizePath(file.relativePath),
    path: file.path,
    relativePath: file.relativePath,
    title: getNoteTitle(file.relativePath),
    content,
    ...extractMarkdownMetadata(content, normalizePath(file.relativePath)),
    size: file.size,
    mtime: file.mtime ?? undefined,
  };
};

export const indexKnowledgeVaultIncremental = async (
  vaultPath: string,
  input: KnowledgeIncrementalInput,
): Promise<KnowledgeGraphData> => {
  const startedAt = Date.now();
  const files: KnowledgeFileSnapshot[] = [];
  await scanKnowledgeFileSnapshots(vaultPath, vaultPath, 0, files);
  const previousByPath = new Map(
    input.previousNotes.map((note) => [
      normalizePath(note.relativePath).toLowerCase(),
      note,
    ]),
  );
  const previousFiles = new Map(
    input.previousFiles.map((file) => [
      normalizePath(file.relativePath).toLowerCase(),
      file,
    ]),
  );
  const currentPaths = new Set(
    files.map((file) => normalizePath(file.relativePath).toLowerCase()),
  );
  const unchangedPaths = new Set<string>();
  const notes: KnowledgeNote[] = [];
  let changedFiles = 0;
  let failedFiles = 0;

  for (const file of files) {
    const key = normalizePath(file.relativePath).toLowerCase();
    const previousFile = previousFiles.get(key);
    if (
      previousFile &&
      previousFile.size === file.size &&
      previousFile.mtime === file.mtime
    ) {
      const previousNote = previousByPath.get(key);
      if (previousNote) {
        unchangedPaths.add(key);
        notes.push(previousNote);
        continue;
      }
    }
    try {
      notes.push(await readKnowledgeNote(file));
      changedFiles += 1;
    } catch (error) {
      failedFiles += 1;
      const previousNote = previousByPath.get(key);
      if (previousNote) notes.push(previousNote);
      console.warn("读取知识库文件失败:", file.path, error);
    }
  }

  const deletedFiles = Array.from(previousFiles.keys()).filter(
    (path) => !currentPaths.has(path),
  ).length;
  return {
    ...buildKnowledgeGraph(notes),
    indexStats: createIndexStats(
      "incremental",
      files.length,
      changedFiles,
      unchangedPaths.size,
      deletedFiles,
      failedFiles,
      [],
      startedAt,
    ),
  };
};
