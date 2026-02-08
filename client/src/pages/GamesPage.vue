<template>
  <div class="page">
    <h1>Games</h1>

    <div class="filters glass">
      <input
        v-model="search"
        type="text"
        placeholder="Search games..."
        class="search-input"
      />
      <select v-model="sourceFilter" class="source-select">
        <option value="">All Sources</option>
        <option value="steam">Steam</option>
        <option value="rawg">RAWG</option>
      </select>
      <button class="tags-btn" @click="showTagModal = true">
        🏷️ Tags
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
        v-for="game in filteredGames"
        :key="game.appId"
        :to="`/games/${game.appId}`"
        class="game-card glass"
      >
        <img
          :src="game.imageUrl"
          :alt="game.name"
          class="game-image"
          loading="lazy"
        />
        <div class="game-info">
          <div class="game-name">
            <span class="source-icon steam-icon" v-if="game.source === 'steam'" title="Steam">
              <Icon icon="mdi:steam" width="22" height="22" />
            </span>
            <span class="source-icon rawg-icon" v-else title="RAWG">
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
      </router-link>
    </div>

    <div v-if="!loading && filteredGames.length === 0" class="empty">
      No games found.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { Icon } from '@iconify/vue'

interface Game {
  appId: string
  name: string
  description?: string
  tags?: string[]
  source: string
  imageUrl: string
  protondb_reports?: any[]
}

const games = ref<Game[]>([])
const allTags = ref<string[]>([])
const search = ref('')
const sourceFilter = ref('')
const selectedTags = ref<Set<string>>(new Set())
const loading = ref(true)
const showTagModal = ref(false)
const tagSearch = ref('')
const tagSearchRef = ref<HTMLInputElement | null>(null)

const filteredTags = computed(() => {
  if (!tagSearch.value) return allTags.value
  const lower = tagSearch.value.toLowerCase()
  return allTags.value.filter(t => t.toLowerCase().includes(lower))
})

const filteredGames = computed(() => {
  let result = games.value

  if (search.value) {
    const lower = search.value.toLowerCase()
    result = result.filter(g => g.name.toLowerCase().includes(lower))
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
  if (open) {
    tagSearch.value = ''
    nextTick(() => tagSearchRef.value?.focus())
  }
})

onMounted(async () => {
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
})
</script>

<style scoped>
.page {
  padding: 24px 0;
}

h1 {
  font-size: 2rem;
  margin-bottom: 16px;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.filters {
  display: flex;
  gap: 12px;
  padding: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
}

.search-input,
.source-select {
  background: #1a1a2e;
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

.source-select {
  min-width: 140px;
}

.search-input:focus,
.source-select:focus {
  border-color: var(--accent-teal);
}

/* Tags button */
.tags-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #1a1a2e;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  padding: 10px 16px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.tags-btn:hover {
  border-color: var(--accent-purple);
  color: var(--text-primary);
}

.tags-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  font-size: 0.75rem;
  font-weight: 600;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
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
  background: rgba(0, 212, 170, 0.15);
  border: 1px solid rgba(0, 212, 170, 0.3);
  border-radius: 20px;
  color: var(--accent-teal);
  padding: 4px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.selected-tag-pill:hover {
  background: rgba(231, 76, 60, 0.15);
  border-color: rgba(231, 76, 60, 0.3);
  color: #e74c3c;
}

.clear-tags-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 4px 8px;
  transition: color var(--transition-fast);
}

.clear-tags-btn:hover {
  color: var(--text-primary);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
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
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.modal-close {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.modal-close:hover {
  border-color: var(--accent-teal);
  color: var(--text-primary);
}

.modal-search {
  margin: 0 24px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 10px 14px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color var(--transition-fast);
  flex-shrink: 0;
}

.modal-search:focus {
  border-color: var(--accent-teal);
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
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  color: var(--text-secondary);
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tag-pill:hover {
  border-color: var(--accent-purple);
  color: var(--text-primary);
}

.tag-pill.active {
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
  border-color: transparent;
  color: #fff;
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
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
  border: none;
  color: #fff;
  padding: 8px 24px;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--transition-fast);
}

.modal-done-btn:hover {
  opacity: 0.85;
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
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.game-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.game-image {
  width: 230px;
  min-width: 230px;
  aspect-ratio: 460 / 215;
  object-fit: cover;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
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
  color: #66c0f4;
  filter: drop-shadow(0 0 6px rgba(102, 192, 244, 0.4));
}

.rawg-icon {
  color: #8b6cee;
  filter: drop-shadow(0 0 6px rgba(123, 104, 238, 0.4));
}

.game-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.game-tag {
  font-size: 0.65rem;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.03);
}

@media (max-width: 560px) {
  .game-grid {
    grid-template-columns: 1fr;
  }

  .game-card {
    flex-direction: column;
  }

  .game-image {
    width: 100%;
    min-width: unset;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }

  .modal {
    max-width: 100%;
    max-height: 90vh;
  }
}
</style>
