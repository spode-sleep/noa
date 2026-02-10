<template>
  <div class="page">
    <h1>Fiction</h1>

    <div class="toolbar glass">
      <input
        v-model="search"
        type="text"
        placeholder="Search by title or author..."
        class="search-input"
      />
      <select v-model="formatFilter" class="filter-select">
        <option value="">All Formats</option>
        <option value="pdf">PDF</option>
        <option value="epub">EPUB</option>
        <option value="fb2">FB2</option>
        <option value="zim">ZIM</option>
      </select>
      <select v-model="languageFilter" class="filter-select">
        <option value="">All Languages</option>
        <option v-for="lang in availableLanguages" :key="lang" :value="lang">{{ lang }}</option>
      </select>
      <select v-model="authorFilter" class="filter-select">
        <option value="">All Authors</option>
        <option v-for="author in availableAuthors" :key="author" :value="author">{{ author }}</option>
      </select>
      <button class="btn" :disabled="scanning" @click="rescanLibrary">
        <span v-if="scanning" class="spinner"></span>
        {{ scanning ? 'Scanning...' : 'Rescan Library' }}
      </button>
    </div>

    <div v-if="lastScanDate" class="scan-info">
      Last scanned: {{ lastScanDate }}
    </div>

    <div v-if="loading" class="loading">Loading books...</div>

    <div v-else-if="filteredBooks.length === 0" class="empty">
      No books found.
    </div>

    <div v-else class="book-grid">
      <router-link
        v-for="book in filteredBooks"
        :key="book.id"
        :to="`/fiction/${book.id}`"
        class="book-card glass"
      >
        <div class="book-info">
          <div class="book-title">{{ book.title }}</div>
          <div class="book-author">{{ book.author }}</div>
          <div class="book-meta">
            <span class="format-badge" :class="'format-' + book.format.toLowerCase()">
              {{ book.format.toUpperCase() }}
            </span>
            <span v-if="book.year" class="book-year">{{ book.year }}</span>
            <span v-if="book.language" class="book-lang">{{ book.language }}</span>
            <span class="book-size">{{ formatFileSize(book.file_size) }}</span>
          </div>
          <div v-if="getBookProgress(book.id)" class="progress-badge">
            📖 Continue reading · {{ getBookProgress(book.id) }}%
          </div>
        </div>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface Book {
  id: string
  title: string
  author: string
  format: string
  year?: number
  language?: string
  file_size: number
}

interface BookBookmark {
  book_id: string
  last_position: {
    page: number
    chapter: string
    position_percent: number
    scroll_offset: number
  }
}

const books = ref<Book[]>([])
const bookmarks = ref<BookBookmark[]>([])
const search = ref('')
const formatFilter = ref('')
const languageFilter = ref('')
const authorFilter = ref('')
const loading = ref(true)
const scanning = ref(false)
const lastScanDate = ref('')

const availableLanguages = computed(() => {
  const langs = new Set(books.value.map(b => b.language).filter(Boolean))
  return [...langs].sort()
})

const availableAuthors = computed(() => {
  const authors = new Set(books.value.map(b => b.author).filter(Boolean))
  return [...authors].sort()
})

const filteredBooks = computed(() => {
  let result = books.value

  if (search.value) {
    const q = search.value.toLowerCase()
    result = result.filter(b =>
      b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    )
  }

  if (formatFilter.value) {
    result = result.filter(b => b.format.toLowerCase() === formatFilter.value)
  }

  if (languageFilter.value) {
    result = result.filter(b => b.language === languageFilter.value)
  }

  if (authorFilter.value) {
    result = result.filter(b => b.author === authorFilter.value)
  }

  return result
})

function formatFileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getBookProgress(bookId: string): number | null {
  const bm = bookmarks.value.find(b => b.book_id === bookId)
  if (!bm || !bm.last_position || !bm.last_position.position_percent) return null
  return Math.round(bm.last_position.position_percent)
}

async function rescanLibrary() {
  scanning.value = true
  try {
    await fetch('/api/fiction/scan')
    await fetchBooks()
    lastScanDate.value = new Date().toLocaleString()
  } catch (e) {
    console.error('Failed to scan library:', e)
  } finally {
    scanning.value = false
  }
}

async function fetchBooks() {
  try {
    const res = await fetch('/api/fiction/books')
    const data = await res.json()
    books.value = data.books || []
    if (data.last_scan) {
      lastScanDate.value = new Date(data.last_scan).toLocaleString()
    }
  } catch (e) {
    console.error('Failed to fetch books:', e)
  }
}

async function fetchBookmarks() {
  try {
    const res = await fetch('/api/bookmarks')
    const data = await res.json()
    bookmarks.value = data.bookmarks || []
  } catch (e) {
    console.error('Failed to fetch bookmarks:', e)
  }
}

onMounted(async () => {
  try {
    await Promise.all([fetchBooks(), fetchBookmarks()])
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
  background: linear-gradient(135deg, #7ec8e3, var(--accent-blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.toolbar {
  display: flex;
  gap: 12px;
  padding: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
}

.search-input,
.filter-select {
  background: var(--bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 10px 14px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.search-input {
  flex: 1;
  min-width: 200px;
}

.filter-select {
  min-width: 140px;
}

.search-input:focus,
.filter-select:focus {
  border-color: var(--accent-teal);
}

.btn {
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
  border: none;
  color: #fff;
  padding: 10px 20px;
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.scan-info {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: 16px;
}

.loading,
.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 0;
  font-size: 1.1rem;
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.book-card {
  display: block;
  padding: 20px;
  text-decoration: none;
  color: var(--text-primary);
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.book-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.book-title {
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 4px;
}

.book-author {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.book-meta {
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
}

.format-pdf {
  background: rgba(231, 76, 60, 0.2);
  color: #e74c3c;
  border: 1px solid rgba(231, 76, 60, 0.3);
}

.format-epub {
  background: rgba(0, 212, 170, 0.2);
  color: var(--accent-teal);
  border: 1px solid rgba(0, 212, 170, 0.3);
}

.format-fb2 {
  background: rgba(123, 104, 238, 0.2);
  color: var(--accent-purple);
  border: 1px solid rgba(123, 104, 238, 0.3);
}

.format-zim {
  background: rgba(76, 201, 240, 0.2);
  color: #4cc9f0;
  border: 1px solid rgba(76, 201, 240, 0.3);
}

.progress-badge {
  margin-top: 10px;
  font-size: 0.8rem;
  color: var(--accent-teal);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: rgba(0, 212, 170, 0.1);
  border: 1px solid rgba(0, 212, 170, 0.2);
  display: inline-block;
}

@media (max-width: 560px) {
  .book-grid {
    grid-template-columns: 1fr;
  }
}
</style>
