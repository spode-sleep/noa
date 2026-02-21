<template>
  <div class="page">
    <h1>Games</h1>

    <div class="filters glass">
      <div class="search-wrap">
        <input
          v-model="search"
          type="text"
          placeholder="Search by name or AppID..."
          class="search-input"
        />
        <button v-if="search" class="search-clear" @click="search = ''">
          <Icon icon="mdi:close" />
        </button>
      </div>
      <select v-model="sourceFilter" class="source-select">
        <option value="">All Sources</option>
        <option value="steam">Steam</option>
        <option value="rawg">RAWG</option>
      </select>
      <button class="tags-btn" @click="showTagModal = true">
        <Icon icon="mdi:tag-multiple" class="tags-icon" /> Tags
        <span v-if="selectedTags.size" class="tags-count">{{ selectedTags.size }}</span>
      </button>
    </div>

    <!-- Selected tags display -->
    <div v-if="selectedTags.size > 0" class="selected-tags">
      <button
        v-for="tag in [...selectedTags]"
        :key="tag"
        class="selected-tag-pill"
        @click="toggleTag(tag)"
        :title="'Remove ' + tag"
      >
        {{ tag }} ✕
      </button>
      <button class="clear-tags-btn" @click="clearAllTags">Clear all</button>
    </div>

    <!-- Tag selection modal -->
    <Teleport to="body">
      <div v-if="showTagModal" class="modal-overlay" @click.self="showTagModal = false" @keydown.esc="showTagModal = false">
        <div class="modal glass">
          <div class="modal-header">
            <h2>Select Tags</h2>
            <button class="modal-close" aria-label="Close tag selection" @click="showTagModal = false">✕</button>
          </div>
          <input
            v-model="tagSearch"
            type="text"
            placeholder="Search tags..."
            aria-label="Search tags"
            class="modal-search"
            ref="tagSearchRef"
          />
          <div class="modal-tags">
            <button
              v-for="tag in filteredTags"
              :key="tag"
              class="tag-pill"
              :class="{ active: selectedTags.has(tag) }"
              @click="toggleTag(tag)"
            >
              {{ tag }}
            </button>
            <div v-if="filteredTags.length === 0" class="modal-empty">No tags found.</div>
          </div>
          <div class="modal-footer">
            <span class="modal-count">{{ selectedTags.size }} selected</span>
            <button class="modal-done-btn" @click="showTagModal = false">Done</button>
          </div>
        </div>
      </div>
    </Teleport>

    <div v-if="loading" class="loading">Loading games...</div>

    <div v-else class="game-grid">
      <router-link
        v-for="game in displayedGames"
        :key="game.appId"
        :to="`/games/${game.appId}`"
        class="game-card glass"
      >
        <div class="game-image-wrap">
          <div class="game-image-skeleton"></div>
          <img
            :src="game.imageUrl"
            :alt="game.name"
            class="game-image"
            loading="lazy"
            @load="($event.target as HTMLImageElement).classList.add('loaded')"
          />
        </div>
        <div class="game-info">
          <div class="game-name">
            <span class="source-icon steam-icon" v-if="game.source === 'steam'" title="Steam" aria-label="Steam">
              <Icon icon="mdi:steam" width="22" height="22" />
            </span>
            <span class="source-icon rawg-icon" v-else title="RAWG" aria-label="RAWG">
              <Icon icon="mdi:gamepad-variant" width="22" height="22" />
            </span>
            {{ game.name }}
          </div>
          <div class="game-tags">
            <span v-for="tag in (game.tags || []).slice(0, 5)" :key="tag" class="game-tag">
              {{ tag }}
            </span>
          </div>
        </div>
        <span v-if="!game.isArchived" class="not-archived-badge" title="Not Archived" aria-label="Not Archived">
          <Icon icon="mdi:alert-circle" width="20" height="20" />
        </span>
      </router-link>

      <!-- Infinite scroll sentinel -->
      <div ref="sentinelRef" class="scroll-sentinel" v-if="displayedCount < filteredGames.length"></div>
    </div>

    <div v-if="!loading && filteredGames.length === 0" class="empty">
      No games found.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'

interface Game {
  appId: string
  name: string
  description?: string
  tags?: string[]
  source: string
  imageUrl: string
  protondb_reports?: any[]
  isArchived?: boolean
  archivePath?: string
}

const route = useRoute()
const router = useRouter()

const games = ref<Game[]>([])
const allTags = ref<string[]>([])
const search = ref((route.query.q as string) || '')
const sourceFilter = ref((route.query.source as string) || '')
const selectedTags = ref<Set<string>>(
  route.query.tag
    ? new Set(Array.isArray(route.query.tag) ? (route.query.tag as string[]) : [route.query.tag as string])
    : new Set()
)
const loading = ref(true)
const showTagModal = ref(false)
const tagSearch = ref('')
const tagSearchRef = ref<HTMLInputElement | null>(null)

const PAGE_SIZE = 48
const displayedCount = ref(PAGE_SIZE)
const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const displayedGames = computed(() => filteredGames.value.slice(0, displayedCount.value))

const filteredTags = computed(() => {
  if (!tagSearch.value) return allTags.value
  const lower = tagSearch.value.toLowerCase()
  return allTags.value.filter(t => t.toLowerCase().includes(lower))
})

const filteredGames = computed(() => {
  let result = games.value

  if (search.value) {
    const lower = search.value.toLowerCase()
    result = result.filter(g => g.name.toLowerCase().includes(lower) || g.appId.toLowerCase().includes(lower))
  }

  if (sourceFilter.value) {
    result = result.filter(g => g.source === sourceFilter.value)
  }

  if (selectedTags.value.size > 0) {
    result = result.filter(g =>
      [...selectedTags.value].every(tag => g.tags?.includes(tag))
    )
  }

  return result
})

function toggleTag(tag: string) {
  const next = new Set(selectedTags.value)
  if (next.has(tag)) {
    next.delete(tag)
  } else {
    next.add(tag)
  }
  selectedTags.value = next
}

function clearAllTags() {
  selectedTags.value = new Set()
}

watch(showTagModal, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) {
    tagSearch.value = ''
    nextTick(() => tagSearchRef.value?.focus())
  }
})

function syncQuery() {
  const query: Record<string, string | string[]> = {}
  if (search.value) query.q = search.value
  if (sourceFilter.value) query.source = sourceFilter.value
  if (selectedTags.value.size > 0) query.tag = [...selectedTags.value]
  router.replace({ query })
}

watch(search, () => { displayedCount.value = PAGE_SIZE; syncQuery() })
watch(sourceFilter, () => { displayedCount.value = PAGE_SIZE; syncQuery() })
watch(selectedTags, () => { displayedCount.value = PAGE_SIZE; syncQuery() })

watch(() => route.query, (q) => {
  search.value = (q.q as string) || ''
  sourceFilter.value = (q.source as string) || ''
  if (q.tag) {
    selectedTags.value = new Set(Array.isArray(q.tag) ? (q.tag as string[]) : [q.tag as string])
  } else {
    selectedTags.value = new Set()
  }
})

onMounted(async () => {
  document.title = 'Games - BOX'
  try {
    const [gamesRes, tagsRes] = await Promise.all([
      fetch('/api/games'),
      fetch('/api/games/tags'),
    ])
    games.value = await gamesRes.json()
    const tagsMap: Record<string, string> = await tagsRes.json()
    allTags.value = Object.keys(tagsMap).sort()
  } catch (e) {
    console.error('Failed to fetch games:', e)
  } finally {
    loading.value = false
  }

  await nextTick()
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && displayedCount.value < filteredGames.value.length) {
      displayedCount.value += PAGE_SIZE
    }
  }, { rootMargin: '200px' })

  watch(sentinelRef, (el) => {
    observer?.disconnect()
    if (el) observer?.observe(el)
  }, { immediate: true })
})

onUnmounted(() => {
  document.body.style.overflow = ''
  observer?.disconnect()
})
</script>

<style scoped>
.page {
  padding: 24px 0;
}

h1 {
  font-size: 2rem;
  margin-bottom: 16px;
  color: var(--askew-gold);
}

.filters {
  display: flex;
  gap: 12px;
  padding: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.search-input,
.source-select {
  background: var(--askew-input-bg);
  border: 1px solid var(--askew-input-border);
  border-radius: 0px;
  color: var(--text-primary);
  padding: 10px 14px;
  font-size: 0.95rem;
  outline: none;
}

.search-input {
  flex: 1;
  min-width: 200px;
}

.source-select {
  min-width: 140px;
}

.search-input:focus,
.source-select:focus {
  border-color: var(--askew-btn-hover);
}

/* Tags button */
.tags-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--askew-btn);
  border: 1px solid var(--askew-btn-border);
  border-radius: 0px;
  color: var(--text-primary);
  padding: 10px 16px;
  font-size: 0.95rem;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.tags-btn:hover {
  background: var(--askew-btn-hover);
  border-color: var(--askew-dark-border);
  color: var(--text-primary);
  box-shadow: inset 1px 1px 0 var(--askew-mint), inset -1px -1px 0 var(--askew-btn);
}

.tags-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  border-radius: 0px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--askew-tab-active);
  color: #fff;
  padding: 0 6px;
}

/* Selected tags bar */
.selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  align-items: center;
}

.selected-tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--askew-btn-disabled);
  border: 1px solid var(--askew-input-border);
  border-radius: 0px;
  color: var(--askew-gold);
  padding: 4px 12px;
  font-size: 0.8rem;
  cursor: pointer;
}

.selected-tag-pill:hover {
  background: var(--askew-red);
  border-color: var(--askew-red);
  color: var(--text-primary);
}

.clear-tags-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 4px 8px;
}

.clear-tags-btn:hover {
  color: var(--text-primary);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.modal {
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 12px;
  flex-shrink: 0;
}

.modal-header h2 {
  font-size: 1.2rem;
  color: var(--askew-gold);
}

.modal-close {
  background: var(--askew-btn);
  border: 1px solid var(--askew-btn-border);
  color: var(--text-primary);
  width: 32px;
  height: 32px;
  border-radius: 0px;
  cursor: pointer;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.modal-close:hover {
  background: var(--askew-btn-hover);
  border-color: var(--askew-dark-border);
  color: var(--text-primary);
  box-shadow: inset 1px 1px 0 var(--askew-mint), inset -1px -1px 0 var(--askew-btn);
}

.modal-search {
  margin: 0 24px 12px;
  background: var(--askew-input-bg);
  border: 1px solid var(--askew-input-border);
  border-radius: 0px;
  color: var(--text-primary);
  padding: 10px 14px;
  font-size: 0.95rem;
  outline: none;
  flex-shrink: 0;
}

.modal-search:focus {
  border-color: var(--askew-btn-hover);
}

.modal-tags {
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-content: flex-start;
}

.tag-pill {
  background: transparent;
  border: 1px solid var(--askew-btn-disabled);
  border-radius: 0px;
  color: var(--text-secondary);
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
}

.tag-pill:hover {
  border-color: var(--askew-cyan);
  color: var(--text-primary);
}

.tag-pill.active {
  background: var(--askew-tab-active);
  border: 1px solid var(--askew-btn-border);
  color: #fff;
  box-shadow: inset 1px 1px 0 var(--askew-gold), inset -1px -1px 0 var(--askew-tab-border);
}

.modal-empty {
  color: var(--text-muted);
  font-size: 0.9rem;
  padding: 16px 0;
  width: 100%;
  text-align: center;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px 20px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.modal-count {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.modal-done-btn {
  background: var(--askew-btn);
  border: 1px solid var(--askew-btn-border);
  color: var(--text-primary);
  padding: 8px 24px;
  border-radius: 0px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
}

.modal-done-btn:hover {
  background: var(--askew-btn-hover);
  border-color: var(--askew-dark-border);
  box-shadow: inset 1px 1px 0 var(--askew-mint), inset -1px -1px 0 var(--askew-btn);
}

.loading,
.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 0;
  font-size: 1.1rem;
}

.game-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
  gap: 16px;
}

.game-card {
  display: flex;
  flex-direction: row;
  overflow: hidden;
  text-decoration: none;
  color: var(--text-primary);
  position: relative;
  border: 1px solid var(--glass-border);
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  background: var(--glass-bg);
}

.not-archived-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  color: var(--askew-red);
  line-height: 1;
}

.game-card:hover {
  box-shadow: inset 2px 2px 0 var(--askew-btn), inset -2px -2px 0 var(--askew-dark-border);
}

.game-image-wrap {
  position: relative;
  width: 230px;
  min-width: 230px;
  aspect-ratio: 460 / 215;
  border-radius: 0px;
  overflow: hidden;
}

.game-image-skeleton {
  position: absolute;
  inset: 0;
  background: var(--bg-tertiary);
  animation: skeleton-pulse 1.5s infinite ease-in-out;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.game-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
}

.game-image.loaded {
  opacity: 1;
}

.scroll-sentinel {
  height: 1px;
  grid-column: 1 / -1;
}

.game-info {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.game-name {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.source-icon {
  flex-shrink: 0;
  display: inline-flex;
}

.steam-icon {
  color: var(--askew-cyan);
}

.rawg-icon {
  color: var(--askew-salmon);
}

.game-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.game-tag {
  font-size: 0.75rem;
  padding: 4px 12px;
  border-radius: 0px;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  background: var(--bg-tertiary);
}

@media (max-width: 560px) {
  .game-grid {
    grid-template-columns: 1fr;
  }

  .game-card {
    flex-direction: column;
  }

  .game-image-wrap {
    width: 100%;
    min-width: unset;
    border-radius: 0px;
  }

  .modal {
    max-width: 100%;
    max-height: 90vh;
  }
}
</style>
