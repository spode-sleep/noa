<template>
  <div class="page">
    <h1>Warez</h1>

    <div v-if="loading" class="loading">Loading repositories...</div>

    <div v-else-if="repos.length === 0" class="empty-state glass">
      <div class="empty-icon">📦</div>
      <h2>No repositories found</h2>
      <p>Place git repositories in your warez library directory.</p>
      <code>Configure path(s) in server .env file: WAREZ_LIBRARY_PATH=/path/to/repos</code>
    </div>

    <template v-else>
      <div v-if="repos.length > 0" class="toolbar glass">
        <div class="search-wrap">
          <input
            v-model="search"
            type="text"
            placeholder="Search repositories..."
            class="search-input"
          />
          <button v-if="search" class="search-clear" @click="search = ''">
            <Icon icon="mdi:close" />
          </button>
        </div>
      </div>

      <div class="repo-grid">
        <router-link
          v-for="repo in filteredRepos"
          :key="repo.name"
          :to="`/warez/${repo.name}`"
          class="repo-card glass"
        >
          <div class="repo-info">
            <div class="repo-name">{{ repo.name }}</div>
            <div v-if="repo.description" class="repo-desc">{{ repo.description }}</div>
            <div class="repo-meta">
              <span v-if="repo.isGitRepo && repo.branch" class="branch-badge">{{ repo.branch }}</span>
              <span v-if="!repo.isGitRepo" class="folder-badge">folder</span>
              <span v-if="repo.commitCount" class="repo-commits">{{ repo.commitCount }} commits</span>
              <span v-if="repo.lastCommitDate" class="repo-date">{{ formatDate(repo.lastCommitDate) }}</span>
            </div>
            <div v-if="repo.lastCommitMessage" class="repo-last-commit">
              {{ repo.lastCommitMessage }}
            </div>
          </div>
        </router-link>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'

interface Repo {
  name: string
  path: string
  description: string
  lastCommitDate: string
  lastCommitMessage: string
  branch: string
  commitCount: number
  isGitRepo: boolean
}

const route = useRoute()
const router = useRouter()

const repos = ref<Repo[]>([])
const search = ref((route.query.q as string) || '')
const loading = ref(true)

const filteredRepos = computed(() => {
  if (!search.value) return repos.value
  const q = search.value.toLowerCase()
  return repos.value.filter(r =>
    r.name.toLowerCase().includes(q) ||
    r.description.toLowerCase().includes(q)
  )
})

watch(search, (val) => {
  const query = val ? { q: val } : {}
  router.replace({ query })
})

watch(() => route.query, (q) => {
  search.value = (q.q as string) || ''
})

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString()
}

onMounted(async () => {
  document.title = 'Warez - BOX'
  try {
    const res = await fetch('/api/warez/repos')
    const data = await res.json()
    repos.value = data.repos || []
  } catch (e) {
    console.error('Failed to fetch repos:', e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>

h1 {
  font-size: 2rem;
  margin-bottom: 16px;
  color: var(--askew-gold);
}

.toolbar {
  display: flex;
  gap: 12px;
  padding: 16px;
  margin-bottom: 16px;
  align-items: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-dark-border);
}

.search-wrap {
  display: flex;
  flex: 1;
  min-width: 200px;
  position: relative;
}

.search-input {
  background: var(--askew-input-bg);
  border: 1px solid var(--askew-input-border);
  border-radius: 0px;
  color: var(--text-primary);
  padding: 10px 14px;
  font-size: 0.95rem;
  outline: none;
  flex: 1;
  min-width: 200px;
}

.search-input:focus {
  border-color: var(--askew-btn-hover);
}

.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
}

.search-clear:hover {
  color: var(--text-primary);
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
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-dark-border);
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
  background: var(--askew-input-bg);
  padding: 8px 16px;
  border-radius: 0px;
  color: var(--askew-gold);
  font-size: 0.85rem;
  word-break: break-all;
  border: 1px solid var(--askew-input-border);
}

/* Repo grid */
.repo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.repo-card {
  display: block;
  padding: 20px;
  text-decoration: none;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-dark-border);
}

.repo-card:hover {
  box-shadow: inset 2px 2px 0 var(--askew-btn), inset -2px -2px 0 var(--askew-dark-border);
}

.repo-name {
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 4px;
}

.repo-desc {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 10px;
  line-height: 1.4;
}

.repo-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.branch-badge {
  padding: 2px 8px;
  border-radius: 0px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  background: var(--askew-btn-disabled);
  color: var(--askew-gold);
  border: 1px solid #000000;
}

.folder-badge {
  padding: 2px 8px;
  border-radius: 0px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  background: var(--askew-btn-disabled);
  color: var(--text-secondary);
  border: 1px solid #000000;
}

.repo-last-commit {
  font-size: 0.8rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 560px) {
  .repo-grid {
    grid-template-columns: 1fr;
  }
}
</style>
