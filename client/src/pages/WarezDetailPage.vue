<template>
  <div class="page">
    <a class="btn btn-back" @click="router.push('/warez')" style="cursor:pointer">← Warez</a>

    <div v-if="loading" class="loading">Loading repository...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else-if="repo">
      <div class="repo-header">
        <h1>{{ repo.name }}</h1>
        <div v-if="repo.description" class="repo-desc">{{ repo.description }}</div>
        <div class="repo-meta">
          <span v-if="repo.isGitRepo && repo.branch" class="branch-badge">{{ repo.branch }}</span>
          <span v-if="!repo.isGitRepo" class="folder-badge">folder</span>
          <span v-if="repo.commitCount" class="meta-item">{{ repo.commitCount }} commits</span>
          <span v-if="repo.lastCommitDate" class="meta-item">{{ formatDate(repo.lastCommitDate) }}</span>
        </div>
        <div v-if="repo.lastCommitMessage" class="last-commit">
          Latest: {{ repo.lastCommitMessage }}
        </div>
      </div>

      <!-- File tree -->
      <div v-if="repo.files?.length" class="files-section glass">
        <h2>Files</h2>
        <div class="file-list">
          <div v-for="file in repo.files" :key="file.name" class="file-item">
            <span class="file-icon">{{ file.type === 'directory' ? '📁' : '📄' }}</span>
            <span class="file-name">{{ file.name }}</span>
          </div>
        </div>
      </div>

      <!-- README -->
      <div v-if="repo.readme" class="readme-section glass">
        <h2>README</h2>
        <div class="readme-content" v-html="renderedReadme"></div>
      </div>

      <!-- Agent Chat Panel -->
      <div class="agent-section glass">
        <div class="agent-header" @click="agentOpen = !agentOpen">
          <h2>Agent</h2>
          <span class="agent-toggle">{{ agentOpen ? '▼' : '▶' }}</span>
        </div>
        <div v-if="!repo.isGitRepo && agentOpen" class="agent-git-hint">
          Git will be auto-initialized on first git operation
        </div>
        <div v-if="agentOpen" class="agent-body">
          <div class="agent-chat-area" ref="agentChatRef">
            <div
              v-for="(msg, i) in agentMessages"
              :key="i"
              class="message-row"
              :class="msg.role"
            >
              <div class="message-bubble" :class="msg.role === 'user' ? 'user-bubble' : 'glass'">
                <div class="message-content">{{ msg.content }}</div>
                <div v-if="msg.actions?.length" class="actions-list">
                  <span v-for="(act, ai) in msg.actions" :key="ai" class="action-tag" :title="act.result">
                    {{ act.tool }}
                  </span>
                </div>
              </div>
            </div>
            <div v-if="agentLoading" class="message-row assistant">
              <div class="message-bubble glass loading-bubble">
                <span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>
              </div>
            </div>
          </div>
          <div class="agent-input-area">
            <textarea
              ref="agentInputRef"
              v-model="agentInput"
              placeholder="Ask the agent..."
              rows="1"
              @input="agentAutoResize"
              @keydown.enter.exact.prevent="sendAgentMessage"
            ></textarea>
            <button class="send-btn" @click="sendAgentMessage" :disabled="!agentInput.trim() || agentLoading">
              Send
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'

interface RepoFile {
  name: string
  type: string
}

interface RepoDetail {
  name: string
  path: string
  description: string
  lastCommitDate: string
  lastCommitMessage: string
  branch: string
  commitCount: number
  isGitRepo: boolean
  readme: string
  files: RepoFile[]
}

interface AgentAction {
  tool: string
  args: Record<string, string>
  result: string
}

interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  actions?: AgentAction[]
}

const route = useRoute()
const router = useRouter()
const repo = ref<RepoDetail | null>(null)
const loading = ref(true)
const error = ref('')

// Agent chat state
const agentOpen = ref(false)
const agentMessages = ref<AgentMessage[]>([])
const agentInput = ref('')
const agentLoading = ref(false)
const agentChatRef = ref<HTMLElement | null>(null)
const agentInputRef = ref<HTMLTextAreaElement | null>(null)

function agentAutoResize() {
  const el = agentInputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

function scrollAgentChat() {
  nextTick(() => {
    if (agentChatRef.value) {
      agentChatRef.value.scrollTop = agentChatRef.value.scrollHeight
    }
  })
}

async function sendAgentMessage() {
  const text = agentInput.value.trim()
  if (!text || agentLoading.value) return
  agentMessages.value.push({ role: 'user', content: text })
  agentInput.value = ''
  if (agentInputRef.value) agentInputRef.value.style.height = 'auto'
  agentLoading.value = true
  scrollAgentChat()
  try {
    const history = agentMessages.value.slice(-20).map(m => ({ role: m.role, content: m.content }))
    const res = await fetch(`/api/warez/repos/${encodeURIComponent(route.params.name as string)}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history })
    })
    if (!res.ok) throw new Error('Agent request failed')
    const data = await res.json()
    agentMessages.value.push({
      role: 'assistant',
      content: data.content,
      actions: data.actions
    })
  } catch {
    agentMessages.value.push({ role: 'assistant', content: 'Error communicating with agent.' })
  } finally {
    agentLoading.value = false
    scrollAgentChat()
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString()
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function sanitizeUrl(url: string): string {
  const lower = url.toLowerCase().replace(/[\s\u00A0]+/g, '')
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return ''
  return url
}

function renderMarkdown(md: string): string {
  let html = escapeHtml(md)

  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Links (with URL sanitization)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    const safe = sanitizeUrl(url)
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>` : text
  })

  // Images (with URL sanitization)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    const safe = sanitizeUrl(url)
    return safe ? `<img alt="${alt}" src="${safe}" style="max-width:100%"/>` : ''
  })

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr/>')

  // Unordered lists
  html = html.replace(/^[\*\-]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

  // Line breaks - convert remaining newlines to paragraphs
  html = html
    .split(/\n\n+/)
    .map(block => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      if (trimmed.startsWith('<h') || trimmed.startsWith('<pre') || trimmed.startsWith('<ul') || trimmed.startsWith('<hr')) {
        return trimmed
      }
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`
    })
    .join('\n')

  return html
}

const renderedReadme = computed(() => {
  if (!repo.value?.readme) return ''
  return renderMarkdown(repo.value.readme)
})

onMounted(async () => {
  try {
    const res = await fetch(`/api/warez/repos/${route.params.name}`)
    if (!res.ok) {
      error.value = 'Repository not found'
      return
    }
    repo.value = await res.json()
    if (repo.value?.name) document.title = `${repo.value.name} - BOX`
  } catch (e) {
    error.value = 'Failed to load repository'
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  document.title = 'BOX'
})
</script>

<style scoped>

.btn-back {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  background: var(--askew-btn);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  color: var(--text-primary);
  font-size: 0.9rem;
  margin-bottom: 20px;
  cursor: pointer;
  text-decoration: none;
  line-height: 1;
}

.btn-back:hover {
  background: var(--askew-btn-hover);
  color: var(--text-primary);
}

.loading,
.error {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 0;
  font-size: 1.1rem;
}

.error {
  color: var(--askew-red);
}

.repo-header {
  margin-bottom: 24px;
}

h1 {
  font-size: 2rem;
  margin-bottom: 8px;
  color: var(--askew-gold);
}

.repo-desc {
  color: var(--text-secondary);
  font-size: 1rem;
  margin-bottom: 12px;
}

.repo-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.branch-badge {
  padding: 2px 10px;
  border-radius: 0px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--askew-btn-disabled);
  color: var(--askew-gold);
  border: 1px solid #000000;
}

.folder-badge {
  padding: 2px 10px;
  border-radius: 0px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--askew-btn-disabled);
  color: var(--text-secondary);
  border: 1px solid #000000;
}

.last-commit {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
}

/* File tree */
.files-section {
  padding: 16px;
  margin-bottom: 24px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-dark-border);
}

.files-section h2 {
  font-size: 1.1rem;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.file-list {
  display: flex;
  flex-direction: column;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 0.85rem;
  border-bottom: 1px solid var(--glass-border);
}

.file-item:last-child {
  border-bottom: none;
}

.file-icon {
  font-size: 0.9rem;
  flex-shrink: 0;
}

.file-name {
  color: var(--text-secondary);
}

/* README */
.readme-section {
  padding: 24px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-dark-border);
}

.readme-section h2 {
  font-size: 1.1rem;
  margin-bottom: 16px;
  color: var(--text-primary);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--glass-border);
}

.readme-content :deep(h1),
.readme-content :deep(h2),
.readme-content :deep(h3),
.readme-content :deep(h4),
.readme-content :deep(h5),
.readme-content :deep(h6) {
  color: var(--text-primary);
  margin: 20px 0 10px;
}

.readme-content :deep(h1) { font-size: 1.5rem; }
.readme-content :deep(h2) { font-size: 1.3rem; }
.readme-content :deep(h3) { font-size: 1.1rem; }

.readme-content :deep(p) {
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 12px;
}

.readme-content :deep(a) {
  color: var(--askew-cyan);
  text-decoration: underline;
}

.readme-content :deep(code) {
  background: var(--askew-input-bg);
  color: var(--askew-gold);
  padding: 1px 6px;
  border-radius: 0px;
  font-size: 0.85rem;
}

.readme-content :deep(pre) {
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  padding: 16px;
  overflow-x: auto;
  margin: 12px 0;
}

.readme-content :deep(pre code) {
  background: none;
  padding: 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.6;
}

.readme-content :deep(ul) {
  padding-left: 24px;
  margin-bottom: 12px;
}

.readme-content :deep(li) {
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 4px;
}

.readme-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--glass-border);
  margin: 20px 0;
}

.readme-content :deep(img) {
  border-radius: 0px;
  max-width: 100%;
}

.readme-content :deep(strong) {
  color: var(--text-primary);
}

/* Agent Chat Panel */
.agent-section {
  padding: 0;
  margin-top: 24px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-dark-border);
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
}

.agent-header h2 {
  font-size: 1.1rem;
  margin: 0;
  color: var(--text-primary);
}

.agent-toggle {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.agent-git-hint {
  padding: 0 16px 8px;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-style: italic;
}

.agent-body {
  border-top: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
}

.agent-chat-area {
  padding: 12px 16px;
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  font-size: 0.9rem;
  line-height: 1.5;
  word-break: break-word;
}

.message-bubble.glass {
  background: var(--glass-bg);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
  color: var(--text-secondary);
}

.message-bubble.user-bubble {
  background: var(--askew-tab-border);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-tab-inactive), inset -1px -1px 0 #2a0e18;
  color: var(--text-primary);
}

.message-content {
  white-space: pre-wrap;
}

.actions-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.action-tag {
  background: var(--askew-tab-inactive);
  color: var(--askew-cream);
  padding: 2px 8px;
  font-size: 0.7rem;
  border: 1px solid #000000;
  border-radius: 0px;
}

.loading-bubble {
  padding: 12px 20px;
}

.loading-dots span {
  color: var(--askew-gold);
  font-size: 1.4rem;
  animation: dot-blink 1.4s infinite both;
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

.agent-input-area {
  display: flex;
  align-items: flex-end;
  border-top: 1px solid var(--glass-border);
  background: var(--glass-bg);
}

.agent-input-area textarea {
  flex: 1;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.95rem;
  padding: 10px 14px;
  max-height: 160px;
  font-family: inherit;
  line-height: 1.4;
}

.agent-input-area textarea::placeholder {
  color: var(--text-muted);
}

.send-btn {
  background: var(--askew-btn);
  color: var(--text-primary);
  border: none;
  border-left: 1px solid #000000;
  padding: 10px 20px;
  cursor: pointer;
  font-size: 0.9rem;
  font-family: inherit;
  align-self: stretch;
}

.send-btn:hover:not(:disabled) {
  background: var(--askew-btn-hover);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
