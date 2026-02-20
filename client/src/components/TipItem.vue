<template>
  <li class="tip-item">
    <span v-html="formatTipText(tip.text)"></span>
    <ul v-if="tip.children?.length" class="tips-list tips-list-nested">
      <TipItem v-for="(child, ci) in tip.children" :key="ci" :tip="child" :format-tip-text="formatTipText" />
    </ul>
  </li>
</template>

<script setup lang="ts">
interface Tip {
  text: string
  children?: Tip[]
}

defineProps<{
  tip: Tip
  formatTipText: (text: string) => string
}>()
</script>

<style scoped>
.tip-item {
  position: relative;
  padding: 8px 0 8px 18px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
  border-bottom: 1px solid var(--askew-btn-disabled);
}

.tip-item:last-child {
  border-bottom: none;
}

.tip-item::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--askew-gold);
}

.tips-list-nested {
  list-style: none;
  padding: 0;
  margin: 4px 0 0 18px;
}

.tips-list-nested .tip-item {
  border-bottom: none;
}

.tip-item :deep(code) {
  background: var(--askew-btn-disabled);
  color: var(--askew-gold);
  padding: 1px 6px;
  border: 1px solid #000000;
  font-size: 0.82rem;
}
</style>
