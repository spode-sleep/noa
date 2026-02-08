<template>
  <div class="page">
    <h1>Reference</h1>

    <div v-if="loading" class="loading">Checking kiwix-serve...</div>

    <div v-else-if="!kiwixUrl" class="empty-state glass">
      <div class="empty-icon">📚</div>
      <h2>Reference library not available</h2>
      <p>Place ZIM archive files (.zim) in your reference library directory and install <a href="https://kiwix.org/en/kiwix-serve/" target="_blank" rel="noopener noreferrer">kiwix-serve</a>.</p>
      <p>kiwix-serve will start automatically with the server when ZIM files are present.</p>
      <code>Configure path(s) in server .env file: REFERENCE_LIBRARY_PATH=/path/to/reference</code>
    </div>

    <div v-else class="viewer-container">
      <iframe :src="kiwixUrl" class="zim-viewer"></iframe>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const kiwixUrl = ref('')
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await fetch('/api/reference/status')
    const data = await res.json()
    if (data.kiwixUrl) {
      kiwixUrl.value = data.kiwixUrl
    }
  } catch (e) {
    console.error('Failed to check kiwix status:', e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.page {
  padding: 24px 0;
}

h1 {
  font-size: 2rem;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #34d399, var(--accent-teal));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.loading {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 0;
  font-size: 1.1rem;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 48px 24px;
  max-width: 520px;
  margin: 48px auto;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 16px;
}

.empty-state h2 {
  font-size: 1.3rem;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.empty-state p {
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}

.empty-state a {
  color: var(--accent-teal);
  text-decoration: underline;
}

.empty-state code {
  display: inline-block;
  background: rgba(255, 255, 255, 0.05);
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  color: var(--accent-teal);
  font-size: 0.85rem;
  word-break: break-all;
}

/* Viewer */
.viewer-container {
  height: calc(100vh - 140px);
}

.zim-viewer {
  width: 100%;
  height: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: #fff;
}
</style>
