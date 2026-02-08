<template>
  <div class="page">
    <h1>Reference</h1>

    <div v-if="loading" class="loading">Loading archives...</div>

    <!-- Empty state -->
    <div v-else-if="archives.length === 0" class="empty-state glass">
      <div class="empty-icon">📚</div>
      <h2>No reference archives found</h2>
      <p>Place ZIM archive files (.zim) in your reference library directory.</p>
      <p>To view ZIM files, install <a href="https://kiwix.org/en/kiwix-serve/" target="_blank" rel="noopener noreferrer">kiwix-serve</a> and configure the port in the server <code>.env</code> file.</p>
      <code>Configure path(s) in server .env file: REFERENCE_LIBRARY_PATH=/path/to/reference</code>
    </div>

    <!-- Archive viewer (full screen iframe) -->
    <div v-else-if="openedArchive" class="viewer-container">
      <div class="viewer-header glass">
        <button class="btn btn-back" @click="closeArchive">← Back</button>
        <span class="viewer-title">{{ openedArchive.name }}</span>
      </div>
      <iframe
        :src="openedArchive.viewerUrl"
        class="zim-viewer"
      ></iframe>
    </div>

    <!-- Archive list -->
    <div v-else class="archive-list">
      <div v-for="archive in archives" :key="archive.name" class="archive-card glass" @click="openArchive(archive)">
        <div class="archive-header">
          <div class="archive-info">
            <span class="archive-icon">📦</span>
            <span class="archive-name">{{ archive.name }}</span>
          </div>
          <span class="archive-size">{{ formatSize(archive.size) }}</span>
        </div>
        <p class="archive-hint">Click to open</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Archive {
  name: string
  path: string
  size: number
  viewerUrl?: string
}

const archives = ref<Archive[]>([])
const loading = ref(true)
const openedArchive = ref<Archive | null>(null)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function openArchive(archive: Archive) {
  try {
    const res = await fetch(`/api/reference/archives/${encodeURIComponent(archive.name)}/viewer`)
    const data = await res.json()
    openedArchive.value = { ...archive, viewerUrl: data.viewerUrl }
  } catch (e) {
    console.error('Failed to get viewer URL:', e)
  }
}

function closeArchive() {
  openedArchive.value = null
}

onMounted(async () => {
  try {
    const res = await fetch('/api/reference/archives')
    const data = await res.json()
    archives.value = data.archives || []
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
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-teal));
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

/* Archive list */
.archive-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.archive-card {
  padding: 20px;
  cursor: pointer;
  transition: border-color var(--transition-fast), transform var(--transition-fast);
}

.archive-card:hover {
  border-color: var(--accent-teal);
  transform: translateY(-2px);
}

.archive-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.archive-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.archive-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
}

.archive-name {
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--text-primary);
  word-break: break-all;
}

.archive-size {
  color: var(--text-muted);
  font-size: 0.85rem;
  flex-shrink: 0;
}

.archive-hint {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: 8px;
}

/* Viewer */
.viewer-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 140px);
}

.viewer-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.viewer-title {
  font-weight: 600;
  font-size: 1.05rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn {
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  border: none;
  color: #fff;
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  cursor: pointer;
  transition: opacity var(--transition-fast);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn:hover {
  opacity: 0.85;
}

.btn-back {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
}

.btn-back:hover {
  border-color: var(--accent-teal);
  color: var(--text-primary);
}

.zim-viewer {
  flex: 1;
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: #fff;
}

@media (max-width: 480px) {
  .archive-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
