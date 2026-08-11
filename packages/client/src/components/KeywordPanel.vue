<template>
  <div class="metadata-panel-host">
    <aside class="keyword-panel">
      <header class="panel-header">
        <div class="panel-heading">
          <span aria-hidden="true">标签/元数据</span>
          <span class="panel-summary"
            >{{ props.tags.length }} 个标签 ·
            {{ keywordList.length }} 个关键词</span
          >
        </div>
        <button
          class="collapse-button"
          aria-expanded="true"
          aria-controls="keyword-panel-content"
          aria-label="收起标签和元数据"
          title="收起标签和元数据"
          @click="emit('update:visible', false)"
        >
          收起
        </button>
      </header>
      <div id="keyword-panel-content" class="panel-content">
        <section class="tag-section keyword-section">
          <div class="section-title">
            <strong>文档标签</strong>
            <button
              class="text-button"
              title="添加标签"
              aria-label="添加标签"
              @click="startAddingTag"
            >
              添加
            </button>
          </div>
          <form
            v-if="tagEditing"
            class="keyword-form"
            @submit.prevent="submitTag"
          >
            <input
              v-model="tagEditingText"
              autofocus
              placeholder="输入标签"
              @keydown.esc="cancelTagEditing"
            />
            <button type="submit">确定</button>
            <button type="button" class="secondary" @click="cancelTagEditing">
              取消
            </button>
          </form>
          <div v-if="props.tags.length === 0" class="empty">暂未添加标签</div>
          <TransitionGroup v-else name="tag" tag="div" class="tag-list">
            <span v-for="tag in props.tags" :key="tag" class="tag-chip">
              <button
                class="tag-label"
                title="编辑标签"
                :aria-label="`编辑标签 ${tag}`"
                @click="startEditingTag(tag)"
              >
                {{ tag }}
              </button>
              <button
                class="tag-remove"
                title="删除标签"
                :aria-label="`删除标签 ${tag}`"
                @click="removeTag(tag)"
              >
                ×
              </button>
            </span>
          </TransitionGroup>
          <div v-if="deletedTag" class="undo-banner" role="status">
            已删除标签“{{ deletedTag }}”
            <button
              title="撤销删除标签"
              aria-label="撤销删除标签"
              @click="undoRemoveTag"
            >
              撤销
            </button>
          </div>
        </section>

        <div class="panel-title">
          <h3>文档关键词</h3>
          <span>{{ keywordList.length }} 项</span>
        </div>
        <section class="keyword-section">
          <div class="section-title">
            <strong>手动关键词</strong
            ><button
              class="text-button"
              title="添加关键词"
              aria-label="添加关键词"
              @click="startAdding"
            >
              添加
            </button>
          </div>
          <form
            v-if="editing"
            class="keyword-form"
            @submit.prevent="submitKeyword"
          >
            <input
              v-model="editingText"
              autofocus
              placeholder="输入关键词"
              @keydown.esc="cancelEditing"
            />
            <select v-model="editingParent">
              <option value="">无父级</option>
              <option
                v-for="parent in parentKeywordOptions"
                :key="parent.normalized || parent.text"
                :value="parent.normalized || normalizeKeyword(parent.text)"
              >
                {{ parent.text }}
              </option>
            </select>
            <span v-if="keywordValidationMessage" class="keyword-validation">
              {{ keywordValidationMessage }}
            </span>
            <button type="submit">确定</button><button type="button" class="secondary" @click="cancelEditing">
              取消
            </button>
          </form>
          <div v-if="keywordList.length === 0" class="empty">
            暂未添加关键词
          </div>
          <ul v-else class="keyword-list">
            <li
              v-for="item in keywordTree"
              :key="item.keyword.normalized || item.keyword.text"
              :style="{ '--keyword-depth': item.depth }"
            >
              <span class="keyword-tree-branch" aria-hidden="true">
                {{ item.depth > 0 ? "└" : "" }}
              </span>
              <span class="keyword-text">
                {{ item.keyword.text }}
                <small v-if="item.keyword.parent">父级：{{ item.keyword.parent }}</small>
                <small v-if="item.childCount">子级：{{ item.childCount }}</small>
              </span>
              <span class="keyword-actions"
                ><button
                  title="编辑关键词"
                  aria-label="编辑关键词"
                  @click="startEditing(item.keyword.text)"
                >
                  编辑</button
                ><button
                  title="删除关键词"
                  aria-label="删除关键词"
                  @click="removeKeyword(item.keyword.text)"
                >
                  删除
                </button></span
              >
            </li>
          </ul>
        </section>
        <section class="keyword-section">
          <div class="section-title">
            <strong>关键词识别候选</strong
            ><button
              class="text-button"
              title="重新识别关键词"
              aria-label="重新识别关键词"
              :disabled="!props.markdown || extracting"
              @click="refreshCandidates"
            >
              {{ extracting ? "识别中..." : "重新识别" }}
            </button>
          </div>
          <div v-if="extractionMessage" class="extraction-message">
            {{ extractionMessage }}
          </div>
          <div v-if="lastExtraction" class="extraction-meta">
            最近识别：{{ lastExtraction.durationMs?.toFixed(1) || "0.0" }}ms ·
            {{ extractionPath
            }}<span v-if="lastExtraction.degraded"> · 已降级</span>
          </div>
          <div v-if="candidates.length === 0" class="empty">
            暂无新的候选关键词
          </div>
          <ul v-else class="candidate-list">
            <li
              v-for="candidate in candidates"
              :key="candidate.normalized || candidate.text"
            >
              <div>
                <span class="keyword-text">{{ candidate.text }}</span
                ><small v-if="candidate.score"
                  >评分 {{ candidate.score.toFixed(1) }}</small
                >
              </div>
              <span class="keyword-actions"
                ><button
                  title="确认候选关键词"
                  aria-label="确认候选关键词"
                  @click="acceptCandidate(candidate)"
                >
                  确认</button
                ><button
                  title="忽略候选关键词"
                  aria-label="忽略候选关键词"
                  @click="ignoreCandidate(candidate)"
                >
                  忽略
                </button></span
              >
            </li>
          </ul>
        </section>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useFileStore, useAIAssistantStore } from "../store";
import type { KnowledgeKeyword } from "./types";
import {
  extractKeywordsWithFrontmatter,
  normalizeKeyword,
} from "../utils/keywordExtraction";

const props = withDefaults(
  defineProps<{
    markdown?: string;
    keywords?: KnowledgeKeyword[];
    tags?: string[];
    ignored?: string[];
    visible?: boolean;
  }>(),
  { markdown: "", keywords: () => [], tags: () => [], ignored: () => [] },
);

const emit = defineEmits<{
  "update:keywords": [keywords: KnowledgeKeyword[]];
  "update:tags": [tags: string[]];
  "update:ignored": [ignored: string[]];
  "update:visible": [visible: boolean];
}>();

const fileStore = useFileStore();
const aiAssistantStore = useAIAssistantStore();
const extracting = ref(false);
const extractionMessage = ref("");
const editing = ref(false);
const editingText = ref("");
const editingOriginal = ref<string | null>(null);
const editingParent = ref("");
const keywordValidationMessage = ref("");
const tagEditing = ref(false);
const tagEditingText = ref("");
const tagEditingOriginal = ref<string | null>(null);
const candidates = ref<KnowledgeKeyword[]>([]);
const lastExtraction = ref<Awaited<
  ReturnType<typeof aiAssistantStore.extractKeywordsWithConfiguredMode>
> | null>(null);
const deletedTag = ref<string | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

const keywordList = computed(() => props.keywords);
const keywordTree = computed(() => {
  const byId = new Map(
    props.keywords.map((keyword) => [
      normalizeKeyword(keyword.normalized || keyword.text),
      keyword,
    ]),
  );
  const children = new Map<string, KnowledgeKeyword[]>();
  const roots: KnowledgeKeyword[] = [];
  props.keywords.forEach((keyword) => {
    const parentId = normalizeKeyword(
      keyword.parentNormalized || keyword.parent || "",
    );
    if (!parentId || !byId.has(parentId)) {
      roots.push(keyword);
      return;
    }
    children.set(parentId, [...(children.get(parentId) || []), keyword]);
  });
  const result: Array<{
    keyword: KnowledgeKeyword;
    depth: number;
    childCount: number;
  }> = [];
  const visited = new Set<string>();
  const append = (keyword: KnowledgeKeyword, depth: number): void => {
    const id = normalizeKeyword(keyword.normalized || keyword.text);
    if (!id || visited.has(id)) return;
    visited.add(id);
    const childItems = children.get(id) || [];
    result.push({ keyword, depth, childCount: childItems.length });
    childItems.forEach((child) => append(child, depth + 1));
  };
  roots.forEach((keyword) => append(keyword, 0));
  props.keywords.forEach((keyword) => append(keyword, 0));
  return result;
});

const getDescendantIds = (rootId: string): Set<string> => {
  const descendants = new Set<string>();
  if (!rootId) return descendants;
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    props.keywords.forEach((keyword) => {
      const keywordId = normalizeKeyword(keyword.normalized || keyword.text);
      const parentId = normalizeKeyword(
        keyword.parentNormalized || keyword.parent || "",
      );
      if (parentId === current && !descendants.has(keywordId)) {
        descendants.add(keywordId);
        queue.push(keywordId);
      }
    });
  }
  return descendants;
};

const parentKeywordOptions = computed(() =>
  props.keywords.filter((keyword) => {
    const currentId = normalizeKeyword(
      editingOriginal.value || editingText.value || "",
    );
    const keywordId = normalizeKeyword(keyword.normalized || keyword.text);
    return keywordId !== currentId && !getDescendantIds(currentId).has(keywordId);
  }),
);
const extractionEnabled = computed(
  () => aiAssistantStore.settings.keywordExtractionEnabled,
);
const ignoredSet = computed(() => new Set(props.ignored.map(normalizeKeyword)));
const extractionPath = computed(() => {
  if (!lastExtraction.value) return "未知路径";
  if (lastExtraction.value.fallback || lastExtraction.value.degraded)
    return "算法回退";
  if (lastExtraction.value.extractor === "llm")
    return `LLM${lastExtraction.value.modelId ? ` (${lastExtraction.value.modelId})` : ""}`;
  if (lastExtraction.value.extractor === "local-ai")
    return `本地 AI${lastExtraction.value.modelId ? ` (${lastExtraction.value.modelId})` : ""}`;
  return "算法";
});

const parseNote = () => {
  const markdown = props.markdown;
  const title =
    markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    fileStore.currentFilePath?.split(/[\\/]/).pop() ||
    "";
  const headings = markdown
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      return match
        ? {
            id: `heading-${index}`,
            text: match[2].trim(),
            level: match[1].length,
          }
        : null;
    })
    .filter((heading): heading is { id: string; text: string; level: number } =>
      Boolean(heading),
    );
  const tags: string[] = [];
  markdown.split(/\r?\n/).forEach((line) => {
    const matches = line.match(/(?:^|\s)#([\w\u3400-\u9fff-]+)/g) || [];
    matches.forEach((match) => tags.push(match.replace(/^.*#/, "")));
  });
  return {
    title,
    content: markdown,
    headings,
    tags,
    aliases: [],
    id: title,
    path: fileStore.currentFilePath || "",
    relativePath: title,
  };
};

const refreshCandidates = async () => {
  if (!props.markdown) {
    candidates.value = [];
    return;
  }
  extracting.value = true;
  extractionMessage.value = "";
  try {
    const extraction = await aiAssistantStore.extractKeywordsWithConfiguredMode(
      {
        note: parseNote(),
        mode: extractionEnabled.value ? undefined : "algorithm",
        options: { topN: aiAssistantStore.settings.maxKeywords },
      },
    );
    lastExtraction.value = extraction;
    const selected = new Set(
      props.keywords.map((keyword) => normalizeKeyword(keyword.text)),
    );
    candidates.value = extraction.keywords.filter(
      (keyword) =>
        !selected.has(normalizeKeyword(keyword.text)) &&
        !ignoredSet.value.has(normalizeKeyword(keyword.text)),
    );
    extractionMessage.value = extraction.degraded
      ? `识别失败，已降级为算法：${extraction.error || "本地算法"}`
      : extraction.mode === "algorithm"
        ? "已使用算法识别"
        : "已使用配置的 AI 识别";
  } catch (error) {
    extractionMessage.value =
      error instanceof Error ? error.message : "识别失败，已降级为算法";
    const extraction = extractKeywordsWithFrontmatter(parseNote(), {
      topN: aiAssistantStore.settings.maxKeywords,
    });
    candidates.value = extraction.keywords;
  } finally {
    extracting.value = false;
  }
};

const startAdding = () => {
  editingOriginal.value = null;
  editingText.value = "";
  editingParent.value = "";
  keywordValidationMessage.value = "";
  editing.value = true;
};

const startEditing = (text: string) => {
  const keyword = props.keywords.find(
    (item) => normalizeKeyword(item.text) === normalizeKeyword(text),
  );
  editingOriginal.value = text;
  editingText.value = text;
  editingParent.value = keyword?.parentNormalized || keyword?.parent || "";
  keywordValidationMessage.value = "";
  editing.value = true;
};

const cancelEditing = () => {
  editing.value = false;
  editingText.value = "";
  editingOriginal.value = null;
  editingParent.value = "";
  keywordValidationMessage.value = "";
};

const startAddingTag = () => {
  tagEditingOriginal.value = null;
  tagEditingText.value = "";
  tagEditing.value = true;
};

const startEditingTag = (tag: string) => {
  tagEditingOriginal.value = tag;
  tagEditingText.value = tag;
  tagEditing.value = true;
};

const cancelTagEditing = () => {
  tagEditing.value = false;
  tagEditingText.value = "";
  tagEditingOriginal.value = null;
};

const submitTag = () => {
  const text = tagEditingText.value.trim().replace(/^#+/, "").trim();
  if (!text) return;
  const original = tagEditingOriginal.value;
  const next = props.tags.filter((tag) => tag !== original && tag !== text);
  next.push(text);
  emit("update:tags", Array.from(new Set(next)));
  cancelTagEditing();
};

const removeTag = (tag: string) => {
  deletedTag.value = tag;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    deletedTag.value = null;
  }, 5000);
  emit(
    "update:tags",
    props.tags.filter((item) => item !== tag),
  );
};

const undoRemoveTag = () => {
  if (!deletedTag.value) return;
  const tag = deletedTag.value;
  if (undoTimer) clearTimeout(undoTimer);
  deletedTag.value = null;
  emit("update:tags", [...props.tags, tag]);
};

const submitKeyword = () => {
  const text = editingText.value.trim();
  if (!text) return;
  const normalized = normalizeKeyword(text);
  const originalId = normalizeKeyword(editingOriginal.value || "");
  const duplicate = props.keywords.some(
    (keyword) =>
      normalizeKeyword(keyword.normalized || keyword.text) === normalized &&
      normalizeKeyword(keyword.normalized || keyword.text) !== originalId,
  );
  if (duplicate) {
    keywordValidationMessage.value = "同一文档内不能创建重复关键词";
    return;
  }
  const parentId = normalizeKeyword(editingParent.value);
  const parent = props.keywords.find(
    (keyword) =>
      normalizeKeyword(keyword.normalized || keyword.text) === parentId,
  );
  if (parentId && !parent) {
    keywordValidationMessage.value = "父关键词不存在";
    return;
  }
  if (parentId && (parentId === originalId || getDescendantIds(originalId).has(parentId))) {
    keywordValidationMessage.value = "不能将当前关键词或其子级设为父级";
    return;
  }
  const original = props.keywords.find(
    (keyword) => normalizeKeyword(keyword.normalized || keyword.text) === originalId,
  );
  const updated: KnowledgeKeyword = {
    ...original,
    text,
    normalized,
    source: "frontmatter",
    ...(parent
      ? {
          parent: parent.text,
          parentNormalized: normalizeKeyword(parent.normalized || parent.text),
        }
      : { parent: undefined, parentNormalized: undefined }),
  };
  const next = props.keywords
    .filter(
      (keyword) => normalizeKeyword(keyword.normalized || keyword.text) !== originalId,
    )
    .map((keyword) => {
      const keywordParentId = normalizeKeyword(
        keyword.parentNormalized || keyword.parent || "",
      );
      return originalId && keywordParentId === originalId
        ? { ...keyword, parent: text, parentNormalized: normalized }
        : keyword;
    });
  next.push(updated);
  emit("update:keywords", next);
  cancelEditing();
  refreshCandidates();
};

const removeKeyword = (text: string) => {
  const removedId = normalizeKeyword(text);
  emit(
    "update:keywords",
    props.keywords
      .filter(
        (keyword) => normalizeKeyword(keyword.text) !== removedId,
      )
      .map((keyword) =>
        normalizeKeyword(keyword.parentNormalized || keyword.parent || "") ===
        removedId
          ? { ...keyword, parent: undefined, parentNormalized: undefined }
          : keyword,
      ),
  );
  refreshCandidates();
};

const acceptCandidate = (candidate: KnowledgeKeyword) => {
  emit("update:keywords", [
    ...props.keywords,
    { ...candidate, source: "frontmatter" },
  ]);
  candidates.value = candidates.value.filter(
    (item) => item.normalized !== candidate.normalized,
  );
};

const ignoreCandidate = (candidate: KnowledgeKeyword) => {
  emit("update:ignored", [
    ...props.ignored,
    candidate.normalized || normalizeKeyword(candidate.text),
  ]);
  candidates.value = candidates.value.filter(
    (item) => item.normalized !== candidate.normalized,
  );
};

watch(
  () => [props.markdown, props.keywords, props.ignored],
  refreshCandidates,
  { immediate: true },
);

onUnmounted(() => {
  if (undoTimer) clearTimeout(undoTimer);
});
</script>

<style scoped>
.metadata-panel-host {
  display: flex;
  flex: 0 0 280px;
  min-width: 248px;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

.keyword-panel {
  width: 100%;
  min-width: 0;
  max-height: 100%;
  overflow: auto;
  background: #fff;
  border-left: 1px solid #e5e7eb;
  color: #374151;
  transition:
    width 180ms ease,
    background-color 180ms ease;
}
.panel-header {
  min-height: 48px;
  box-sizing: border-box;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid #e5e7eb;
}
.panel-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  font-weight: 600;
}
.panel-summary {
  color: #6b7280;
  font-size: 11px;
  font-weight: 400;
}
.collapse-button {
  flex-shrink: 0;
  min-height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 4px 8px;
  background: #fff;
  color: #374151;
  cursor: pointer;
  font-size: 12px;
}
.panel-content {
  padding: 16px;
}
.panel-title,
.section-title,
.keyword-list li,
.candidate-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.panel-title {
  margin-bottom: 18px;
}
h3 {
  margin: 0;
  font-size: 16px;
  color: #111827;
}
.panel-title span,
small {
  color: #9ca3af;
  font-size: 11px;
}
.keyword-section {
  margin-bottom: 22px;
}
.section-title {
  margin-bottom: 9px;
  font-size: 13px;
}
.text-button,
.keyword-actions button {
  border: 0;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.keyword-form {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.keyword-validation {
  flex-basis: 100%;
  color: #dc2626;
  font-size: 11px;
}
input {
  min-width: 0;
  flex: 1;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 5px 7px;
  font-size: 12px;
}
.keyword-form button {
  border: 0;
  border-radius: 4px;
  background: #2563eb;
  color: #fff;
  padding: 4px 7px;
  font-size: 12px;
}
.keyword-form .secondary {
  background: #e5e7eb;
  color: #374151;
}
.keyword-list,
.candidate-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.extraction-message {
  margin: 6px 0;
  color: #b45309;
  font-size: 11px;
}
.keyword-list li,
.candidate-list li {
  padding: 7px 0;
  border-bottom: 1px solid #f3f4f6;
}
.keyword-list li {
  padding-left: calc(var(--keyword-depth) * 16px);
}
.keyword-tree-branch {
  flex: 0 0 12px;
  color: #0891b2;
  font-size: 12px;
}
.keyword-list .keyword-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.candidate-list li {
  align-items: flex-start;
}
.keyword-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.keyword-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}
.candidate-list small {
  display: block;
  margin-top: 2px;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
}
.tag-label,
.tag-remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tag-label {
  overflow: hidden;
  padding: 4px 5px 4px 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-remove {
  min-width: 32px;
  min-height: 32px;
  padding: 3px 8px 3px 3px;
  font-size: 15px;
}
.undo-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 8px;
  border-radius: 4px;
  background: #fef3c7;
  color: #92400e;
  font-size: 12px;
}
.undo-banner button {
  min-height: 32px;
  border: 0;
  background: transparent;
  color: #92400e;
  cursor: pointer;
  font-weight: 600;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.tag-enter-active,
.tag-leave-active {
  transition:
    opacity 0.18s,
    transform 0.18s;
}
.tag-enter-from,
.tag-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
.empty {
  padding: 8px 0;
  color: #9ca3af;
  font-size: 12px;
}
@media (max-width: 720px) {
  .editor-view > .keyword-panel,
  .keyword-panel {
    position: relative;
    z-index: 1;
    max-height: 42vh;
    box-sizing: border-box;
    border-left: 0;
    border-bottom: 1px solid #e5e7eb;
  }
  .panel-content {
    max-height: 42vh;
    overflow: auto;
  }
  .keyword-form {
    flex-wrap: wrap;
  }
}

@media (max-width: 359px) {
  .panel-content {
    max-height: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tag-enter-active,
  .tag-leave-active,
  .tag-move {
    transition: none !important;
  }
}
</style>
