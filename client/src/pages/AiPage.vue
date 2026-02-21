<template>
  <div class="chat-layout">
    <!-- Sidebar -->
    <aside class="sidebar glass">
      <button class="new-chat-btn" @click="createNewConversation">
        <Icon icon="mdi:plus" />
        New Chat
      </button>
      <div class="conversation-list">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          class="conversation-item"
          :class="{ active: conv.id === activeConversationId, loading: loadingConversationIds.has(conv.id) }"
          @click="switchConversation(conv.id)"
        >
          <div class="conversation-title-row">
            <template v-if="renamingId === conv.id">
              <input
                class="rename-input"
                v-model="renameValue"
                @keydown.enter="finishRename(conv.id)"
                @blur="finishRename(conv.id)"
                @click.stop
                ref="renameInputRef"
              />
            </template>
            <span v-else class="conversation-title">{{ conv.title }}</span>
          </div>
          <div class="conversation-actions" @click.stop>
            <span v-if="loadingConversationIds.has(conv.id)" class="conv-loading"><Icon icon="mdi:loading" class="spin" /></span>
            <button class="icon-btn" @click="startRename(conv)" title="Rename">
              <Icon icon="mdi:pencil" />
            </button>
            <button class="icon-btn delete-btn" @click="deleteConversation(conv.id)" title="Delete">
              <Icon icon="mdi:delete" />
            </button>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main chat panel -->
    <div class="chat-page">
      <!-- Header -->
      <div class="chat-header glass">
        <h1>AI Librarian</h1>
        <div class="header-right">
          <span v-if="selectedModel" class="model-badge">{{ selectedModel }}</span>
          <span class="ai-status" :class="{ online: aiStatus.available }">
            AI: {{ aiStatus.available ? 'Online' : 'Not configured' }}
            <template v-if="ragStatus.ready"> · RAG: {{ ragStatus.backend === 'chromadb' ? 'ChromaDB' : ragStatus.chunksIndexed + ' chunks' }}</template>
          </span>
        </div>
      </div>

      <!-- Context indicator -->
      <div v-if="chatStarted && activeContextLabel" class="context-indicator glass">
        <span>Connected: {{ activeContextLabel }}</span>
      </div>

      <!-- Library switches (visible only before first message) -->
      <div v-if="!chatStarted" class="library-switches glass">
        <p class="switches-label">Enable to include library metadata in AI context</p>
        <label class="toggle-switch">
          <input type="checkbox" v-model="musicLibraryEnabled" />
          <span class="toggle-slider"></span>
          <span class="toggle-text">Music Library</span>
        </label>
        <label class="toggle-switch">
          <input type="checkbox" v-model="fictionLibraryEnabled" />
          <span class="toggle-slider"></span>
          <span class="toggle-text">Fiction Library</span>
        </label>
        <div v-if="availableModels.length > 1" class="model-selector">
          <label class="model-label">Model</label>
          <select v-model="selectedModel" class="model-dropdown">
            <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <button class="index-btn" @click="buildIndex" :disabled="ragStatus.indexing">
          {{ ragStatus.indexing ? 'Indexing...' : ragStatus.ready ? 'Rebuild RAG Index' : 'Build RAG Index' }}
        </button>
      </div>

      <!-- Chat area -->
      <div class="chat-area" ref="chatAreaRef">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="message-row"
          :class="msg.role"
        >
          <div class="message-bubble" :class="msg.role === 'user' ? 'user-bubble' : 'glass'">
            <div class="message-content" v-html="formatContent(msg.content)"></div>
            <button
              v-if="msg.role === 'assistant'"
              class="tts-btn"
              @click="readAloud(msg.content)"
            >
              Read Aloud <Icon icon="mdi:volume-high" width="20" height="20" style="color: var(--askew-gold); vertical-align: middle" />
            </button>
            <div v-if="msg.sources?.length" class="sources-list">
              <span class="sources-label">Sources:</span>
              <span v-for="(src, si) in msg.sources" :key="si" class="source-tag">{{ src }}</span>
            </div>
          </div>
        </div>
        <div v-if="loading" class="message-row assistant">
          <div class="message-bubble glass loading-bubble">
            <span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>
          </div>
        </div>
      </div>

      <!-- Input area -->
      <div class="input-area glass">
        <textarea
          ref="textareaRef"
          v-model="input"
          placeholder="Type a message..."
          rows="1"
          @input="autoResize"
          @keydown.enter.exact.prevent="sendMessage"
        ></textarea>
        <button class="send-btn" @click="sendMessage" :disabled="!input.trim() || loading">
          Send
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { Icon } from '@iconify/vue'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'
import { useTtsPlayer } from '../composables/useTtsPlayer'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  model?: string
}

const { speak } = useTtsPlayer()

const STORAGE_KEY = 'box-ai-conversations'

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveConversations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.value))
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const conversations = ref<Conversation[]>(loadConversations())
const activeConversationId = ref<string>('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement[] | null>(null)

const messages = ref<Message[]>([])
const input = ref('')
const loadingConversationIds = reactive(new Set<string>())
const loading = computed(() => loadingConversationIds.has(activeConversationId.value))
const musicLibraryEnabled = ref(false)
const fictionLibraryEnabled = ref(false)
const chatStarted = ref(false)
const selectedModel = ref('')
const availableModels = ref<string[]>([])
const defaultModel = ref('')
const aiStatus = ref<{ available: boolean; message: string }>({ available: false, message: '' })
const ragStatus = ref<{ ready: boolean; chunksIndexed: number; indexing: boolean; backend: string }>({ ready: false, chunksIndexed: 0, indexing: false, backend: 'none' })

const chatAreaRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const activeContextLabel = computed(() => {
  const parts: string[] = []
  if (musicLibraryEnabled.value) parts.push('Music')
  if (fictionLibraryEnabled.value) parts.push('Fiction')
  return parts.join(', ')
})

// --- Conversation management ---

function createNewConversation() {
  const conv: Conversation = {
    id: generateId(),
    title: new Date().toLocaleString(),
    messages: [],
    createdAt: new Date().toISOString(),
  }
  conversations.value.unshift(conv)
  switchConversation(conv.id)
  saveConversations()
}

function switchConversation(id: string) {
  syncCurrentConversation()
  activeConversationId.value = id
  const conv = conversations.value.find(c => c.id === id)
  if (conv) {
    messages.value = conv.messages
    chatStarted.value = conv.messages.length > 0
    selectedModel.value = conv.model || defaultModel.value
  }
}

function syncCurrentConversation() {
  const conv = conversations.value.find(c => c.id === activeConversationId.value)
  if (conv) {
    conv.messages = messages.value
    conv.model = selectedModel.value
    saveConversations()
  }
}

function deleteConversation(id: string) {
  if (!confirm('Delete this conversation?')) return
  conversations.value = conversations.value.filter(c => c.id !== id)
  saveConversations()
  if (activeConversationId.value === id) {
    if (conversations.value.length > 0) {
      switchConversation(conversations.value[0].id)
    } else {
      activeConversationId.value = ''
      messages.value = []
      chatStarted.value = false
    }
  }
}

function startRename(conv: Conversation) {
  renamingId.value = conv.id
  renameValue.value = conv.title
  nextTick(() => {
    if (renameInputRef.value && renameInputRef.value.length > 0) {
      renameInputRef.value[0].focus()
    }
  })
}

function finishRename(id: string) {
  const conv = conversations.value.find(c => c.id === id)
  if (conv && renameValue.value.trim()) {
    conv.title = renameValue.value.trim()
    saveConversations()
  }
  renamingId.value = null
}

// --- Existing chat logic ---

function formatContent(text: string): string {
  // Extract code blocks first to protect them from escaping
  const codeBlocks: string[] = []
  let processed = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const trimmedCode = code.replace(/^\n+|\n+$/g, '')
    let highlighted: string
    try {
      highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(trimmedCode, { language: lang }).value
        : hljs.highlightAuto(trimmedCode).value
    } catch {
      highlighted = trimmedCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    const safeLang = (lang || 'code').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`
    codeBlocks.push(
      `<div class="code-block"><div class="code-header"><span class="code-lang">${safeLang}</span><button class="code-copy-btn" data-code="${encodeURIComponent(trimmedCode)}" title="Copy"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/></svg></button></div><pre><code class="hljs">${highlighted}</code></pre></div>`
    )
    return placeholder
  })

  // Escape HTML in remaining text
  processed = processed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Inline code
  processed = processed.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Bold
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Paragraphs
  processed = processed.replace(/\n{2,}/g, '</p><p>')
  processed = '<p>' + processed + '</p>'

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`__CODE_BLOCK_${i}__`, block)
  })

  return processed
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

function scrollToBottom() {
  nextTick(() => {
    if (chatAreaRef.value) {
      chatAreaRef.value.scrollTop = chatAreaRef.value.scrollHeight
    }
  })
}

watch(messages, () => {
  scrollToBottom()
  syncCurrentConversation()
}, { deep: true })

async function sendMessage() {
  const text = input.value.trim()
  if (!text) return
  if (loadingConversationIds.has(activeConversationId.value)) return

  // Create conversation lazily on first message
  if (!activeConversationId.value) {
    createNewConversation()
  }

  const currentConvId = activeConversationId.value
  messages.value.push({ role: 'user', content: text })
  chatStarted.value = true
  input.value = ''
  syncCurrentConversation()

  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }

  function pushResponse(msg: Message) {
    const conv = conversations.value.find(c => c.id === currentConvId)
    if (conv) {
      conv.messages.push(msg)
      if (activeConversationId.value === currentConvId) {
        messages.value = conv.messages
      }
      saveConversations()
    }
  }

  loadingConversationIds.add(currentConvId)
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: conversations.value.find(c => c.id === currentConvId)?.messages || [],
        model: selectedModel.value,
        context: {
          musicLibrary: musicLibraryEnabled.value,
          fictionLibrary: fictionLibraryEnabled.value,
        },
      }),
    })
    const data = await res.json()
    pushResponse({
      role: 'assistant',
      content: data.content ?? data.response ?? 'No response.',
      sources: data.sources?.length ? data.sources : undefined,
    })
  } catch {
    pushResponse({ role: 'assistant', content: 'Error: Could not reach the AI service.' })
  } finally {
    loadingConversationIds.delete(currentConvId)
  }
}

async function readAloud(text: string) {
  speak(text)
}

function clearChat() {
  createNewConversation()
  musicLibraryEnabled.value = false
  fictionLibraryEnabled.value = false
}

async function buildIndex() {
  ragStatus.value.indexing = true
  try {
    const res = await fetch('/api/ai/index', { method: 'POST' })
    const data = await res.json()
    ragStatus.value = { ready: true, chunksIndexed: data.indexed ?? 0, indexing: false, backend: 'unknown' }
  } catch {
    ragStatus.value.indexing = false
  }
}

const copySvg = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/></svg>'
const checkSvg = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>'

function handleCodeCopy(e: Event) {
  const el = e.target
  if (!(el instanceof Element)) return
  const target = el.closest('.code-copy-btn') as HTMLElement | null
  if (!target) return
  const code = decodeURIComponent(target.dataset.code || '')
  navigator.clipboard.writeText(code).then(() => {
    target.innerHTML = checkSvg
    target.classList.add('copied')
    setTimeout(() => {
      target.innerHTML = copySvg
      target.classList.remove('copied')
    }, 1500)
  }).catch(() => {})
}

onMounted(async () => {
  document.title = 'AI Librarian - BOX'
  document.documentElement.style.overflow = 'hidden'
  document.addEventListener('click', handleCodeCopy)

  // Load existing conversations, but don't create new one (lazy creation on first message)
  if (conversations.value.length > 0) {
    switchConversation(conversations.value[0].id)
  }

  try {
    const res = await fetch('/api/ai/status')
    const data = await res.json()
    aiStatus.value = { available: data.available ?? false, message: data.message ?? '' }
    if (data.models) {
      availableModels.value = data.models
    }
    if (data.defaultModel) {
      defaultModel.value = data.defaultModel
      if (!selectedModel.value) {
        selectedModel.value = data.defaultModel
      }
    }
    if (data.rag) {
      ragStatus.value = { ready: data.rag.ready ?? false, chunksIndexed: data.rag.chunksIndexed ?? 0, indexing: data.rag.indexing ?? false, backend: data.rag.backend ?? 'unknown' }
    }
  } catch {
    aiStatus.value = { available: false, message: 'Unable to reach AI service' }
  }
})

onBeforeUnmount(() => {
  document.documentElement.style.overflow = ''
  document.removeEventListener('click', handleCodeCopy)
})
</script>

<style scoped>
.chat-layout {
  display: flex;
  gap: 16px;
  height: calc(100vh - 100px);
  overflow: hidden;
}

/* Sidebar */
.sidebar {
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  border: 1px solid var(--askew-dark-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
  overflow: hidden;
}

.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 16px);
  margin: 12px 8px;
  padding: 10px 14px;
  border: 1px solid var(--askew-tab-border);
  border-radius: 0px;
  background: var(--askew-cream);
  color: var(--bg-primary);
  cursor: pointer;
  font-size: 0.9rem;
  box-shadow: inset 1px 1px 0 var(--askew-container-light), inset -1px -1px 0 var(--askew-tab-border);
}

.new-chat-btn:hover {
  background: var(--bg-tertiary);
}

.conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
}

.conversation-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  margin-bottom: 2px;
  border-radius: 0px;
  cursor: pointer;
  background: var(--askew-btn);
  border: 1px solid var(--askew-btn-border);
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.conversation-item:hover {
  background: var(--askew-btn-hover);
  color: var(--bg-primary);
}

.conversation-item.active {
  background: var(--askew-blue);
  border: 1px solid var(--askew-tab-border);
  box-shadow: inset 1px 1px 0 var(--askew-blue-light), inset -1px -1px 0 var(--askew-tab-border);
}

.conversation-title-row {
  flex: 1;
  min-width: 0;
}

.conversation-title {
  display: block;
  font-size: 0.82rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conversation-item.active .conversation-title {
  color: var(--bg-primary);
}

.conv-loading {
  color: var(--askew-gold);
  display: inline-flex;
  align-items: center;
}

.conv-loading .spin {
  animation: spin 1s linear infinite;
  font-size: 0.9rem;
}

.rename-input {
  width: 100%;
  background: var(--askew-input-bg);
  border: 1px solid var(--askew-input-border);
  border-radius: 0px;
  color: var(--text-primary);
  font-size: 0.82rem;
  padding: 2px 6px;
  outline: none;
}

.conversation-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
}

.conversation-item:hover .conversation-actions,
.conversation-item.active .conversation-actions,
.conversation-item.loading .conversation-actions {
  opacity: 1;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 0px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.9rem;
}

.icon-btn:hover {
  color: var(--text-primary);
  background: transparent;
}

.icon-btn.delete-btn:hover {
  color: var(--askew-red);
  background: transparent;
}

/* Main chat panel */
.chat-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  flex-shrink: 0;
  background: var(--glass-bg);
  border: 1px solid var(--askew-dark-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
}

.chat-header h1 {
  font-size: 1.5rem;
  color: var(--askew-gold);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-status {
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 0px;
  background: var(--askew-container);
  color: var(--text-primary);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-container-light), inset -1px -1px 0 var(--askew-tab-border);
  display: inline-flex;
  align-items: center;
  line-height: 1.2;
}

.ai-status.online {
  background: var(--askew-btn);
  color: var(--text-primary);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.new-dialog-btn {
  padding: 6px 14px;
  border: 1px solid var(--askew-btn-border);
  border-radius: 0px;
  background: var(--askew-btn);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.85rem;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.new-dialog-btn:hover {
  background: var(--askew-btn-hover);
  color: var(--bg-primary);
}

.context-indicator {
  padding: 8px 16px;
  margin: 8px 0;
  font-size: 0.85rem;
  color: var(--askew-mint);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--askew-dark-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
}

.model-badge {
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 0px;
  background: var(--askew-tab-inactive);
  color: var(--askew-cream);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-container), inset -1px -1px 0 var(--askew-tab-border);
  display: inline-flex;
  align-items: center;
  line-height: 1.2;
}

.library-switches {
  padding: 16px 20px;
  margin: 8px 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
  background: var(--glass-bg);
  border: 1px solid var(--askew-dark-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
}

.switches-label {
  width: 100%;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.toggle-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.toggle-switch input {
  display: none;
}

.toggle-slider {
  width: 40px;
  height: 22px;
  background: var(--askew-btn-disabled);
  border-radius: 0px;
  border: 1px solid #000000;
  position: relative;
  flex-shrink: 0;
}

.toggle-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--text-secondary);
  border-radius: 0px;
  transition: transform 0.15s, background 0.15s;
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--askew-btn);
}

.toggle-switch input:checked + .toggle-slider::after {
  transform: translateX(18px);
  background: var(--askew-gold);
}

.toggle-text {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

/* Model selector */
.model-selector {
  display: flex;
  align-items: center;
  gap: 10px;
}

.model-label {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.model-dropdown {
  padding: 6px 12px;
  border: 1px solid var(--askew-input-border);
  border-radius: 0px;
  background: var(--askew-input-bg);
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  outline: none;
}

.model-dropdown:hover,
.model-dropdown:focus {
  border-color: var(--askew-mint);
}

.model-dropdown option {
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* Chat area */
.chat-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-row {
  display: flex;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 70%;
  padding: 12px 16px;
  border-radius: 0px;
  line-height: 1.5;
  word-wrap: break-word;
  background: var(--glass-bg);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
  color: var(--text-primary);
}

.user-bubble {
  background: var(--askew-tab-border);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-tab-inactive), inset -1px -1px 0 #2a0e18;
  color: var(--text-primary);
}

.message-content :deep(p) {
  margin-bottom: 8px;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(strong) {
  color: var(--askew-cream);
}

.message-content :deep(a) {
  color: var(--askew-cyan);
}

.tts-btn {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 10px;
  font-size: 0.75rem;
  background: var(--askew-btn);
  border: 1px solid var(--askew-btn-border);
  border-radius: 0px;
  color: var(--text-primary);
  cursor: pointer;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.tts-btn:hover {
  background: var(--askew-btn-hover);
  color: var(--bg-primary);
}

.sources-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--askew-dark-border);
}

.sources-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 500;
}

.source-tag {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 0px;
  background: var(--askew-tab-inactive);
  color: var(--askew-cream);
  border: 1px solid #000000;
}

.index-btn {
  padding: 6px 14px;
  border: 1px solid var(--askew-btn-border);
  border-radius: 0px;
  background: var(--askew-btn);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.8rem;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.index-btn:hover:not(:disabled) {
  background: var(--askew-btn-hover);
  color: var(--bg-primary);
}

.index-btn:disabled {
  background: var(--askew-btn-disabled);
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-bubble {
  padding: 12px 20px;
}

.loading-dots span {
  animation: dot-blink 1.4s infinite both;
  font-size: 1.4rem;
  color: var(--askew-gold);
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dot-blink {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Input area */
.input-area {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0;
  margin: 0;
  flex-shrink: 0;
  border-radius: 0px;
  background: var(--askew-input-bg);
  border: 1px solid var(--askew-input-border);
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
}

.input-area textarea {
  flex: 1;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  max-height: 160px;
  padding: 10px 14px;
}

.input-area textarea::placeholder {
  color: var(--text-muted);
}

.send-btn {
  padding: 10px 20px;
  background: var(--askew-btn);
  border: none;
  border-left: 1px solid #000000;
  border-radius: 0px;
  color: var(--text-primary);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  flex-shrink: 0;
  align-self: stretch;
}

.send-btn:disabled {
  background: var(--askew-btn-disabled);
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}

.send-btn:not(:disabled):hover {
  background: var(--askew-btn-hover);
  color: var(--bg-primary);
}

/* Code blocks (v-html content needs :deep) */
:deep(.code-block) {
  margin: 12px 0;
  border-radius: 0px;
  overflow: hidden;
  border: 1px solid #000000;
}

:deep(.code-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  background: var(--askew-btn-disabled);
  border-bottom: 1px solid #000000;
}

:deep(.code-lang) {
  font-size: 0.8rem;
  color: var(--askew-gold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

:deep(.code-copy-btn) {
  background: var(--askew-btn);
  border: 1px solid var(--askew-btn-border);
  color: var(--text-primary);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

:deep(.code-copy-btn:hover) {
  background: var(--askew-btn-hover);
  color: var(--bg-primary);
}

:deep(.code-copy-btn.copied) {
  background: var(--askew-btn);
  color: var(--askew-mint);
}

:deep(.code-block pre) {
  margin: 0;
  padding: 0;
  overflow-x: auto;
  background: var(--askew-btn-disabled);
}

:deep(.code-block code) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.85rem;
  line-height: 1.6;
}

:deep(.inline-code) {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.82rem;
  padding: 1px 6px;
  border-radius: 0px;
  background: var(--askew-btn-disabled);
  color: var(--askew-cream);
  border: 1px solid #000000;
}
</style>
