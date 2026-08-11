<template>
  <div class="knowledge-graph-panel">
    <div v-if="graphStore.loading" class="empty-state">正在识别知识图谱...</div>
    <div v-else-if="graphStore.error" class="empty-state error">
      {{ graphStore.error }}
    </div>
    <div v-else-if="!graphStore.vaultPath" class="empty-state">
      请先打开知识库
    </div>
    <template v-else>
      <section class="graph-card">
        <div class="graph-heading">
          <div>
            <div class="graph-label">知识图谱</div>
            <h4>{{ graphStore.vaultName }}</h4>
          </div>
          <button :disabled="graphStore.loading" @click="refreshGraph">
            刷新
          </button>
        </div>
        <div class="indexed-time">{{ indexedTimeText }}</div>
        <div v-if="graphData?.indexStats" class="index-stats">
          {{
            graphData.indexStats.mode === "incremental"
              ? "增量索引"
              : "全量索引"
          }}： {{ graphData.indexStats.durationMs }}ms， 变化
          {{ graphData.indexStats.changedFiles }}， 知识库
          {{ graphStore.vaults.length }} 个，未变化
          {{ graphData.indexStats.unchangedFiles }}， 删除
          {{ graphData.indexStats.deletedFiles }}，失败
          {{ graphData.indexStats.failedFiles }}
        </div>
        <div
          v-if="graphData?.indexStats?.warnings.length"
          class="index-warnings"
        >
          部分文件未识别：{{ graphData.indexStats.warnings.length }}
          项
        </div>
        <div class="graph-summary">
          <div class="summary-item">
            <span class="summary-value">{{ graphStore.noteCount }}</span>
            <span class="summary-label">文档</span>
          </div>
          <div class="summary-item">
            <span class="summary-value">{{ graphStore.linkCount }}</span>
            <span class="summary-label">连接</span>
          </div>
          <div class="summary-item">
            <span class="summary-value">{{ graphStore.missingCount }}</span>
            <span class="summary-label">缺失</span>
          </div>
        </div>
      </section>

      <section class="graph-section graph-visual-section">
        <div class="section-header">
          <h4>关系图</h4>
          <button
            class="reset-chart-button"
            :disabled="graphStore.loading || !graphData"
            @click="resetChart"
          >
            重置视图
          </button>
        </div>
        <div class="graph-controls">
          <label>
            布局
            <select v-model="layoutMode">
              <option value="hierarchy">分级布局</option>
              <option value="force">关系布局</option>
            </select>
          </label>
          <label v-if="layoutMode === 'hierarchy'">
            展示层级
            <select v-model.number="visibleHierarchyLevel">
              <option
                v-for="level in hierarchyLevelOptions"
                :key="level"
                :value="level"
              >
                0 - {{ level }} 层
              </option>
            </select>
          </label>
          <button
            v-if="layoutMode === 'hierarchy'"
            class="text-button"
            @click="expandNextLevel"
          >
            展开下一层
          </button>
          <button
            v-if="layoutMode === 'hierarchy' && collapsedNodeIds.size"
            class="text-button"
            @click="collapsedNodeIds = new Set()"
          >
            展开全部分支
          </button>
          <label>
            关系
            <select v-model="selectedLinkType">
              <option value="all">全部</option>
              <option value="wiki">Wiki Link</option>
              <option value="markdown">Markdown Link</option>
              <option value="contains">标题层级</option>
              <option value="tagged_with">标签</option>
              <option value="mentions">关键词</option>
              <option value="related_by_keyword">共享关键词</option>
              <option value="parent_of">关键词层级</option>
            </select>
          </label>
          <label>
            节点
            <select v-model="selectedCategory">
              <option value="all">全部</option>
              <option value="note">文档</option>
              <option value="heading">标题</option>
              <option value="tag">标签</option>
              <option value="keyword">关键词</option>
              <option value="missing">缺失</option>
            </select>
          </label>
          <label>
            范围
            <select v-model.number="neighborhoodDepth">
              <option :value="0">全图</option>
              <option :value="1">一跳</option>
              <option :value="2">两跳</option>
              <option :value="3">三跳</option>
            </select>
          </label>
          <button
            v-if="selectedNodeId"
            class="text-button"
            @click="selectedNodeId = null"
          >
            取消聚焦
          </button>
        </div>
        <div
          ref="chartContainer"
          class="graph-chart"
          aria-label="知识图谱关系图"
        />
      </section>

      <section v-if="props.showSecondaryLists" class="graph-section">
        <div class="section-header">
          <h4>缺失链接</h4>
          <span>{{ missingNodes.length }} 项</span>
        </div>
        <div v-if="missingNodes.length === 0" class="empty-inline">
          没有发现缺失链接。
        </div>
        <ul v-else class="missing-list">
          <li v-for="node in missingNodes" :key="node.id">
            <strong>{{ node.name }}</strong>
            <span>{{ node.relativePath }}</span>
          </li>
        </ul>
      </section>

      <section
        v-if="props.showSecondaryLists && selectedNodeId"
        class="graph-section"
      >
        <div class="section-header">
          <h4>反向链接</h4>
          <span>{{ incomingLinks.length }} 条</span>
        </div>
        <div v-if="incomingLinks.length === 0" class="empty-inline">
          暂无反向链接。
        </div>
        <ul v-else class="link-list">
          <li v-for="link in incomingLinks" :key="`${link.source}-${link.raw}`">
            <button :title="link.source" @click="openNodeSource(link.source)">
              {{ nodesById.get(link.source)?.name || link.source }}
            </button>
          </li>
        </ul>
      </section>

      <section v-if="props.showSecondaryLists" class="graph-section">
        <div class="section-header">
          <h4>连接关系</h4>
          <span>{{ graphStore.linkCount }} 条</span>
        </div>
        <div v-if="linkItems.length === 0" class="empty-inline">
          暂无文档连接。
        </div>
        <ul v-else class="link-list">
          <li v-for="link in linkItems" :key="link.key">
            <button
              :title="link.sourcePath"
              @click="openDocument(link.sourcePath)"
            >
              {{ link.sourceName }}
            </button>
            <span>→</span>
            <button
              v-if="link.targetPath"
              :title="link.targetPath"
              @click="openDocument(link.targetPath)"
            >
              {{ link.targetName }}
            </button>
            <strong v-else>{{ link.targetName }}</strong>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import * as echarts from "echarts/core";
import { GraphChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import type { EChartsType } from "echarts/core";
import type { CallbackDataParams } from "echarts/types/dist/shared";
import type {
  KnowledgeGraphData,
  KnowledgeGraphLinkType,
  KnowledgeGraphNodeCategory,
} from "./types";
import {
  analyzeKnowledgeGraphHierarchy,
  getIncomingKnowledgeGraphLinks,
  getKnowledgeGraphNeighborhood,
  projectKnowledgeGraphHierarchy,
} from "../utils/knowledgeGraph";
import { useKnowledgeGraphStore } from "../store/modal/knowledgeGraph";

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);

const props = withDefaults(
  defineProps<{
    graphData?: KnowledgeGraphData | null;
    showSecondaryLists?: boolean;
  }>(),
  { showSecondaryLists: true, graphData: null },
);

const emit = defineEmits<{
  nodeSelected: [nodeId: string];
}>();

const graphStore = useKnowledgeGraphStore();
const graphData = computed(() => props.graphData ?? graphStore.graphData);
const chartContainer = ref<HTMLDivElement | null>(null);
const selectedNodeId = ref<string | null>(null);
const selectedCategory = ref<KnowledgeGraphNodeCategory | "all">("all");
const selectedLinkType = ref<KnowledgeGraphLinkType | "all">("all");
const neighborhoodDepth = ref(0);
const layoutMode = ref<"hierarchy" | "force">("force");
const visibleHierarchyLevel = ref(1);
const collapsedNodeIds = ref<Set<string>>(new Set());
let chart: EChartsType | null = null;
let resizeObserver: ResizeObserver | null = null;
let renderRequestId = 0;

const nodesById = computed(
  () => new Map((graphData.value?.nodes || []).map((node) => [node.id, node])),
);

const missingNodes = computed(() =>
  (graphData.value?.nodes || [])
    .filter((node) => !node.exists)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
);

const indexedTimeText = computed(() => {
  if (!graphStore.lastIndexedAt) return "尚未完成索引";
  return `最近索引：${new Date(graphStore.lastIndexedAt).toLocaleString()}`;
});

const visibleGraph = computed(() => {
  if (!graphData.value) return null;
  const categories =
    selectedCategory.value === "all"
      ? undefined
      : new Set<KnowledgeGraphNodeCategory>([selectedCategory.value]);
  const filtered = getKnowledgeGraphNeighborhood(graphData.value, {
    rootId: selectedNodeId.value || undefined,
    depth: selectedNodeId.value ? neighborhoodDepth.value : 0,
    categories,
    linkTypes:
      selectedLinkType.value === "all"
        ? undefined
        : new Set<KnowledgeGraphLinkType>([selectedLinkType.value]),
  });
  if (layoutMode.value !== "hierarchy") return filtered;
  const hierarchy = analyzeKnowledgeGraphHierarchy(filtered);
  return projectKnowledgeGraphHierarchy(filtered, hierarchy, {
    maxLevel: visibleHierarchyLevel.value,
    collapsedNodeIds: collapsedNodeIds.value,
  });
});

const hierarchy = computed(() =>
  analyzeKnowledgeGraphHierarchy(
    graphData.value || { nodes: [], links: [], indexedAt: 0 },
  ),
);
const hierarchyLevelOptions = computed(() =>
  Array.from({ length: hierarchy.value.maxLevel + 1 }, (_, level) => level),
);
const expandNextLevel = (): void => {
  visibleHierarchyLevel.value = Math.min(
    hierarchy.value.maxLevel,
    visibleHierarchyLevel.value + 1,
  );
};

const incomingLinks = computed(() =>
  selectedNodeId.value && graphData.value
    ? getIncomingKnowledgeGraphLinks(graphData.value, selectedNodeId.value)
    : [],
);

const openNodeSource = (nodeId: string): void => {
  const node = nodesById.value.get(nodeId);
  if (node?.path) openDocument(node.path);
};

const linkItems = computed(() =>
  (graphData.value?.links || []).map((link) => {
    const source = nodesById.value.get(link.source);
    const target = nodesById.value.get(link.target);
    return {
      key: `${link.source}-${link.target}-${link.raw}`,
      sourceName: source?.name || link.source,
      sourcePath: source?.path || "",
      targetName: target?.name || link.target,
      targetPath: target?.exists ? target.path || "" : "",
    };
  }),
);

const chartOption = computed<EChartsOption>(() => {
  const rawNodes = visibleGraph.value?.nodes || [];
  const rawLinks = visibleGraph.value?.links || [];

  const seenNodeIds = new Set<string>();
  const dedupNodes = rawNodes.filter((node) => {
    if (seenNodeIds.has(node.id)) return false;
    seenNodeIds.add(node.id);
    return true;
  });

  const seenLinkIds = new Set<string>();
  const dedupLinks = rawLinks.filter((link) => {
    const id = `${link.source}->${link.target}:${link.type}:${link.raw}`;
    if (seenLinkIds.has(id)) return false;
    seenLinkIds.add(id);
    return true;
  });

  const degree = new Map<string, number>();
  dedupLinks.forEach((link) => {
    degree.set(link.source, (degree.get(link.source) || 0) + 1);
    degree.set(link.target, (degree.get(link.target) || 0) + 1);
  });
  const currentHierarchy = analyzeKnowledgeGraphHierarchy({
    nodes: dedupNodes,
    links: dedupLinks,
    indexedAt: graphData.value?.indexedAt || 0,
  });
  const nodesByLevel = new Map<number, typeof dedupNodes>();
  dedupNodes.forEach((node) => {
    const level = currentHierarchy.levels.get(node.id) || 0;
    nodesByLevel.set(level, [...(nodesByLevel.get(level) || []), node]);
  });
  const levelColors = ["#1d4ed8", "#0891b2", "#7c3aed", "#ca8a04", "#dc2626", "#059669"];
  const positionedNodes = dedupNodes.map((node) => {
    const level = currentHierarchy.levels.get(node.id) || 0;
    const levelNodes = nodesByLevel.get(level) || [];
    const index = levelNodes.findIndex((item) => item.id === node.id);
    const spacing = 150;
    return {
      node,
      level,
      x: (index - (levelNodes.length - 1) / 2) * spacing,
      y: level * 140,
    };
  });

  return {
    animationDuration: 350,
    tooltip: {
      trigger: "item",
      formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
        const item = Array.isArray(params) ? params[0] : params;
        const data = item.data as
          | {
              name?: string;
              relativePath?: string;
              exists?: boolean;
              type?: KnowledgeGraphLinkType;
              raw?: string;
            }
          | undefined;
        if (!data) return "";
        if (item.dataType === "edge") {
          const labels: Partial<Record<KnowledgeGraphLinkType, string>> = {
            parent_of: "关键词层级",
            related_by_keyword: "共享关键词",
            mentions: "关键词引用",
            tagged_with: "标签引用",
            contains: "标题层级",
            wiki: "Wiki Link",
            markdown: "Markdown Link",
          };
          return `${labels[data.type || "wiki"] || "关系"}<br/>${data.raw || ""}`;
        }
        const status = data.exists === false ? "<br/>状态：缺失" : "";
        return `${data.name || ""}<br/>${data.relativePath || ""}${status}`;
      },
    },
    series: [
      {
        type: "graph",
        layout: layoutMode.value === "hierarchy" ? "none" : "force",
        roam: true,
        draggable: true,
        data: positionedNodes.map(({ node, level, x, y }) => ({
          id: node.id,
          name: node.name,
          relativePath: node.relativePath,
          exists: node.exists,
          level,
          x: layoutMode.value === "hierarchy" ? x : undefined,
          y: layoutMode.value === "hierarchy" ? y : undefined,
          value: degree.get(node.id) || 0,
          symbolSize: Math.min(42, 18 + (degree.get(node.id) || 0) * 2),
          itemStyle: {
            color: layoutMode.value === "hierarchy"
              ? levelColors[level % levelColors.length]
              : node.category === "tag"
                ? "#ca8a04"
                : node.category === "keyword"
                  ? "#0891b2"
                  : node.category === "heading"
                    ? "#7c3aed"
                    : node.exists
                      ? "#2563eb"
                      : "#dc2626",
          },
          label: {
            show: dedupNodes.length <= 120,
            position: level === 0 ? "top" : "bottom",
            formatter: `{b}\nL${level}`,
          },
        })),
        links: dedupLinks.map((link) => ({
          id: `${link.source}->${link.target}:${link.type}:${link.raw}`,
          source: link.source,
          target: link.target,
          type: link.type,
          raw: link.raw,
          lineStyle: {
            curveness:
              link.type === "related_by_keyword"
                ? 0.2
                : link.type === "parent_of"
                  ? 0.14
                  : 0.08,
            type: link.type === "parent_of" ? "dashed" : "solid",
          },
        })),
        lineStyle: { color: "#94a3b8", opacity: 0.65 },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 6,
        force:
          layoutMode.value === "force"
            ? { repulsion: 260, edgeLength: 100, gravity: 0.08 }
            : undefined,
        emphasis: { focus: "adjacency", lineStyle: { width: 2 } },
      },
    ],
  };
});

const renderChart = async (): Promise<void> => {
  const requestId = ++renderRequestId;
  await nextTick();
  if (requestId !== renderRequestId) return;
  const container = chartContainer.value;
  if (!container) return;

  if (container.clientWidth === 0 || container.clientHeight === 0) {
    requestAnimationFrame(() => {
      if (requestId === renderRequestId) void renderChart();
    });
    return;
  }
  if (requestId !== renderRequestId) return;

  if (!chart) {
    chart = echarts.init(container, undefined, {
      renderer: "canvas",
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chart.on("click", handleChartClick);
  }
  if (requestId !== renderRequestId) return;

  const optionSnapshot = chartOption.value;

  try {
    chart.clear();
    if (requestId !== renderRequestId) return;
    chart.setOption(optionSnapshot, true);
    chart.resize({
      width: container.clientWidth,
      height: container.clientHeight,
    });
  } catch (_err) {
    try {
      chart.off("click", handleChartClick);
      chart.dispose();
    } catch (_) { /* noop */ }
    chart = echarts.init(container, undefined, {
      renderer: "canvas",
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chart.on("click", handleChartClick);
    try {
      chart.setOption(optionSnapshot, true);
      chart.resize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    } catch (_err2) { /* noop */ }
  }
};

const resetChart = (): void => {
  chart?.dispatchAction({ type: "restore" });
};

const handleChartClick = (params: unknown): void => {
  if (!params || typeof params !== "object") return;
  const event = params as { dataType?: string; data?: { id?: string } };
  if (event.dataType !== "node" || !event.data?.id) return;
  if (
    layoutMode.value === "hierarchy" &&
    hierarchy.value.childIds.has(event.data.id)
  ) {
    const next = new Set(collapsedNodeIds.value);
    if (next.has(event.data.id)) next.delete(event.data.id);
    else next.add(event.data.id);
    collapsedNodeIds.value = next;
  }
  selectedNodeId.value = event.data.id;
  emit("nodeSelected", event.data.id);
  if (neighborhoodDepth.value === 0) neighborhoodDepth.value = 1;
  const node = nodesById.value.get(event.data.id);
  if (node?.category === "note" && node.path) openDocument(node.path);
};

const refreshGraph = async (): Promise<void> => {
  await graphStore.refresh();
};

watch(chartOption, () => {
  void renderChart();
});

watch(
  () => hierarchy.value.maxLevel,
  (maxLevel) => {
    visibleHierarchyLevel.value = Math.min(
      Math.max(1, visibleHierarchyLevel.value),
      maxLevel,
    );
    collapsedNodeIds.value = new Set(
      [...collapsedNodeIds.value].filter((id) => hierarchy.value.childIds.has(id)),
    );
  },
  { immediate: true },
);

onMounted(() => {
  void renderChart();
  if (chartContainer.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(chartContainer.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  chart?.off("click", handleChartClick);
  chart?.dispose();
  chart = null;
});

const openDocument = (path: string): void => {
  if (!path) return;
  window.dispatchEvent(
    new CustomEvent("open-dashboard-link", { detail: { path } }),
  );
};

defineExpose({
  refreshGraph,
});
</script>

<style scoped>
.knowledge-graph-panel {
  min-height: 0;
  height: auto;
  padding: 14px;
  box-sizing: border-box;
  overflow: auto;
  background: #ffffff;
}

.empty-state {
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.empty-state.error {
  color: #dc2626;
}

.graph-card,
.graph-section {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f9fafb;
  padding: 12px;
}

.graph-section {
  margin-top: 12px;
}

.graph-visual-section {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.graph-chart {
  height: clamp(360px, 62vh, 720px);
  min-height: 360px;
  margin-top: 8px;
}

.graph-controls > .text-button {
  border: 1px solid #bae6fd;
  border-radius: 6px;
  background: #ecfeff;
  color: #0e7490;
}

.graph-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.graph-controls label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #6b7280;
  font-size: 11px;
}

.graph-controls select {
  border: 1px solid #d8dee9;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: 11px;
  padding: 4px 6px;
}

.text-button {
  border: none;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font-size: 11px;
  padding: 4px;
}

.reset-chart-button {
  border: 1px solid #d8dee9;
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
  cursor: pointer;
  font-size: 12px;
  padding: 5px 8px;
}

.reset-chart-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.graph-heading,
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.graph-label,
.indexed-time,
.section-header span,
.empty-inline {
  color: #6b7280;
  font-size: 12px;
}

.graph-heading h4,
.section-header h4 {
  margin: 2px 0 0;
  color: #111827;
  font-size: 14px;
}

.graph-heading button {
  border: 1px solid #d8dee9;
  border-radius: 8px;
  background: #f3f6fb;
  color: #1f2937;
  cursor: pointer;
  font-size: 12px;
  padding: 6px 10px;
}

.graph-heading button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.indexed-time {
  margin-top: 8px;
}

.index-stats {
  margin-top: 4px;
  color: #6b7280;
  font-size: 11px;
  line-height: 1.5;
}

.index-warnings {
  margin-top: 6px;
  color: #b45309;
  font-size: 11px;
}

.graph-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 12px;
}

.summary-item {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}

.summary-value {
  display: block;
  color: #111827;
  font-size: 20px;
  font-weight: 600;
}

.summary-label {
  color: #6b7280;
  font-size: 12px;
}

.missing-list,
.link-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.missing-list li,
.link-list li {
  border-bottom: 1px solid #edf0f5;
  padding: 8px 0;
}

.missing-list strong,
.missing-list span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.missing-list strong {
  color: #991b1b;
  font-size: 12px;
}

.missing-list span {
  color: #6b7280;
  font-size: 11px;
}

.link-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: #6b7280;
  font-size: 12px;
}

.link-list button,
.link-list strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-list button {
  border: none;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  padding: 0;
}

.link-list strong {
  color: #991b1b;
  font-weight: 500;
}
</style>
