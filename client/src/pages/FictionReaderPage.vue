<template>
  <div class="reader-page">
    <div class="reader-header glass">
      <a class="btn btn-back" @click="router.push('/fiction')" style="cursor:pointer">← Library</a>
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
              <span v-if="book?.format === 'zim' && bm.page" class="bookmark-page">📖 ZIM page</span>
              <span v-else-if="bm.page && book?.format !== 'epub' && book?.format !== 'fb2'" class="bookmark-page">Page {{ bm.page }}</span>
              <span v-else-if="bm.page != null && (book?.format === 'epub' || book?.format === 'fb2')" class="bookmark-page">📖 {{ getBookmarkPercent(bm.page) }}%</span>
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
          <span>📖 You left off at {{ savedPositionLabel }}.</span>
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

        <!-- ZIM Reader (via kiwix-serve) -->
        <div v-else-if="book.format === 'zim'" class="pdf-reader">
          <iframe
            ref="zimIframeRef"
            :src="zimUrl"
            class="pdf-frame"
            title="ZIM Reader"
          ></iframe>
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
import { useRoute, useRouter } from 'vue-router'
import { VueReader } from 'vue-book-reader'
import { useTtsPlayer } from '../composables/useTtsPlayer'

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
const router = useRouter()
const bookId = route.params.id as string

const book = ref<Book | null>(null)
const loading = ref(true)
const showBookmarks = ref(false)
const newBookmarkNote = ref('')
const manualBookmarks = ref<ManualBookmark[]>([])
const savedPosition = ref<string | number | null>(null)
const positionRestored = ref(false)
const fontSize = ref(18)
const fb2Chapters = ref<Fb2Chapter[]>([])
const fb2Loading = ref(false)
const showTtsMessage = ref(false)
const ttsMessage = ref('')
const kiwixPort = 9454

// ZIM state
const zimIframeRef = ref<HTMLIFrameElement | null>(null)
const zimCurrentUrl = ref<string>('')
let zimUrlTimer: ReturnType<typeof setInterval> | null = null

const zimUrl = computed(() => {
  if (!book.value || book.value.format !== 'zim') return ''
  const port = (book.value as any).kiwixPort || kiwixPort
  const name = (book.value as any).zimName || book.value.title.replace(/\.zim$/i, '').replace(/ /g, '_')
  return `http://localhost:${port}/${name}`
})

// EPUB state
const epubUrl = computed(() => `/api/fiction/read/${bookId}`)
const readerRef = ref<any>(null) // template ref to VueReader component
const epubFraction = ref<number>(0) // 0-1 reading progress for display
const epubCfi = ref<string>('') // CFI string for precise bookmark navigation
const epubView = ref<any>(null) // foliate-view element reference for direct navigation

// FB2 scroll position tracking
const fb2ScrollRatio = ref<number>(0)
let fb2ScrollTimer: ReturnType<typeof setInterval> | null = null

function onFb2Scroll() {
  const h = document.documentElement.scrollHeight - window.innerHeight
  if (h > 0) fb2ScrollRatio.value = window.scrollY / h
}

const savedPositionLabel = computed(() => {
  if (savedPosition.value == null) return ''
  try {
    const parsed = JSON.parse(String(savedPosition.value))
    if (typeof parsed.fraction === 'number') return `${Math.round(parsed.fraction * 100)}%`
    if (typeof parsed.ratio === 'number') return `${Math.round(parsed.ratio * 100)}%`
    if (parsed.zimUrl) return 'ZIM page'
  } catch { /* plain number */ }
  return 'saved position'
})

function onEpubLocationChange(detail: any) {
  // vue-book-reader emits the full relocate detail object from foliate-view
  // It contains { fraction, cfi, tocItem, range, ... }
  if (detail && typeof detail === 'object') {
    if (typeof detail.fraction === 'number') {
      epubFraction.value = detail.fraction
    }
    if (typeof detail.cfi === 'string' && detail.cfi) {
      epubCfi.value = detail.cfi
    }
  }
}

function onRendition(view: any) {
  epubView.value = view // store reference for goToFraction() calls
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

function getBookmarkPercent(page: any): number {
  try {
    const parsed = JSON.parse(String(page))
    if (typeof parsed.fraction === 'number') return Math.round(parsed.fraction * 100)
    if (typeof parsed.ratio === 'number') return Math.round(parsed.ratio * 100)
    if (parsed.zimUrl) return -1 // Signal to display URL instead of percent
  } catch { /* legacy format */ }
  return Math.round(Number(page) * 100)
}

const { speak, getSelectedText } = useTtsPlayer()

async function readAloud() {
  const text = getSelectedText()
  if (text) {
    speak(text)
  } else {
    ttsMessage.value = 'Select text, then press 🔊 or Ctrl+Shift+S'
    showTtsMessage.value = true
  }
}

function addBookmark() {
  const note = newBookmarkNote.value.trim()
  let position: any = window.scrollY
  if (book.value?.format === 'epub') {
    position = JSON.stringify({ cfi: epubCfi.value, fraction: epubFraction.value })
  } else if (book.value?.format === 'fb2') {
    const h = document.documentElement.scrollHeight - window.innerHeight
    const ratio = h > 0 ? window.scrollY / h : 0
    position = JSON.stringify({ ratio })
  } else if (book.value?.format === 'zim') {
    const iframe = zimIframeRef.value
    let url = zimUrl.value
    try { if (iframe?.contentWindow?.location?.href) url = iframe.contentWindow.location.href } catch { /* cross-origin */ }
    position = JSON.stringify({ zimUrl: url })
  }
  const bm: ManualBookmark = {
    id: Date.now().toString(),
    note,
    page: position,
    created: new Date().toISOString(),
  }
  manualBookmarks.value.push(bm)
  localStorage.setItem(`noa-bookmarks-${bookId}`, JSON.stringify(manualBookmarks.value))
  newBookmarkNote.value = ''
}

function deleteBookmark(id: string) {
  manualBookmarks.value = manualBookmarks.value.filter(b => b.id !== id)
  localStorage.setItem(`noa-bookmarks-${bookId}`, JSON.stringify(manualBookmarks.value))
}

function restorePosition() {
  positionRestored.value = true
  if (savedPosition.value != null) {
    if (book.value?.format === 'epub') {
      let cfi: string | null = null
      try {
        const parsed = JSON.parse(String(savedPosition.value))
        if (parsed.cfi) cfi = parsed.cfi
      } catch { /* Legacy */ }
      if (cfi && epubView.value) {
        epubView.value.goTo(cfi)
      } else if (epubView.value) {
        epubView.value.goToFraction(Number(savedPosition.value))
      }
    } else if (book.value?.format === 'fb2') {
      let ratio = 0
      try {
        const parsed = JSON.parse(String(savedPosition.value))
        if (typeof parsed.ratio === 'number') ratio = parsed.ratio
      } catch {
        ratio = 0
      }
      // Delay to ensure content is rendered
      setTimeout(() => {
        const h = document.documentElement.scrollHeight - window.innerHeight
        if (h > 0) window.scrollTo({ top: ratio * h, behavior: 'smooth' })
      }, 200)
    } else if (book.value?.format === 'zim') {
      try {
        const parsed = JSON.parse(String(savedPosition.value))
        if (parsed.zimUrl && zimIframeRef.value) {
          zimIframeRef.value.src = parsed.zimUrl
        }
      } catch { /* ignore */ }
    } else {
      window.scrollTo({ top: Number(savedPosition.value), behavior: 'smooth' })
    }
  }
}

function navigateToBookmark(bm: ManualBookmark) {
  if (bm.page != null) {
    if (book.value?.format === 'epub') {
      // Parse the stored bookmark — may be JSON {cfi, fraction} or legacy fraction number
      let cfi: string | null = null
      try {
        const parsed = JSON.parse(String(bm.page))
        if (parsed.cfi) cfi = parsed.cfi
      } catch {
        // Legacy bookmark — fraction only, use goToFraction
      }
      if (cfi && epubView.value) {
        epubView.value.goTo(cfi)
      } else if (epubView.value) {
        epubView.value.goToFraction(Number(bm.page))
      }
    } else if (book.value?.format === 'fb2') {
      let ratio = 0
      try {
        const parsed = JSON.parse(String(bm.page))
        if (typeof parsed.ratio === 'number') ratio = parsed.ratio
      } catch {
        // Legacy: raw scroll number — use as-is
        window.scrollTo({ top: Number(bm.page), behavior: 'smooth' })
        return
      }
      const h = document.documentElement.scrollHeight - window.innerHeight
      if (h > 0) window.scrollTo({ top: ratio * h, behavior: 'smooth' })
    } else if (book.value?.format === 'pdf') {
      const iframe = document.querySelector('.pdf-frame') as HTMLIFrameElement
      if (iframe) {
        iframe.src = `/api/fiction/read/${book.value.id}#page=${bm.page}`
      }
    } else if (book.value?.format === 'zim') {
      try {
        const parsed = JSON.parse(String(bm.page))
        if (parsed.zimUrl && zimIframeRef.value) {
          zimIframeRef.value.src = parsed.zimUrl
        }
      } catch { /* ignore */ }
    } else {
      window.scrollTo({ top: Number(bm.page), behavior: 'smooth' })
    }
  }
}

function savePosition() {
  let positionData: any = window.scrollY
  if (book.value?.format === 'epub') {
    positionData = JSON.stringify({ cfi: epubCfi.value, fraction: epubFraction.value })
  } else if (book.value?.format === 'fb2') {
    positionData = JSON.stringify({ ratio: fb2ScrollRatio.value })
  } else if (book.value?.format === 'zim') {
    const iframe = zimIframeRef.value
    let url = zimUrl.value
    try { if (iframe?.contentWindow?.location?.href) url = iframe.contentWindow.location.href } catch { /* cross-origin */ }
    positionData = JSON.stringify({ zimUrl: url })
  }
  localStorage.setItem(`noa-position-${bookId}`, String(positionData))
}

async function fetchBook() {
  try {
    const res = await fetch(`/api/fiction/books/${bookId}`)
    if (res.ok) {
      book.value = await res.json()
      if (book.value?.title) document.title = `${book.value.title} - BOX`
    }
  } catch (e) {
    console.error('Failed to fetch book:', e)
  }
}

function loadBookmarks() {
  try {
    const stored = localStorage.getItem(`noa-bookmarks-${bookId}`)
    if (stored) manualBookmarks.value = JSON.parse(stored)
    const pos = localStorage.getItem(`noa-position-${bookId}`)
    if (pos) savedPosition.value = pos
  } catch {
    // Ignore parse errors
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
    loadBookmarks()
    await fetchFb2Content()
    // Set up FB2 scroll tracking
    if (book.value?.format === 'fb2') {
      window.addEventListener('scroll', onFb2Scroll)
      fb2ScrollTimer = setInterval(savePosition, 10000) // save every 10s
    }
    // Set up ZIM URL tracking
    if (book.value?.format === 'zim') {
      zimUrlTimer = setInterval(savePosition, 5000) // save every 5s
    }
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  document.title = 'BOX'
  savePosition()
  if (fb2ScrollTimer) clearInterval(fb2ScrollTimer)
  if (zimUrlTimer) clearInterval(zimUrlTimer)
  window.removeEventListener('scroll', onFb2Scroll)
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
