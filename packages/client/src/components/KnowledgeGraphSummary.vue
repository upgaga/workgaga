<template>
  <section class="graph-summary-panel">
    <div class="summary-icon">G</div>
    <div class="summary-copy">
      <strong>{{ t('knowledgeGraph') }}</strong>
      <span v-if="graphStore.loading">{{ t('indexing') }}</span>
      <span v-else-if="graphStore.error" class="error">{{ t('indexComplete') }}</span>
      <span v-else
        >{{ graphStore.noteCount }} {{ t('documents') }} ·
        {{ graphStore.linkCount }} {{ t('connections') }}</span
      >
    </div>
    <button
      class="open-button"
      :disabled="graphStore.loading"
      @click="openGraph"
    >
      {{ t('open') }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { useKnowledgeGraphStore } from "../store";
import { useI18n } from "./composables/useI18n";

const graphStore = useKnowledgeGraphStore();
const { t } = useI18n();

const openGraph = (): void => {
  window.dispatchEvent(
    new CustomEvent("switch-main-view", { detail: { view: "knowledgeGraph" } }),
  );
};
</script>

<style scoped>
.graph-summary-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px;
  padding: 12px;
  border: 1px solid #dfe6f0;
  border-radius: 10px;
  background: #fff;
}

.summary-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background: #e8efff;
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
}

.summary-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.summary-copy strong {
  color: #1f2937;
  font-size: 12px;
}

.summary-copy span {
  overflow: hidden;
  color: #718096;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-copy .error {
  color: #b91c1c;
}

.open-button {
  border: 1px solid #2563eb;
  border-radius: 7px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  font-size: 11px;
  padding: 5px 9px;
}

.open-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
