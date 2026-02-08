<template>
  <div class="reader-page">
    <div class="reader-header glass">
      <router-link to="/fiction" class="btn btn-back">← Library</router-link>
      <div v-if="book" class="header-info">
        <span class="header-title">{{ book.title }}</span>
        <span class="header-author">{{ book.author }}</span>
      </div>
      <div class="header-controls">
        <button class="ctrl-btn" @click="readAloud" title="Read Aloud">🔊</button>
        <template v-if="book?.format !== 'pdf'">
          <button class="ctrl-btn" :class="{ active: showBookmarks }" @click="showBookmarks = !showBookmarks" title="Bookmarks">
            ⭐
          </button>
        </template>
      </div>
    </div>

    <div v-if="loading" class="loading">Loading book...</div>

    <div v-else-if="!book" class="empty">Book not found.</div>

    <div v-else class="reader-layout">
      <!-- Bookmarks Sidebar (not for PDF) -->
      <aside v-if="showBookmarks && book?.format !== 'pdf'" class="bookmarks-sidebar glass">
        <h3>Bookmarks</h3>
        <div class="add-bookmark">
          <input
            v-model="newBookmarkNote"
            type="text"
            placeholder="Bookmark note..."
            class="bookmark-input"
            @keyup.enter="addBookmark"
          />
          <button class="btn btn-sm" @click="addBookmark">⭐ Add</button>
        </div>
        <div v-if="manualBookmarks.length === 0" class="bookmark-empty">No bookmarks yet.</div>
        <div v-else class="bookmark-list">
          <div v-for="bm in manualBookmarks" :key="bm.id" class="bookmark-item" role="button" tabindex="0" @click="navigateToBookmark(bm)" @keydown.enter="navigateToBookmark(bm)" @keydown.space.prevent="navigateToBookmark(bm)">
            <div class="bookmark-info">
              <span v-if="bm.page && book?.format !== 'epub'" class="bookmark-page">Page {{ bm.page }}</span>
              <span v-else-if="bm.page != null && book?.format === 'epub'" class="bookmark-page">📖 {{ Math.round(Number(bm.page) * 100) }}%</span>
              <span class="bookmark-note">{{ bm.note || 'No note' }}</span>
              <span class="bookmark-date">{{ formatDate(bm.created) }}</span>
            </div>
            <button class="btn-delete" @click.stop="deleteBookmark(bm.id)" title="Delete">✕</button>
          </div>
        </div>
      </aside>

      <!-- Reader Content -->
      <div class="reader-content" :class="{ 'with-sidebar': showBookmarks }">
        <!-- Continue from last position prompt -->
        <div v-if="savedPosition && !positionRestored" class="resume-prompt glass">
          <span>📖 You left off at position {{ savedPosition }}.</span>
          <button class="btn btn-sm" @click="restorePosition">Continue reading</button>
          <button class="btn btn-sm btn-ghost" @click="positionRestored = true">Start over</button>
        </div>

        <!-- PDF Reader -->
        <div v-if="book.format === 'pdf'" class="pdf-reader">
          <iframe
            :src="'/api/fiction/read/' + book.id"
            class="pdf-frame"
            title="PDF Reader"
          ></iframe>
        </div>

        <!-- EPUB Reader -->
        <div v-else-if="book.format === 'epub'" class="epub-reader">
          <VueReader ref="readerRef" :url="epubUrl" :getRendition="onRendition" @update:location="onEpubLocationChange" />
        </div>

        <!-- FB2 Reader -->
        <div v-else-if="book.format === 'fb2'" class="fb2-reader" :style="{ fontSize: fontSize + 'px' }">
          <div v-if="fb2Loading" class="loading">Loading content...</div>
          <div v-else-if="fb2Chapters.length === 0" class="empty">No content available.</div>
          <div v-else>
            <div
              v-for="(chapter, idx) in fb2Chapters"
              :key="idx"
              class="fb2-chapter"
            >
              <h2 v-if="chapter.title" class="chapter-title">{{ chapter.title }}</h2>
              <p v-for="(para, pIdx) in chapter.content" :key="pIdx" class="chapter-paragraph">{{ para }}</p>
            </div>
          </div>
        </div>

        <!-- Unknown Format -->
        <div v-else class="epub-notice glass">
          <p>Unsupported format: {{ book.format }}</p>
          <a :href="'/api/fiction/read/' + book.id" class="btn" download>
            📥 Download file
          </a>
        </div>
      </div>
    </div>

    <!-- TTS Modal -->
    <div v-if="showTtsMessage" class="tts-modal glass" @click="showTtsMessage = false">
      <p>{{ ttsMessage }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { VueReader } from 'vue-book-reader'

interface Book {
  id: string
  title: string
  author: string
  format: string
  year?: number
  language?: string
  file_size: number
}

interface ManualBookmark {
  id: string
  page: number | string
  note: string
  created: string
}

interface Fb2Chapter {
  title?: string
  content: string[]
}

const route = useRoute()
const bookId = route.params.id as string

const book = ref<Book | null>(null)
const loading = ref(true)
const showBookmarks = ref(false)
const newBookmarkNote = ref('')
const manualBookmarks = ref<ManualBookmark[]>([])
const savedPosition = ref<number | null>(null)
const positionRestored = ref(false)
const fontSize = ref(18)
const fb2Chapters = ref<Fb2Chapter[]>([])
const fb2Loading = ref(false)
const showTtsMessage = ref(false)
const ttsMessage = ref('')

// EPUB state
const epubUrl = computed(() => `/api/fiction/read/${bookId}`)
const readerRef = ref<any>(null) // template ref to VueReader component
const epubFraction = ref<number>(0) // 0-1 reading progress for bookmarks

function onEpubLocationChange(detail: any) {
  // vue-book-reader emits the full relocate detail object from foliate-view
  // It contains { fraction, cfi, tocItem, ... }
  if (detail && typeof detail === 'object' && typeof detail.fraction === 'number') {
    epubFraction.value = detail.fraction
  }
}

function onRendition(view: any) {
  // Apply dark theme by injecting CSS into each loaded document
  view.addEventListener('load', ({ detail: { doc } }: any) => {
    const style = doc.createElement('style')
    style.textContent = `
      body, html { color: #e0e0e0 !important; background: transparent !important; font-family: Georgia, serif; line-height: 1.8; }
      a { color: #00e8b8 !important; }
      img { max-width: 100%; height: auto; }
    `
    doc.head.appendChild(style)
  })
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString()
}

async function readAloud() {
  try {
    const res = await fetch('/api/tts/status')
    const data = await res.json()
    if (data.available) {
      ttsMessage.value = 'TTS is available. Feature coming soon.'
    } else {
      ttsMessage.value = 'TTS not configured. Please set up a TTS service in settings.'
    }
  } catch {
    ttsMessage.value = 'TTS not configured. Please set up a TTS service in settings.'
  }
  showTtsMessage.value = true
}

async function addBookmark() {
  const note = newBookmarkNote.value.trim()
  let position: any = window.scrollY
  // For EPUB, save the fraction (0-1 reading progress)
  if (book.value?.format === 'epub') {
    position = epubFraction.value
  }
  try {
    const res = await fetch(`/api/bookmarks/${bookId}/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, page: position }),
    })
    const bm = await res.json()
    manualBookmarks.value.push(bm)
    newBookmarkNote.value = ''
  } catch (e) {
    console.error('Failed to add bookmark:', e)
  }
}

async function deleteBookmark(id: string) {
  try {
    await fetch(`/api/bookmarks/${bookId}/manual/${id}`, { method: 'DELETE' })
    manualBookmarks.value = manualBookmarks.value.filter(b => b.id !== id)
  } catch (e) {
    console.error('Failed to delete bookmark:', e)
  }
}

function restorePosition() {
  positionRestored.value = true
  if (savedPosition.value != null) {
    if (book.value?.format === 'epub') {
      // Call VueReader's setLocation directly (prop-based navigation doesn't work - no watcher)
      readerRef.value?.setLocation({ fraction: Number(savedPosition.value) })
    } else {
      window.scrollTo({ top: Number(savedPosition.value), behavior: 'smooth' })
    }
  }
}

function navigateToBookmark(bm: ManualBookmark) {
  if (bm.page != null) {
    if (book.value?.format === 'epub') {
      // Call VueReader's exposed setLocation method with fraction object
      readerRef.value?.setLocation({ fraction: Number(bm.page) })
    } else if (book.value?.format === 'pdf') {
      const iframe = document.querySelector('.pdf-frame') as HTMLIFrameElement
      if (iframe) {
        iframe.src = `/api/fiction/read/${book.value.id}#page=${bm.page}`
      }
    } else {
      window.scrollTo({ top: Number(bm.page), behavior: 'smooth' })
    }
  }
}

async function savePosition() {
  try {
    let positionData: any = window.scrollY
    // For EPUB, save the fraction (0-1 progress)
    if (book.value?.format === 'epub') {
      positionData = epubFraction.value
    }
    await fetch(`/api/bookmarks/${bookId}/position`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scroll_offset: positionData }),
    })
  } catch {
    // Silently fail - position saving is best-effort
  }
}

async function fetchBook() {
  try {
    const res = await fetch(`/api/fiction/books/${bookId}`)
    if (res.ok) {
      book.value = await res.json()
    }
  } catch (e) {
    console.error('Failed to fetch book:', e)
  }
}

async function fetchBookmarks() {
  try {
    const res = await fetch(`/api/bookmarks/${bookId}`)
    if (res.ok) {
      const data = await res.json()
      manualBookmarks.value = data.manual_bookmarks || []
      if (data.last_position?.scroll_offset) {
        savedPosition.value = data.last_position.scroll_offset
      }
    }
  } catch (e) {
    console.error('Failed to fetch bookmarks:', e)
  }
}

async function fetchFb2Content() {
  if (book.value?.format !== 'fb2') return
  fb2Loading.value = true
  try {
    const res = await fetch(`/api/fiction/read/${bookId}`)
    if (res.ok) {
      const data = await res.json()
      fb2Chapters.value = data.chapters || []
    }
  } catch (e) {
    console.error('Failed to fetch FB2 content:', e)
  } finally {
    fb2Loading.value = false
  }
}

onMounted(async () => {
  try {
    await fetchBook()
    await Promise.all([fetchBookmarks(), fetchFb2Content()])
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  savePosition()
})
</script>

<style scoped>
.reader-page {
  padding: 0 0 24px;
  min-height: 100vh;
}

.reader-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  margin-bottom: 16px;
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(10, 10, 26, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.header-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.header-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-author {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.header-controls {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.ctrl-btn {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all var(--transition-fast);
}

.ctrl-btn:hover {
  border-color: var(--accent-teal);
  color: var(--text-primary);
}

.ctrl-btn.active {
  background: rgba(0, 212, 170, 0.15);
  border-color: var(--accent-teal);
  color: var(--accent-teal);
}

.btn {
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
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
  text-decoration: none;
}

.btn:hover {
  opacity: 0.85;
}

.btn-sm {
  padding: 6px 14px;
  font-size: 0.85rem;
  flex-shrink: 0;
  white-space: nowrap;
}

.btn-back {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
}

.btn-back:hover {
  color: var(--text-primary);
  border-color: var(--accent-teal);
  opacity: 1;
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
}

.btn-ghost:hover {
  border-color: var(--accent-teal);
  color: var(--text-primary);
  opacity: 1;
}

.loading,
.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 0;
  font-size: 1.1rem;
}

.reader-layout {
  display: flex;
  gap: 16px;
}

/* Bookmarks Sidebar */
.bookmarks-sidebar {
  width: 300px;
  flex-shrink: 0;
  padding: 16px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  overflow-x: hidden;
  position: sticky;
  top: 80px;
}

.bookmarks-sidebar h3 {
  font-size: 1rem;
  color: var(--text-primary);
  margin-bottom: 12px;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.add-bookmark {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  align-items: center;
}

.bookmark-input {
  flex: 1;
  min-width: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: 0.85rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.bookmark-input:focus {
  border-color: var(--accent-teal);
}

.bookmark-empty {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 16px 0;
}

.bookmark-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bookmark-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: background var(--transition-fast);
  overflow: hidden;
  max-width: 100%;
}

.bookmark-item:hover {
  background: rgba(0, 232, 184, 0.06);
}

.bookmark-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
  flex: 1;
}

.bookmark-page {
  font-size: 0.8rem;
  color: var(--accent-teal);
  font-weight: 600;
}

.bookmark-note {
  font-size: 0.85rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-date {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.btn-delete {
  background: transparent;
  border: 1px solid rgba(231, 76, 60, 0.3);
  color: #e74c3c;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.btn-delete:hover {
  background: rgba(231, 76, 60, 0.2);
}

/* Reader Content */
.reader-content {
  flex: 1;
  min-width: 0;
}

.resume-prompt {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  margin-bottom: 16px;
  font-size: 0.9rem;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

/* PDF */
.pdf-reader {
  width: 100%;
}

.pdf-frame {
  width: 100%;
  height: calc(100vh - 120px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: #fff;
}

/* EPUB Reader (vue-book-reader) */
.epub-reader {
  height: calc(100vh - 120px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #0a0a1a;
  color: #e0e0e0;
}

/* Style vue-book-reader internal elements for dark theme */
.epub-reader :deep(.container) {
  background: #0a0a1a !important;
}
.epub-reader :deep(.readerArea) {
  background: #0a0a1a !important;
}
.epub-reader :deep(.titleArea) {
  color: #e0e0e0 !important;
}
.epub-reader :deep(.tocButton) {
  color: #e0e0e0 !important;
}
.epub-reader :deep(.tocArea) {
  background: #12122a !important;
}
.epub-reader :deep(.tocAreaButton) {
  color: #ccc !important;
}
.epub-reader :deep(.tocAreaButton:hover) {
  color: #00e8b8 !important;
}
.epub-reader :deep(.arrow) {
  color: #e0e0e0 !important;
}

/* FB2 */
.fb2-reader {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px;
  line-height: 1.8;
  color: var(--text-primary);
}

.fb2-chapter {
  margin-bottom: 32px;
}

.chapter-title {
  font-size: 1.4em;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--accent-teal);
}

.chapter-paragraph {
  margin-bottom: 1em;
  text-indent: 1.5em;
  color: var(--text-secondary);
}

/* TTS Modal */
.tts-modal {
  position: fixed;
  bottom: 80px;
  right: 24px;
  padding: 16px 24px;
  z-index: 200;
  cursor: pointer;
  max-width: 320px;
}

.tts-modal p {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin: 0;
}

/* Responsive */
@media (max-width: 768px) {
  .reader-layout {
    flex-direction: column;
  }

  .bookmarks-sidebar {
    width: 100%;
    position: static;
    max-height: none;
  }

  .reader-header {
    flex-wrap: wrap;
    gap: 10px;
  }

  .header-info {
    order: 3;
    flex-basis: 100%;
  }

  .pdf-frame {
    height: 60vh;
  }

  .fb2-reader {
    padding: 16px;
  }
}
</style>
