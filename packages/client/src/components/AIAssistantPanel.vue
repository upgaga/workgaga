<template>
  <div class="ai-panel">
    <section class="hero-card">
      <div>
        <div class="eyebrow">{{ t('universalAI') }}</div>
        <h4>{{ t('aiPanelDescription') }}</h4>
      </div>
      <span class="api-pill">{{ t('configureChannelFirst') }}</span>
    </section>

    <nav class="tab-bar">
      <button v-for="tab in tabs" :key="tab.id" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tabLabel(tab.label) }}
      </button>
    </nav>

    <section v-if="activeTab === 'chat'" class="tab-content">
      <div class="context-card">
        <div class="section-title">{{ t('currentContext') }}</div>
        <div class="context-row">
          <span>{{ t('currentDocument') }}</span><strong>{{ currentFileName }}</strong>
        </div>
        <div class="context-row">
          <span>{{ t('currentKnowledgeBase') }}</span><strong>{{ knowledgeGraphStore.vaultName || t('notOpen') }}</strong>
        </div>
        <div class="context-grid">
          <div>
            <strong>{{ knowledgeGraphStore.noteCount }}</strong>
            <span>{{ t('documents') }}</span>
          </div>
          <div>
            <strong>{{ knowledgeGraphStore.linkCount }}</strong>
            <span>{{ t('connection') }}</span>
          </div>
          <div>
            <strong>{{ taskCounts.running }}</strong
            ><span>{{ t('inProgress') }}</span>

          </div>
        </div>
      </div>

      <div class="composer-card">
        <textarea
          v-model="userInput"
          :placeholder="t('newTaskPlaceholder')"
        />
        <div class="quick-actions">
          <button v-for="action in quickActions" :key="action" @click="userInput = action">{{ action }}</button>
        </div>
        <button class="primary-btn" :disabled="!userInput.trim()" @click="createTask">{{ t('createConversation') }}</button>
      </div>

      <article v-if="selectedTask" class="task-detail">
        <div class="detail-header">
          <div>
            <div class="section-title">{{ t('suggestions') }}</div>
            <h4>{{ selectedTask.title }}</h4>
          </div>
          <span class="status" :class="selectedTask.status">{{ statusText(selectedTask.status) }}</span>
        </div>
        <p>{{ selectedTask.progressText }}</p>
        <div class="chips">
          <span>{{ categoryText(selectedTask.category) }}</span>
          <span v-for="kind in selectedTask.outputKinds" :key="kind">{{ outputKindText(kind) }}</span>
        </div>
        <textarea v-model="selectedTask.prompt" class="prompt-preview" readonly />
        <div class="detail-actions">
          <button @click="copyText(selectedTask.prompt)">{{ t('copy') }}</button>
          <button
            @click="
              aiStore.updateTask(selectedTask.id, {
                status: 'running',
                progressText: t('taskMarkedRunning'),
              })
            "
          >
            {{ t('markRunning') }}
          </button>
          <button
            @click="
              aiStore.updateTask(selectedTask.id, {
                status: 'completed',
                progressText: t('taskMarkedCompleted'),
              })
            "
          >
            {{ t('markCompleted') }}
          </button>
        </div>
        <div class="result-actions">
          <button>{{ t('saveAsDocument') }}</button>
          <button>{{ t('extractTodo') }}</button>
          <button>{{ t('extractSchedule') }}</button>
          <button>{{ t('suggestKnowledge') }}</button>
        </div>
      </article>
    </section>

    <section v-else-if="activeTab === 'tasks'" class="tab-content">
      <div class="summary-card">
        {{ taskSummary }}
      </div>
      <ul class="list">
        <li v-for="task in sortedTasks" :key="task.id" class="list-item">
          <button
            class="item-main"
            @click="
              selectedTaskId = task.id;
              activeTab = 'chat';
            "
          >
            <strong>{{ task.title }}</strong>
            <span>{{ categoryText(task.category) }} · {{ task.progressText }}</span>
          </button>
          <span class="status" :class="task.status">{{ statusText(task.status) }}</span>
          <button class="danger" @click="aiStore.deleteTask(task.id)">{{ t('delete') }}</button>
        </li>
      </ul>
    </section>

    <section v-else-if="activeTab === 'skills'" class="tab-content">
      <div class="section-title">{{ t('skillManagement') }}</div>
      <p class="muted">{{ t('skillManagementDescription') }}</p>
      <form class="inline-form" @submit.prevent="addSkill">
        <input v-model="newSkillName" :placeholder="t('newSkillName')" />
        <button :disabled="!newSkillName.trim()">{{ t('add') }}</button>
      </form>
      <ul class="list">
        <li v-for="skill in aiStore.skills" :key="skill.id" class="list-item vertical">
          <div class="item-heading">
            <strong>{{ skill.name }}</strong>
            <label
              ><input type="checkbox" :checked="skill.enabled" @change="onToggleSkill(skill.id, $event)" /> {{ t('enable') }}</label
            >
          </div>
          <span>{{ skill.description }}</span>
          <small>{{ skill.whenToUse }}</small>
          <div class="chips">
            <span>{{ categoryText(skill.category) }}</span>
            <span v-if="skill.outputPolicy.mayCreateDocument">{{ t('mayCreateDocument') }}</span>
            <span v-if="skill.outputPolicy.mayCreateTodo">{{ t('mayCreateTodo') }}</span>
            <span v-if="skill.outputPolicy.mayCreateSchedule">{{ t('mayCreateSchedule') }}</span>
            <span v-if="skill.outputPolicy.mayUpdateKnowledgeBase">{{ t('maySuggestKnowledge') }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section v-else-if="activeTab === 'agents'" class="tab-content">
      <div class="section-title">{{ t('agentManagement') }}</div>
      <p class="muted">{{ t('agentManagementDescription') }}</p>
      <form class="inline-form" @submit.prevent="addAgent">
        <input v-model="newAgentName" :placeholder="t('newAgentName')" />
        <button :disabled="!newAgentName.trim()">{{ t('add') }}</button>
      </form>
      <ul class="list">
        <li v-for="agent in aiStore.agents" :key="agent.id" class="list-item vertical">
          <div class="item-heading">
            <strong>{{ agent.name }}</strong>
            <label><input type="checkbox" :checked="agent.enabled" @change="onToggleAgent(agent.id, $event)" /> {{ t('enable') }}</label>
          </div>
          <span>{{ agent.description }}</span>
          <small>{{ agent.whenToUse }}</small>
          <div class="chips">
            <span>{{ agent.permissionMode }}</span>
            <span>{{ agent.runMode }}</span>
            <span>{{ usageCountText(agent.usageCount) }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section v-else class="tab-content">
      <div class="section-title">{{ t('settings') }}</div>
      <label class="setting-row"
        ><input v-model="settings.forceReadOnlyMode" type="checkbox" @change="updateSettings" />
        {{ t('readOnlyMode') }}</label
      >
      <label class="setting-row"
        ><input v-model="settings.requireConfirmBeforeWrite" type="checkbox" @change="updateSettings" />
        {{ t('requireWriteConfirm') }}</label
      >
      <label class="setting-row"
        ><input v-model="settings.suggestDocuments" type="checkbox" @change="updateSettings" />
        {{ t('suggestDocuments') }}</label
      >
      <label class="setting-row"
        ><input v-model="settings.suggestTodos" type="checkbox" @change="updateSettings" />
        {{ t('suggestTodos') }}</label
      >
      <label class="setting-row"
        ><input v-model="settings.suggestSchedules" type="checkbox" @change="updateSettings" />
        {{ t('suggestSchedules') }}</label
      >
      <label class="setting-row"
        ><input v-model="settings.suggestKnowledge" type="checkbox" @change="updateSettings" />
        {{ t('suggestKnowledge') }}</label
      >
      <div class="setting-row column">
        <label for="default-output-directory">{{ t('defaultOutputDirectory') }}</label>
        <input id="default-output-directory" v-model="settings.defaultOutputDirectory" @change="updateSettings" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useAIAssistantStore, useFileStore, useKnowledgeGraphStore } from '../store';
import { useI18n } from './composables/useI18n';
import type { AIAgent, AICategory, AIOutputKind, AISkill, AITaskStatus } from '../store/modal/aiAssistant';
const { t } = useI18n();
const aiStore = useAIAssistantStore();
const fileStore = useFileStore();
const knowledgeGraphStore = useKnowledgeGraphStore();

const tabs = [
  { id: 'chat', label: 'chat' },
  { id: 'tasks', label: 'task' },
  { id: 'skills', label: 'skill' },
  { id: 'agents', label: 'agent' },
  { id: 'settings', label: 'settings' },
] as const;

const tabLabel = (label: (typeof tabs)[number]['label']): string =>
  t(`aiTab${label[0].toUpperCase()}${label.slice(1)}` as any);

type TabId = (typeof tabs)[number]['id'];

const activeTab = ref<TabId>('chat');
const userInput = ref('');
const selectedTaskId = ref<string | null>(null);
const newSkillName = ref('');
const newAgentName = ref('');
const settings = reactive({ ...aiStore.settings });

const quickActions = [t('planProject'), t('organizeDocument'), t('extractActions'), t('prepareBrief')];
const sortedTasks = computed(() => aiStore.sortedTasks);
const taskCounts = computed(() => aiStore.taskCounts);
const taskSummary = computed(() =>
  t('taskSummary')
    .replace('{total}', String(taskCounts.value.total))
    .replace('{running}', String(taskCounts.value.running))
    .replace('{pending}', String(taskCounts.value.pending))
    .replace('{completed}', String(taskCounts.value.completed)),
);
const usageCountText = (count: number): string => t('usageCountSummary').replace('{count}', String(count));
const selectedTask = computed(
  () => aiStore.tasks.find((task) => task.id === selectedTaskId.value) || aiStore.tasks[0] || null,
);
const currentFileName = computed(() => fileStore.currentFilePath?.split(/[\\/]/).pop() || t('noOpen'));

const createTask = (): void => {
  const task = aiStore.createTask(userInput.value.trim());
  selectedTaskId.value = task.id;
  userInput.value = '';
};

const copyText = async (text: string): Promise<void> => {
  await navigator.clipboard?.writeText(text);
};

const toggleSkill = (id: string, enabled: boolean): void => {
  aiStore.updateSkill(id, { enabled });
};

const toggleAgent = (id: string, enabled: boolean): void => {
  aiStore.updateAgent(id, { enabled });
};

const onToggleSkill = (id: string, event: Event): void => {
  const target = event.target as HTMLInputElement | null;
  toggleSkill(id, Boolean(target?.checked));
};

const onToggleAgent = (id: string, event: Event): void => {
  const target = event.target as HTMLInputElement | null;
  toggleAgent(id, Boolean(target?.checked));
};

const addSkill = (): void => {
  const name = newSkillName.value.trim();
  if (!name) return;
  aiStore.addSkill({
    name,
    description: '用户自定义 Skill。',
    whenToUse: `当用户需要 ${name} 时使用。`,
    category: 'general',
    promptTemplate: `使用 ${name} 能力帮助用户完成目标。先理解任务，再判断是否需要文档、待办、日程或知识沉淀。`,
    enabled: true,
    userInvocable: true,
    outputPolicy: {
      mayCreateDocument: true,
      mayCreateTodo: true,
      mayCreateSchedule: true,
      mayUpdateKnowledgeBase: true,
    },
  } satisfies Omit<AISkill, 'id' | 'builtin' | 'createdAt' | 'updatedAt'>);
  newSkillName.value = '';
};

const addAgent = (): void => {
  const name = newAgentName.value.trim();
  if (!name) return;
  aiStore.addAgent({
    name,
    description: '用户自定义 Agent。',
    whenToUse: `当任务适合由 ${name} 专门处理时使用。`,
    systemPrompt: `你是 ${name}。你是 workgaga 万能 AI 背后的专业执行者，必须服务于用户目标，不要把知识库或日程作为默认主线。`,
    enabled: true,
    allowedSkills: aiStore.skills.filter((skill) => skill.enabled).map((skill) => skill.id),
    allowedTools: ['read-context', 'write-document', 'manage-task', 'manage-schedule', 'use-knowledge'],
    permissionMode: 'ask',
    memoryScope: 'workspace',
    runMode: 'foreground',
  } satisfies Omit<AIAgent, 'id' | 'builtin' | 'usageCount' | 'createdAt' | 'updatedAt'>);
  newAgentName.value = '';
};

const updateSettings = (): void => {
  aiStore.updateSettings(settings);
};

const statusText = (status: AITaskStatus): string =>
  ({
    pending: t('taskPending'),
    running: t('taskRunning'),
    completed: t('taskCompleted'),
    failed: t('taskFailed'),
    cancelled: t('taskCancelled'),
  })[status];

const categoryText = (category: AICategory): string =>
  ({
    general: t('categoryGeneral'),
    writing: t('categoryWriting'),
    research: t('categoryResearch'),
    planning: t('categoryPlanning'),
    organizing: t('categoryOrganizing'),
    automation: t('categoryAutomation'),
  })[category];

const outputKindText = (kind: AIOutputKind): string =>
  ({
    document: t('possibleDocument'),
    todo: t('possibleTodo'),
    schedule: t('possibleSchedule'),
    knowledge: t('possibleKnowledge'),
  })[kind];
</script>

<style scoped>
.ai-panel {
  height: 100%;
  overflow: auto;
  padding: 14px;
  box-sizing: border-box;
  background: #ffffff;
  color: #111827;
}

.hero-card,
.context-card,
.composer-card,
.task-detail,
.summary-card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f9fafb;
  padding: 12px;
  margin-bottom: 12px;
}

.hero-card {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.eyebrow,
.section-title,
.muted,
.context-row span,
.context-grid span,
.list-item span,
.list-item small {
  color: #6b7280;
  font-size: 12px;
}

.hero-card h4,
.task-detail h4 {
  margin: 4px 0 0;
  font-size: 14px;
}

.api-pill,
.status,
.chips span {
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
  padding: 4px 8px;
  font-size: 11px;
  white-space: nowrap;
}

.tab-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  overflow-x: auto;
}

.tab-bar button,
.quick-actions button,
.detail-actions button,
.result-actions button,
.inline-form button,
.primary-btn,
.danger {
  border: 1px solid #d8dee9;
  border-radius: 8px;
  background: #fff;
  color: #1f2937;
  cursor: pointer;
  font-size: 12px;
  padding: 7px 10px;
}

.tab-bar button.active,
.primary-btn {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.primary-btn:disabled,
.inline-form button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.context-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.context-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 10px;
}

.context-grid div {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px;
}

.context-grid strong,
.context-grid span {
  display: block;
}

textarea,
input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d8dee9;
  border-radius: 8px;
  padding: 9px;
  font-size: 12px;
  color: #111827;
  background: #fff;
}

textarea {
  min-height: 96px;
  resize: vertical;
}

.quick-actions,
.detail-actions,
.result-actions,
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.prompt-preview {
  min-height: 180px;
  margin-top: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.detail-header,
.item-heading {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.list-item {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 8px;
  background: #fff;
  display: flex;
  gap: 8px;
  align-items: center;
}

.list-item.vertical {
  display: block;
}

.item-main {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.item-main strong,
.item-main span,
.list-item.vertical strong,
.list-item.vertical span,
.list-item.vertical small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status.running {
  background: #dbeafe;
  color: #1d4ed8;
}
.status.completed {
  background: #dcfce7;
  color: #166534;
}
.status.failed {
  background: #fee2e2;
  color: #991b1b;
}
.status.cancelled {
  background: #f3f4f6;
  color: #4b5563;
}

.danger {
  color: #b91c1c;
}

.inline-form {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}

.inline-form input {
  flex: 1;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}

.setting-row input[type='checkbox'] {
  width: auto;
}

.setting-row.column {
  display: block;
}
</style>
