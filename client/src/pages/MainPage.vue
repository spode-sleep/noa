<template>
  <div class="page-container container">
    <div class="main-content glass" v-html="content"></div>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const content = ref('')
const error = ref('')

onMounted(async () => {
  document.title = 'BOX'
  try {
    const res = await fetch('/api/main/content')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    content.value = await res.text()
  } catch (e: any) {
    error.value = 'Failed to load content'
    console.error('[MainPage]', e)
  }
})
</script>

<style scoped>
.main-content {
  padding: 2rem;
  line-height: 1.7;
}

.main-content :deep(a) {
  color: var(--askew-cyan);
}

.main-content :deep(code) {
  background: var(--askew-btn-disabled);
  padding: 2px 6px;
  border: 1px solid #000000;
  font-size: 0.9em;
}

.error {
  color: var(--askew-red);
  margin-top: 1rem;
}
</style>
