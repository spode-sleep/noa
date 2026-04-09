<template>
  <div class="page">
    <a class="btn btn-back" @click="router.back()" style="cursor:pointer">← Reference</a>
    <h1>{{ displayName }}</h1>

    <div v-if="loading" class="loading">Checking kiwix-serve...</div>

    <div v-else-if="!kiwixUrl" class="empty-state glass">
      <div class="empty-icon">📚</div>
      <h2>Reference not available</h2>
      <p>kiwix-serve is not running or this archive is not loaded.</p>
    </div>

    <div v-else class="viewer-container">
      <iframe :src="kiwixUrl" class="zim-viewer"></iframe>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const archiveId = computed(() => route.params.id as string)
const displayName = computed(() => archiveId.value.replace(/_/g, ' '))
const kiwixUrl = ref('')
const loading = ref(true)

onMounted(async () => {
  document.title = `${displayName.value} - BOX`
  try {
    const res = await fetch('/api/reference/status')
    const data = await res.json()
    if (data.kiwixUrl) {
      const base = data.kiwixUrl.replace(/\/+$/, '')
      kiwixUrl.value = `${base}/${archiveId.value}`
    }
  } catch (e) {
    console.error('Failed to check kiwix status:', e)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  document.title = 'BOX'
})
</script>

<style scoped>
.page {
  padding: 24px 0;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  font-size: 0.9rem;
  text-decoration: none;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-back:hover {
  color: var(--text-primary);
  border-color: var(--accent-teal);
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

.viewer-container {
  height: calc(100vh - 180px);
}

.zim-viewer {
  width: 100%;
  height: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: #fff;
}
</style>
