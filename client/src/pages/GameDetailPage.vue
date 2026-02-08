<template>
  <div class="page">
    <router-link to="/games" class="btn btn-back">← Games</router-link>

    <div v-if="loading" class="loading">Loading game...</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else-if="game">
      <div class="game-top">
        <div class="game-header">
          <Icon :icon="game.source === 'steam' ? 'mdi:steam' : 'mdi:gamepad-variant'" class="source-icon" :class="game.source" />
          <h1>{{ game.name }}</h1>
        </div>
        <span class="app-id">{{ game.appId || game.id }}</span>
      </div>

      <div class="game-layout">
        <div class="game-left">
          <img
            :src="game.imageUrl"
            :alt="game.name"
            class="hero-image glass"
          />
        </div>
        <div class="game-right">
          <div v-if="game.description" class="description-wrapper" :class="{ expanded: descExpanded }">
            <div ref="descRef" class="description-content" v-html="game.description"></div>
            <button v-if="descOverflows || descExpanded" class="expand-btn" @click="descExpanded = !descExpanded">
              <Icon :icon="descExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'" />
              {{ descExpanded ? 'Show less' : 'Show more' }}
            </button>
          </div>
          <div v-if="game.tags?.length" class="tags-section">
            <div class="tags-list">
              <span v-for="tag in game.tags" :key="tag" class="tag-pill">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="game.protondb_reports?.length" class="reviews-section">
        <h2>ProtonDB Reports</h2>
        <div
          v-for="(report, i) in game.protondb_reports"
          :key="i"
          class="review-card glass"
        >
          <div class="review-header">
            <span class="rating-badge" :class="ratingClass(report.rating)">
              {{ report.rating }}
            </span>
            <span class="review-date">{{ formatDate(report.timestamp) }}</span>
          </div>
          <div class="review-meta">
            <span v-if="report.os"><strong>OS:</strong> {{ report.os }}</span>
            <span v-if="report.gpuDriver"><strong>GPU:</strong> {{ report.gpuDriver }}</span>
            <span v-if="report.protonVersion"><strong>Proton:</strong> {{ report.protonVersion }}</span>
          </div>
          <p v-if="report.notes" class="review-notes">{{ report.notes }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'

interface ProtonReport {
  timestamp: number
  rating: string
  notes: string
  os: string
  gpuDriver: string
  specs: any
  protonVersion: string
}

interface Game {
  appId: string
  name: string
  description?: string
  tags?: string[]
  source: string
  imageUrl: string
  protondb_reports?: ProtonReport[]
}

const route = useRoute()
const game = ref<Game | null>(null)
const loading = ref(true)
const error = ref('')
const descExpanded = ref(false)
const descRef = ref<HTMLElement | null>(null)
const descOverflows = ref(false)

function checkOverflow() {
  if (descRef.value) {
    descOverflows.value = descRef.value.scrollHeight > descRef.value.clientHeight
  }
}

function ratingClass(rating: string): string {
  return (rating || '').toLowerCase()
}

function formatDate(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleDateString()
}

onMounted(async () => {
  try {
    const res = await fetch(`/api/games/${route.params.id}`)
    if (!res.ok) {
      error.value = 'Game not found'
      return
    }
    game.value = await res.json()
    await nextTick()
    checkOverflow()
  } catch (e) {
    error.value = 'Failed to load game'
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
  border-color: var(--accent-teal);
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

.game-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin-bottom: 32px;
}

@media (max-width: 768px) {
  .game-layout {
    grid-template-columns: 1fr;
  }
}

.game-left {
  display: flex;
  flex-direction: column;
}

.game-right {
  display: flex;
  flex-direction: column;
}

.game-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.app-id {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 20px;
  display: block;
}

.game-top {
  margin-bottom: 12px;
}

h1 {
  font-size: 2rem;
  background: linear-gradient(135deg, #4cc9f0, var(--accent-teal));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.source-icon {
  font-size: 1.6rem;
  flex-shrink: 0;
}

.source-icon.steam {
  color: #66c0f4;
}

.source-icon.rawg {
  color: var(--accent-purple);
}

.hero-image {
  width: 100%;
  aspect-ratio: 460 / 215;
  object-fit: cover;
  border-radius: var(--radius-md);
}

.description-wrapper {
  position: relative;
  margin-bottom: 24px;
}

.description-content {
  color: var(--text-secondary);
  line-height: 1.7;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.description-wrapper.expanded .description-content {
  -webkit-line-clamp: unset;
  display: block;
}

.expand-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: var(--accent-teal);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 6px 0;
  margin-top: 4px;
}

.expand-btn:hover {
  opacity: 0.8;
}

.tags-section {
  margin-bottom: 32px;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-pill {
  font-size: 0.75rem;
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.03);
}

.reviews-section {
  margin-top: 16px;
}

h2 {
  font-size: 1.4rem;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.review-card {
  padding: 16px;
  margin-bottom: 12px;
}

.review-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.rating-badge {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: capitalize;
}

.rating-badge.platinum {
  background: rgba(0, 200, 83, 0.15);
  color: #00c853;
  border: 1px solid #00c85355;
}

.rating-badge.gold {
  background: rgba(255, 215, 0, 0.15);
  color: #ffd700;
  border: 1px solid #ffd70055;
}

.rating-badge.silver {
  background: rgba(180, 180, 180, 0.15);
  color: #b4b4b4;
  border: 1px solid #b4b4b455;
}

.rating-badge.bronze {
  background: rgba(255, 152, 0, 0.15);
  color: #ff9800;
  border: 1px solid #ff980055;
}

.rating-badge.borked {
  background: rgba(244, 67, 54, 0.15);
  color: #f44336;
  border: 1px solid #f4433655;
}

.review-date {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.review-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.review-notes {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
}
</style>
