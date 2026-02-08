<template>
  <div class="chat-page">
    <!-- Header -->
    <div class="chat-header glass">
      <h1>AI Assistant</h1>
      <div class="header-right">
        <span class="ai-status" :class="{ online: aiStatus.available }">
          AI: {{ aiStatus.available ? 'Online' : 'Not configured' }}
        </span>
        <button class="new-dialog-btn" @click="clearChat">New Dialog</button>
      </div>
    </div>

    <!-- Context indicator -->
    <div v-if="chatStarted && activeContextLabel" class="context-indicator glass">
      Connected: {{ activeContextLabel }}
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
            Read Aloud 🔊
          </button>
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
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'

const messages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([])
const input = ref('')
const loading = ref(false)
const musicLibraryEnabled = ref(false)
const fictionLibraryEnabled = ref(false)
const chatStarted = ref(false)
const aiStatus = ref<{ available: boolean; message: string }>({ available: false, message: '' })

const chatAreaRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const activeContextLabel = computed(() => {
  const parts: string[] = []
  if (musicLibraryEnabled.value) parts.push('Music')
  if (fictionLibraryEnabled.value) parts.push('Fiction')
  return parts.join(', ')
})

function formatContent(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\n{2,}/g, '</p><p>')
  html = '<p>' + html + '</p>'
  return html
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

watch(messages, scrollToBottom, { deep: true })

async function sendMessage() {
  const text = input.value.trim()
  if (!text || loading.value) return

  messages.value.push({ role: 'user', content: text })
  chatStarted.value = true
  input.value = ''

  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }

  loading.value = true
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: messages.value,
        context: {
          musicLibrary: musicLibraryEnabled.value,
          fictionLibrary: fictionLibraryEnabled.value,
        },
      }),
    })
    const data = await res.json()
    messages.value.push({ role: 'assistant', content: data.content ?? data.response ?? 'No response.' })
  } catch {
    messages.value.push({ role: 'assistant', content: 'Error: Could not reach the AI service.' })
  } finally {
    loading.value = false
  }
}

async function readAloud(text: string) {
  try {
    const res = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      alert('TTS not configured')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play()
  } catch {
    alert('TTS not configured')
  }
}

function clearChat() {
  messages.value = []
  input.value = ''
  chatStarted.value = false
  musicLibraryEnabled.value = false
  fictionLibraryEnabled.value = false
}

onMounted(async () => {
  try {
    const res = await fetch('/api/ai/status')
    const data = await res.json()
    aiStatus.value = { available: data.available ?? false, message: data.message ?? '' }
  } catch {
    aiStatus.value = { available: false, message: 'Unable to reach AI service' }
  }
})
</script>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 80px - 24px - 48px);
  padding: 0;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  flex-shrink: 0;
}

.chat-header h1 {
  font-size: 1.5rem;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-teal));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-status {
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: rgba(255, 60, 60, 0.15);
  color: #ff6b6b;
  border: 1px solid rgba(255, 60, 60, 0.2);
}

.ai-status.online {
  background: rgba(0, 212, 170, 0.15);
  color: var(--accent-teal);
  border-color: rgba(0, 212, 170, 0.2);
}

.new-dialog-btn {
  padding: 6px 14px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: var(--glass-bg);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.85rem;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.new-dialog-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent-teal);
}

.context-indicator {
  padding: 8px 16px;
  margin: 8px 0;
  font-size: 0.85rem;
  color: var(--accent-teal);
  flex-shrink: 0;
}

.library-switches {
  padding: 16px 20px;
  margin: 8px 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
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
  background: rgba(255, 255, 255, 0.1);
  border-radius: 11px;
  position: relative;
  transition: background var(--transition-fast);
  flex-shrink: 0;
}

.toggle-slider::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  background: var(--text-secondary);
  border-radius: 50%;
  transition: transform var(--transition-fast), background var(--transition-fast);
}

.toggle-switch input:checked + .toggle-slider {
  background: rgba(0, 212, 170, 0.3);
}

.toggle-switch input:checked + .toggle-slider::after {
  transform: translateX(18px);
  background: var(--accent-teal);
}

.toggle-text {
  font-size: 0.9rem;
  color: var(--text-secondary);
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
  border-radius: var(--radius-md);
  line-height: 1.5;
  word-wrap: break-word;
}

.user-bubble {
  background: rgba(0, 212, 170, 0.18);
  border: 1px solid rgba(0, 212, 170, 0.25);
  color: var(--text-primary);
}

.message-content :deep(p) {
  margin-bottom: 8px;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(strong) {
  color: #fff;
}

.tts-btn {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 10px;
  font-size: 0.75rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
}

.tts-btn:hover {
  color: var(--accent-teal);
  border-color: var(--accent-teal);
}

.loading-bubble {
  padding: 12px 20px;
}

.loading-dots span {
  animation: dot-blink 1.4s infinite both;
  font-size: 1.4rem;
  color: var(--text-muted);
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

/* Input area */
.input-area {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 16px;
  margin: 0;
  flex-shrink: 0;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
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
}

.input-area textarea::placeholder {
  color: var(--text-muted);
}

.send-btn {
  padding: 8px 20px;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-blue));
  border: none;
  border-radius: var(--radius-sm);
  color: var(--bg-primary);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: opacity var(--transition-fast);
  flex-shrink: 0;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn:not(:disabled):hover {
  opacity: 0.85;
}
</style>
