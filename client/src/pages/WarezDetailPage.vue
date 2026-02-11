<template>
  <div class="page">
    <router-link to="/warez" class="btn btn-back">← Warez</router-link>

    <div v-if="loading" class="loading">Loading repository...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else-if="repo">
      <div class="repo-header">
        <h1>{{ repo.name }}</h1>
        <div v-if="repo.description" class="repo-desc">{{ repo.description }}</div>
        <div class="repo-meta">
          <span class="branch-badge">{{ repo.branch }}</span>
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'

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
  readme: string
  files: RepoFile[]
}

const route = useRoute()
const repo = ref<RepoDetail | null>(null)
const loading = ref(true)
const error = ref('')

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString()
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%"/>')

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
  } catch (e) {
    error.value = 'Failed to load repository'
  } finally {
    loading.value = false
  }
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
  margin-bottom: 20px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-back:hover {
  color: var(--text-primary);
  border-color: #f59e0b;
}

.loading,
.error {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 0;
  font-size: 1.1rem;
}

.error {
  color: #f44;
}

.repo-header {
  margin-bottom: 24px;
}

h1 {
  font-size: 2rem;
  margin-bottom: 8px;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
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
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
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
  color: #f59e0b;
  text-decoration: underline;
}

.readme-content :deep(code) {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.85rem;
}

.readme-content :deep(pre) {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
  max-width: 100%;
}

.readme-content :deep(strong) {
  color: var(--text-primary);
}
</style>
