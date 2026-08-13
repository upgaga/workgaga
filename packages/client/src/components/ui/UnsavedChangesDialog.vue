<script setup lang="ts">
import { useI18n } from "../composables/useI18n";

export type UnsavedDialogResult = 'save' | 'discard' | 'cancel';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (_e: 'close', _result: UnsavedDialogResult): void;
}>();

const { t } = useI18n();

const handleAction = (result: UnsavedDialogResult): void => {
  emit('close', result);
};
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible" class="dialog-overlay" @click.self="handleAction('cancel')">
        <div class="dialog-content">
          <h3 class="dialog-title">{{ t("unsavedChanges") }}</h3>
          <p class="dialog-message">{{ t("unsavedChangesMessage") }}</p>
          <div class="dialog-actions">
            <button class="btn btn-primary" @click="handleAction('save')">
              {{ t("saveAndContinue") }}
            </button>
            <button class="btn btn-danger" @click="handleAction('discard')">
              {{ t("discardChanges") }}
            </button>
            <button class="btn btn-secondary" @click="handleAction('cancel')">
              {{ t("cancel") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
}

.dialog-content {
  background: var(--dialog-bg, #fff);
  color: var(--dialog-color, #333);
  border-radius: 8px;
  padding: 24px;
  min-width: 320px;
  max-width: 480px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.dialog-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
}

.dialog-message {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--dialog-message-color, #666);
}

.dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn:hover {
  filter: brightness(1.1);
}

.btn-primary {
  background: #1890ff;
  color: #fff;
}

.btn-danger {
  background: #ff4d4f;
  color: #fff;
}

.btn-secondary {
  background: #f0f0f0;
  color: #333;
}

/* 动画 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-fade-enter-active .dialog-content,
.dialog-fade-leave-active .dialog-content {
  transition: transform 0.2s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .dialog-content {
  transform: scale(0.9);
}

.dialog-fade-leave-to .dialog-content {
  transform: scale(0.9);
}

/* 深色模式支持 */
@media (prefers-color-scheme: dark) {
  .dialog-content {
    --dialog-bg: #2d2d2d;
    --dialog-color: #e0e0e0;
    --dialog-message-color: #aaa;
  }

  .btn-secondary {
    background: #404040;
    color: #e0e0e0;
  }
}
</style>
