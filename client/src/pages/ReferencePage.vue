<template>
  <div class="page">
    <h1>Reference</h1>

    <div v-if="loading" class="loading">Loading archives...</div>

    <div v-else-if="archives.length === 0" class="empty-state glass">
      <div class="empty-icon">📚</div>
      <h2>Reference library not available</h2>
      <p>Place ZIM archive files (.zim) in your reference library directory and install <a href="https://kiwix.org/en/kiwix-serve/" target="_blank" rel="noopener noreferrer">kiwix-serve</a>.</p>
      <p>kiwix-serve will start automatically with the server when ZIM files are present.</p>
      <code>Configure path(s) in server .env file: REFERENCE_LIBRARY_PATH=/path/to/reference</code>
    </div>

    <div v-else class="archive-grid">
      <router-link
        v-for="archive in archives"
        :key="archive.name"
        :to="`/reference/${archive.zimName}`"
        class="archive-card glass"
      >
        <div class="archive-info">
          <div class="archive-title">{{ archive.displayName }}</div>
          <div class="archive-meta">
            <span class="format-badge">ZIM</span>
            <span class="archive-size">{{ formatFileSize(archive.size) }}</span>
          </div>
        </div>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Archive {
  name: string
  path: string
  size: number
  zimName: string
  displayName: string
}

const archives = ref<Archive[]>([])
const loading = ref(true)

function formatFileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
}

onMounted(async () => {
  document.title = 'Reference - BOX'
  try {
    const res = await fetch('/api/reference/archives')
    const data = await res.json()
    archives.value = (data.archives || []).map((a: { name: string; path: string; size: number }) => ({
      ...a,
      zimName: a.name.replace(/\.zim$/i, ''),
      displayName: a.name.replace(/\.zim$/i, '').replace(/_/g, ' '),
    }))
  } catch (e) {
    console.error('Failed to fetch archives:', e)
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

/* Archive grid */
.archive-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.archive-card {
  display: block;
  padding: 20px;
  text-decoration: none;
  color: var(--text-primary);
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.archive-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.archive-title {
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 10px;
}

.archive-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.format-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  background: rgba(76, 201, 240, 0.2);
  color: #4cc9f0;
  border: 1px solid rgba(76, 201, 240, 0.3);
}

@media (max-width: 560px) {
  .archive-grid {
    grid-template-columns: 1fr;
  }
}
</style>
