import type {
  KnowledgeKeyword,
  KnowledgeNote,
  KeywordExtraction,
} from "../components/types";

export interface KeywordExtractionOptions {
  readonly topN?: number;
  readonly stopWords?: Iterable<string>;
  readonly fieldWeights?: Partial<Record<KeywordField, number>>;
  readonly modelScoreMultiplier?: number;
}

export type KeywordField = "title" | "heading" | "tag" | "alias" | "content";

export interface KeywordExtractionResult extends KeywordExtraction {
  keywords: KnowledgeKeyword[];
}

const DEFAULT_FIELD_WEIGHTS: Record<KeywordField, number> = {
  title: 4,
  heading: 3,
  tag: 3,
  alias: 3,
  content: 1,
};

const DEFAULT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
  "的",
  "了",
  "和",
  "是",
  "在",
  "我",
  "有",
  "与",
  "及",
  "或",
  "一个",
  "这",
  "那",
  "也",
  "都",
  "而",
  "被",
  "将",
  "对",
]);

const cleanKeyword = (value: string): string =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "")
    .replace(/\s+/g, " ");

export const normalizeKeyword = (value: string): string =>
  cleanKeyword(value).toLocaleLowerCase();

const unquote = (value: string): string =>
  value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();

const parseKeywordValue = (value: string): KnowledgeKeyword[] => {
  const input = value.trim();
  if (!input) return [];
  if (input.startsWith("[") && input.endsWith("]")) {
    const body = input.slice(1, -1).trim();
    if (!body) return [];
    return body.split(",").flatMap((item) => parseKeywordValue(item));
  }
  if (input.startsWith("{") && input.endsWith("}")) {
    const body = input.slice(1, -1).trim();
    return body.split(",").flatMap((item) => {
      const separator = item.indexOf(":");
      if (separator < 0) return parseKeywordValue(item);
      const text = unquote(item.slice(0, separator));
      const score = Number(item.slice(separator + 1).trim());
      return text
        ? [
            {
              text,
              normalized: normalizeKeyword(text),
              ...(Number.isFinite(score) ? { score } : {}),
            },
          ]
        : [];
    });
  }
  const text = unquote(input);
  return text ? [{ text, normalized: normalizeKeyword(text) }] : [];
};

const normalizeTag = (value: string): string =>
  value.normalize("NFKC").trim().replace(/^#+/, "").trim();

const parseTagValue = (value: string): string[] => {
  const input = value.trim();
  if (!input) return [];
  if (input.startsWith("[") && input.endsWith("]")) {
    const body = input.slice(1, -1).trim();
    return body ? body.split(",").flatMap(parseTagValue) : [];
  }
  return input.split(",").map(unquote).map(normalizeTag).filter(Boolean);
};

export const parseFrontmatterTags = (content: string): string[] => {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const values: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") break;
    const match = line.match(/^tags?\s*:\s*(.*)$/i);
    if (!match) continue;
    values.push(...parseTagValue(match[1]));
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === "---") break;
      const item = lines[next].match(/^\s*-\s*(.+)$/);
      if (!item) break;
      values.push(...parseTagValue(item[1]));
      index = next;
    }
  }
  return Array.from(new Set(values));
};

export const writeFrontmatterTags = (
  content: string,
  tags: readonly string[],
): string => {
  const values = Array.from(new Set(tags.map(normalizeTag).filter(Boolean)));
  const line = `tags: [${values.map((value) => JSON.stringify(value)).join(", ")}]`;
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((item, index) => index > 0 && item.trim() === "---");
    if (end >= 0) {
      const existing = lines.findIndex(
        (item, index) => index > 0 && index < end && /^tags?\s*:/i.test(item),
      );
      if (existing >= 0) lines[existing] = line;
      else lines.splice(end, 0, line);
      return lines.join("\n");
    }
  }
  return `---\n${line}\n---\n${content}`;
};

export const parseFrontmatterKeywords = (
  content: string,
): KnowledgeKeyword[] => {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const values: KnowledgeKeyword[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") break;
    const match = line.match(/^keywords?\s*:\s*(.*)$/i);
    if (match) {
      values.push(...parseKeywordValue(match[1]));
      for (let next = index + 1; next < lines.length; next += 1) {
        const item = lines[next].match(/^\s*-\s*(.+)$/);
        if (!item) break;
        values.push(...parseKeywordValue(item[1]));
        index = next;
      }
      break;
    }
  }
  const seen = new Set<string>();
  return values.filter((keyword) => {
    const normalized = keyword.normalized || normalizeKeyword(keyword.text);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    keyword.normalized = normalized;
    keyword.source = "frontmatter";
    return true;
  });
};

export const writeFrontmatterKeywords = (
  content: string,
  keywords: readonly (KnowledgeKeyword | string)[],
): string => {
  const values = keywords
    .map((keyword) => (typeof keyword === "string" ? keyword : keyword.text))
    .map(cleanKeyword)
    .filter(Boolean);
  const line = `keywords: [${values.map((value) => JSON.stringify(value)).join(", ")}]`;
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex(
      (item, index) => index > 0 && item.trim() === "---",
    );
    if (end >= 0) {
      const existing = lines.findIndex(
        (item, index) =>
          index > 0 && index < end && /^keywords?\s*:/i.test(item),
      );
      if (existing >= 0) {
        lines[existing] = line;
      } else {
        lines.splice(end, 0, line);
      }
      return lines.join("\n");
    }
  }
  return `---\n${line}\n---\n${content}`;
};

const addCandidate = (
  map: Map<string, KnowledgeKeyword>,
  raw: string,
  field: KeywordField,
  weight: number,
  stopWords: Set<string>,
): void => {
  const text = cleanKeyword(raw);
  const normalized = normalizeKeyword(text);
  if (!normalized || stopWords.has(normalized) || normalized.length < 2) return;
  const current = map.get(normalized);
  if (current) {
    current.frequency = (current.frequency || 0) + 1;
    current.score = (current.score || 0) + weight;
    return;
  }
  map.set(normalized, {
    text,
    normalized,
    frequency: 1,
    score: weight,
    source: field,
  });
};

const collectText = (
  text: string,
  field: KeywordField,
  map: Map<string, KnowledgeKeyword>,
  weight: number,
  stopWords: Set<string>,
): void => {
  const english = text.match(/[A-Za-z][A-Za-z0-9_-]*/g) || [];
  english.forEach((token) =>
    addCandidate(map, token, field, weight, stopWords),
  );
  const chineseRuns = text.match(/[\u3400-\u9fff]+/g) || [];
  chineseRuns.forEach((run) => {
    if (run.length >= 2) addCandidate(map, run, field, weight, stopWords);
    for (let size = 2; size <= Math.min(4, run.length); size += 1) {
      for (let index = 0; index + size <= run.length; index += size) {
        addCandidate(
          map,
          run.slice(index, index + size),
          field,
          weight,
          stopWords,
        );
      }
    }
  });
};

export const extractKeywords = (
  note: Pick<
    KnowledgeNote,
    "title" | "content" | "headings" | "tags" | "aliases"
  >,
  options: KeywordExtractionOptions = {},
): KeywordExtractionResult => {
  const startedAt = performance.now();
  const topN = Math.max(0, options.topN ?? 20);
  const weights = { ...DEFAULT_FIELD_WEIGHTS, ...options.fieldWeights };
  const stopWords = new Set(
    Array.from(options.stopWords || DEFAULT_STOP_WORDS, normalizeKeyword),
  );
  const candidates = new Map<string, KnowledgeKeyword>();
  collectText(note.title, "title", candidates, weights.title, stopWords);
  (note.headings || []).forEach((heading) =>
    collectText(
      heading.text,
      "heading",
      candidates,
      weights.heading,
      stopWords,
    ),
  );
  (note.tags || []).forEach((tag) =>
    collectText(tag, "tag", candidates, weights.tag, stopWords),
  );
  (note.aliases || []).forEach((alias) =>
    collectText(alias, "alias", candidates, weights.alias, stopWords),
  );
  collectText(note.content, "content", candidates, weights.content, stopWords);
  const keywords = Array.from(candidates.values())
    .sort(
      (a, b) =>
        (b.score || 0) - (a.score || 0) ||
        (b.frequency || 0) - (a.frequency || 0) ||
        a.text.localeCompare(b.text),
    )
    .slice(0, topN);
  return {
    keywords,
    algorithm: "local",
    topN,
    durationMs: Math.max(0, performance.now() - startedAt),
    extractor: "algorithm",
  };
};

export interface KeywordMergeOptions {
  readonly topN?: number;
  readonly modelScoreMultiplier?: number;
}

const sourcePriority = (source?: KnowledgeKeyword["source"]): number =>
  source === "frontmatter"
    ? 5
    : source === "title"
      ? 4
      : source === "heading" || source === "tag" || source === "alias"
        ? 3
        : source === "content"
          ? 1
          : 0;

export const mergeKeywordExtractionResults = (
  localResult: KeywordExtractionResult,
  algorithmResult: KeywordExtractionResult,
  options: KeywordMergeOptions = {},
): KeywordExtractionResult => {
  const topN = Math.max(
    0,
    options.topN ?? localResult.topN ?? algorithmResult.topN ?? 20,
  );
  const modelMultiplier = options.modelScoreMultiplier ?? 1.15;
  const merged = new Map<string, KnowledgeKeyword>();
  const add = (keyword: KnowledgeKeyword, isModel: boolean): void => {
    const normalized = keyword.normalized || normalizeKeyword(keyword.text);
    if (!normalized) return;
    const score =
      (keyword.score ?? keyword.confidence ?? 0) *
      (isModel ? modelMultiplier : 1);
    const current = merged.get(normalized);
    if (!current) {
      merged.set(normalized, {
        ...keyword,
        normalized,
        score,
        confidence: score,
        ...(keyword.evidence ? { evidence: [...keyword.evidence] } : {}),
      });
      return;
    }
    const currentScore = current.score ?? current.confidence ?? 0;
    const finalScore = currentScore + score;
    const preferred =
      sourcePriority(keyword.source) > sourcePriority(current.source)
        ? keyword
        : current;
    merged.set(normalized, {
      ...current,
      ...preferred,
      text: preferred.text || current.text,
      normalized,
      score: finalScore,
      confidence: finalScore,
      frequency: (current.frequency ?? 0) + (keyword.frequency ?? 0),
      evidence: Array.from(
        new Set([...(current.evidence || []), ...(keyword.evidence || [])]),
      ),
      ...(current.modelId || keyword.modelId
        ? { modelId: current.modelId || keyword.modelId }
        : {}),
      ...(current.modelVersion || keyword.modelVersion
        ? { modelVersion: current.modelVersion || keyword.modelVersion }
        : {}),
    });
  };
  localResult.keywords.forEach((keyword) =>
    add(keyword, Boolean(keyword.modelId || keyword.modelVersion)),
  );
  algorithmResult.keywords.forEach((keyword) => add(keyword, false));
  const keywords = Array.from(merged.values())
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        (b.frequency ?? 0) - (a.frequency ?? 0),
    )
    .slice(0, topN);
  return {
    keywords,
    algorithm: "combined",
    topN,
    durationMs:
      (localResult.durationMs ?? 0) + (algorithmResult.durationMs ?? 0),
    extractor: "local-ai+algorithm",
    ...(localResult.modelId ? { modelId: localResult.modelId } : {}),
    ...(localResult.modelVersion
      ? { modelVersion: localResult.modelVersion }
      : {}),
  };
};

export const extractKeywordsWithFrontmatter = (
  note: Pick<
    KnowledgeNote,
    "title" | "content" | "headings" | "tags" | "aliases"
  >,
  options: KeywordExtractionOptions = {},
): KeywordExtractionResult => {
  const startedAt = performance.now();
  const frontmatter = parseFrontmatterKeywords(note.content);
  if (!frontmatter.length) return extractKeywords(note, options);
  const local = extractKeywords(note, options);
  const topN = Math.max(0, options.topN ?? 20);
  const keywords = [...frontmatter, ...local.keywords]
    .filter(
      (keyword, index, all) =>
        all.findIndex((item) => item.normalized === keyword.normalized) ===
        index,
    )
    .slice(0, topN);
  return {
    keywords,
    algorithm: "combined",
    topN,
    durationMs: Math.max(0, performance.now() - startedAt),
    extractor: "frontmatter",
  };
};
