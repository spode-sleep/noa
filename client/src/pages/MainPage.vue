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
  border-radius: var(--radius-lg);
  line-height: 1.7;
}

.main-content :deep(a) {
  color: var(--accent-teal);
}

.main-content :deep(code) {
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 0.9em;
}

.error {
  color: #ef4444;
  margin-top: 1rem;
}
</style>
