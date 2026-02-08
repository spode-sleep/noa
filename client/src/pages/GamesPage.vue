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
    </div>

    <div v-if="allTags.length" class="tag-filters">
      <button
        v-for="tag in allTags"
        :key="tag"
        class="tag-pill"
        :class="{ active: selectedTags.has(tag) }"
        @click="toggleTag(tag)"
      >
        {{ tag }}
      </button>
    </div>

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
            <span class="source-icon">{{ game.source === 'steam' ? '🎮' : '🎮' }}</span>
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
import { ref, computed, onMounted } from 'vue'

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

.tag-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.tag-pill {
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  color: var(--text-secondary);
  padding: 4px 12px;
  font-size: 0.75rem;
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
}
</style>
