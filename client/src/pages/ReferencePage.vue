<template>
  <div class="page">
    <h1>Reference</h1>

    <div v-if="loading" class="loading">Loading archives...</div>

    <!-- Empty state -->
    <div v-else-if="archives.length === 0" class="empty-state glass">
      <div class="empty-icon">📚</div>
      <h2>No reference archives found</h2>
      <p>Place ZIM archive files (.zim) in your reference library directory</p>
      <code>Configure path(s) in server .env file: REFERENCE_LIBRARY_PATH=/path/to/reference,/another/path</code>
    </div>

    <!-- Archive list -->
    <div v-else class="archive-list">
      <div v-for="archive in archives" :key="archive.name" class="archive-card glass">
        <div class="archive-header">
          <div class="archive-info">
            <span class="archive-icon">📦</span>
            <span class="archive-name">{{ archive.name }}</span>
          </div>
          <span class="archive-size">{{ formatSize(archive.size) }}</span>
        </div>

        <div class="search-row">
          <input
            v-model="searchQueries[archive.name]"
            type="text"
            :placeholder="`Search ${archive.name}...`"
            class="search-input"
            @keyup.enter="searchArchive(archive.name)"
          />
          <button class="btn-search" @click="searchArchive(archive.name)">Search</button>
        </div>

        <!-- Search results -->
        <div v-if="searchResults[archive.name]" class="results-section">
          <div v-if="searchResults[archive.name].message" class="results-message glass">
            {{ searchResults[archive.name].message }}
          </div>
          <div
            v-for="(result, i) in searchResults[archive.name].results"
            :key="i"
            class="result-card glass"
          >
            <div class="result-title">{{ result.title || result.url || 'Untitled' }}</div>
            <p v-if="result.snippet" class="result-snippet">{{ result.snippet }}</p>
            <div class="result-actions">
              <button class="btn-action" title="Send to AI">🤖 Send to AI</button>
              <button class="btn-action" title="Read Aloud">🔊 Read Aloud</button>
            </div>
          </div>
          <div v-if="searchResults[archive.name].results.length === 0 && !searchResults[archive.name].message" class="no-results">
            No results found.
          </div>
        </div>

        <div v-if="searchLoading[archive.name]" class="search-loading">Searching...</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'

interface Archive {
  name: string
  path: string
  size: number
}

interface SearchResult {
  title?: string
  url?: string
  snippet?: string
}

interface SearchResponse {
  message?: string
  query: string
  results: SearchResult[]
}

const archives = ref<Archive[]>([])
const loading = ref(true)
const searchQueries = reactive<Record<string, string>>({})
const searchResults = reactive<Record<string, SearchResponse>>({})
const searchLoading = reactive<Record<string, boolean>>({})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function searchArchive(filename: string) {
  const q = searchQueries[filename]?.trim()
  if (!q) return

  searchLoading[filename] = true
  try {
    const res = await fetch(`/api/reference/archives/${encodeURIComponent(filename)}/search?q=${encodeURIComponent(q)}`)
    searchResults[filename] = await res.json()
  } catch (e) {
    console.error('Search failed:', e)
    searchResults[filename] = { message: 'Search request failed.', query: q, results: [] }
  } finally {
    searchLoading[filename] = false
  }
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
}

.archive-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
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

/* Search */
.search-row {
  display: flex;
  gap: 10px;
}

.search-input {
  flex: 1;
  min-width: 0;
  background: #1a1a2e;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 10px 14px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.search-input:focus {
  border-color: var(--accent-teal);
}

.btn-search {
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-blue));
  border: none;
  border-radius: var(--radius-sm);
  color: #fff;
  padding: 10px 20px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--transition-fast);
  white-space: nowrap;
}

.btn-search:hover {
  opacity: 0.85;
}

/* Results */
.results-section {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.results-message {
  padding: 14px 18px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
}

.result-card {
  padding: 14px 18px;
}

.result-title {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.result-snippet {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
  margin-bottom: 10px;
}

.result-actions {
  display: flex;
  gap: 10px;
}

.btn-action {
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-action:hover {
  border-color: var(--accent-purple);
  color: var(--text-primary);
}

.no-results {
  color: var(--text-muted);
  font-size: 0.9rem;
  padding: 12px 0;
}

.search-loading {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-top: 10px;
}

@media (max-width: 480px) {
  .search-row {
    flex-direction: column;
  }

  .archive-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
