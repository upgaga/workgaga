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

const splitKeywordParts = (value: string, separator: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
};

const parseKeywordValue = (value: string): KnowledgeKeyword[] => {
  const input = value.trim();
  if (!input) return [];
  if (input.startsWith("[") && input.endsWith("]")) {
    const body = input.slice(1, -1).trim();
    if (!body) return [];
    return splitKeywordParts(body, ",").flatMap((item) =>
      parseKeywordValue(item),
    );
  }
  if (/^name\s*:/i.test(input)) {
    const nameMatch = input.match(
      /^name\s*:\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(.+?))(?=\s+parent\s*:|$)/i,
    );
    const parentMatch = input.match(
      /\bparent\s*:\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(.+))$/i,
    );
    const text = nameMatch
      ? unquote(nameMatch[1] ?? nameMatch[2] ?? nameMatch[3])
      : "";
    const parent = parentMatch
      ? unquote(parentMatch[1] ?? parentMatch[2] ?? parentMatch[3])
      : "";
    return text
      ? [
          {
            text,
            normalized: normalizeKeyword(text),
            ...(parent
              ? { parent, parentNormalized: normalizeKeyword(parent) }
              : {}),
          },
        ]
      : [];
  }
  if (input.startsWith("{") && input.endsWith("}")) {
    const body = input.slice(1, -1).trim();
    if (!body) return [];
    const nameMatch = body.match(/(?:^|,)\s*name\s*:\s*([^,]+)/i);
    if (nameMatch) {
      const parentMatch = body.match(/(?:^|,)\s*parent\s*:\s*([^,]+)/i);
      const text = unquote(nameMatch[1]);
      const parent = parentMatch ? unquote(parentMatch[1]) : "";
      return text
        ? [
            {
              text,
              normalized: normalizeKeyword(text),
              ...(parent
                ? { parent, parentNormalized: normalizeKeyword(parent) }
                : {}),
            },
          ]
        : [];
    }
    return splitKeywordParts(body, ",").flatMap((item) => {
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
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
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
        let itemValue = item[1];
        let consumed = next;
        if (/^name\s*:/i.test(itemValue)) {
          const parentLine = lines[next + 1]?.match(/^\s+parent\s*:\s*(.+)$/i);
          if (parentLine) {
            itemValue = `${itemValue} parent: ${parentLine[1]}`;
            consumed = next + 1;
          }
        }
        values.push(...parseKeywordValue(itemValue));
        index = consumed;
        next = consumed;
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
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const normalizedContent = content.replace(/^\uFEFF/, "");
  const newline = normalizedContent.includes("\r\n") ? "\r\n" : "\n";
  const values = keywords
    .map((keyword) => {
      if (typeof keyword === "string") return JSON.stringify(cleanKeyword(keyword));
      const text = cleanKeyword(keyword.text);
      const parent = keyword.parent ? cleanKeyword(keyword.parent) : "";
      return parent
        ? `{ name: ${JSON.stringify(text)}, parent: ${JSON.stringify(parent)} }`
        : JSON.stringify(text);
    })
    .filter((value) => value !== '""');
  const line = `keywords: [${values.join(", ")}]`;
  const lines = normalizedContent.split(/\r?\n/);
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
        let blockEnd = existing + 1;
        while (
          blockEnd < end &&
          (/^\s+-\s+/.test(lines[blockEnd]) || /^\s{2,}\w+\s*:/.test(lines[blockEnd]))
        ) {
          blockEnd += 1;
        }
        if (blockEnd > existing + 1) lines.splice(existing + 1, blockEnd - existing - 1);
      } else {
        lines.splice(end, 0, line);
      }
      return `${bom}${lines.join(newline)}`;
    }
  }
  return `${bom}---${newline}${line}${newline}---${newline}${normalizedContent}`;
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
