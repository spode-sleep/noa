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
        <span class="app-id">
          {{ game.appId || game.id }}
          <button class="copy-btn" @click="copyAppId" :title="copied ? 'Copied!' : 'Copy App ID'">
            <Icon :icon="copied ? 'mdi:check' : 'mdi:content-copy'" />
          </button>
        </span>
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
            <button v-if="descOverflows || descExpanded" class="expand-btn" @click="descExpanded = !descExpanded" :title="descExpanded ? 'Show less' : 'Show more'">
              <Icon :icon="descExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'" />
            </button>
          </div>
          <div v-if="game.tags?.length" class="tags-section">
            <div class="tags-list">
              <span v-for="tag in game.tags" :key="tag" class="tag-pill">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Gameplay Tips Button -->
      <div v-if="game.gameplay_tips?.length" class="tips-button-wrapper">
        <button class="btn-tips glass" @click="showTipsModal = true">
          <Icon icon="mdi:lightbulb-on-outline" />
          Gameplay Tips
        </button>
      </div>

      <!-- Gameplay Tips Modal -->
      <Teleport to="body">
        <div v-if="showTipsModal" class="modal-overlay" @click.self="showTipsModal = false">
          <div class="modal-content glass">
            <div class="modal-header">
              <h2>Gameplay Tips</h2>
              <button class="modal-close" @click="showTipsModal = false">
                <Icon icon="mdi:close" />
              </button>
            </div>
            <div class="modal-body">
              <div v-for="(group, gi) in game.gameplay_tips" :key="gi" class="tips-group">
                <h3 v-if="group.title" class="tips-group-title">{{ group.title }}</h3>
                <ul class="tips-list">
                  <li v-for="(tip, ti) in group.tips" :key="ti" class="tip-item">{{ tip }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- Game Data -->
      <div v-if="game.game_data?.length" class="info-section">
        <h2>Game Data</h2>
        <div v-for="(item, i) in game.game_data" :key="'gd'+i" class="info-card glass">
          <h3 v-if="item.title" class="info-card-title">{{ item.title }}</h3>
          <p v-if="item.description" class="info-card-desc" v-html="item.description"></p>
          <template v-if="item.tables?.length">
            <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
              <div v-if="table.type === 'fixbox'" class="fixbox">
                <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
              </div>
              <table v-else-if="table.type === 'table'" class="info-table">
                <thead v-if="table.headers?.length">
                  <tr><th v-for="(h, hi) in table.headers" :key="hi">{{ h }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in table.rows" :key="ri">
                    <td v-for="(cell, ci) in row" :key="ci" v-html="cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>

      <!-- Essential Improvements -->
      <div v-if="game.essential_improvements?.length" class="info-section">
        <h2>Essential Improvements</h2>
        <div v-for="(item, i) in game.essential_improvements" :key="'ei'+i" class="info-card glass">
          <h3 v-if="item.title" class="info-card-title">{{ item.title }}</h3>
          <p v-if="item.description" class="info-card-desc" v-html="item.description"></p>
          <template v-if="item.tables?.length">
            <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
              <div v-if="table.type === 'fixbox'" class="fixbox">
                <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
              </div>
              <table v-else-if="table.type === 'table'" class="info-table">
                <thead v-if="table.headers?.length">
                  <tr><th v-for="(h, hi) in table.headers" :key="hi">{{ h }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in table.rows" :key="ri">
                    <td v-for="(cell, ci) in row" :key="ci" v-html="cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>

      <!-- Issues Fixed -->
      <div v-if="game.issues_fixed?.length" class="info-section">
        <h2>Issues Fixed</h2>
        <div v-for="(item, i) in game.issues_fixed" :key="'if'+i" class="info-card glass">
          <h3 v-if="item.issue" class="info-card-title">{{ item.issue }}</h3>
          <div v-if="item.solutions?.length" class="solutions">
            <div v-for="(sol, si) in item.solutions" :key="si" class="solution-note" v-html="sol.content"></div>
          </div>
          <template v-if="item.tables?.length">
            <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
              <div v-if="table.type === 'fixbox'" class="fixbox">
                <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
              </div>
              <table v-else-if="table.type === 'table'" class="info-table">
                <thead v-if="table.headers?.length">
                  <tr><th v-for="(h, hi) in table.headers" :key="hi">{{ h }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in table.rows" :key="ri">
                    <td v-for="(cell, ci) in row" :key="ci" v-html="cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>

      <!-- Issues Unsolved -->
      <div v-if="game.issues_unresolved?.length" class="info-section">
        <h2>Issues Unsolved</h2>
        <div v-for="(item, i) in game.issues_unresolved" :key="'iu'+i" class="info-card glass">
          <h3 v-if="item.issue" class="info-card-title">{{ item.issue }}</h3>
          <p v-if="item.description" class="info-card-desc" v-html="item.description"></p>
          <p v-if="item.notes" class="info-card-notes">{{ item.notes }}</p>
        </div>
      </div>

      <!-- Modifications -->
      <div v-if="game.modifications?.length" class="info-section">
        <h2>Modifications</h2>
        <div v-for="(item, i) in game.modifications" :key="'mod'+i" class="info-card glass">
          <h3 v-if="item.title" class="info-card-title">{{ item.title }}</h3>
          <p v-if="item.description" class="info-card-desc" v-html="item.description"></p>
          <template v-if="item.tables?.length">
            <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
              <div v-if="table.type === 'fixbox'" class="fixbox">
                <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
              </div>
              <table v-else-if="table.type === 'table'" class="info-table">
                <thead v-if="table.headers?.length">
                  <tr><th v-for="(h, hi) in table.headers" :key="hi">{{ h }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in table.rows" :key="ri">
                    <td v-for="(cell, ci) in row" :key="ci" v-html="cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>

      <!-- Other Information -->
      <div v-if="game.other_information?.length" class="info-section">
        <h2>Other Information</h2>
        <div v-for="(item, i) in game.other_information" :key="'oi'+i" class="info-card glass">
          <h3 v-if="item.title" class="info-card-title">{{ item.title }}</h3>
          <p v-if="item.description" class="info-card-desc" v-html="item.description"></p>
          <template v-if="item.tables?.length">
            <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
              <div v-if="table.type === 'fixbox'" class="fixbox">
                <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
              </div>
              <table v-else-if="table.type === 'table'" class="info-table">
                <thead v-if="table.headers?.length">
                  <tr><th v-for="(h, hi) in table.headers" :key="hi">{{ h }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in table.rows" :key="ri">
                    <td v-for="(cell, ci) in row" :key="ci" v-html="cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>

      <!-- ProtonDB Reports (last) -->
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
import { ref, onMounted, nextTick, watch } from 'vue'
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

interface InfoTable {
  type: string
  headers?: string[]
  rows: any[]
}

interface InfoEntry {
  title?: string
  description?: string
  tables?: InfoTable[]
}

interface IssueFixed {
  issue?: string
  solutions?: { type: string; content: string }[]
  tables?: InfoTable[]
}

interface IssueUnresolved {
  issue?: string
  description?: string
  notes?: string
}

interface TipsGroup {
  title?: string
  tips: string[]
}

interface Game {
  appId: string
  id?: string
  name: string
  description?: string
  tags?: string[]
  source: string
  imageUrl: string
  protondb_reports?: ProtonReport[]
  gameplay_tips?: TipsGroup[]
  essential_improvements?: InfoEntry[]
  issues_fixed?: IssueFixed[]
  issues_unresolved?: IssueUnresolved[]
  modifications?: InfoEntry[]
  game_data?: InfoEntry[]
  other_information?: InfoEntry[]
}

const route = useRoute()
const game = ref<Game | null>(null)
const loading = ref(true)
const error = ref('')
const descExpanded = ref(false)
const descRef = ref<HTMLElement | null>(null)
const descOverflows = ref(false)
const copied = ref(false)
const showTipsModal = ref(false)

function formatFixboxRow(row: string): string {
  return row.replace(/\n/g, '<br>').replace(/`([^`]+)`/g, '<code>$1</code>')
}

function copyAppId() {
  const id = game.value?.appId || game.value?.id || ''
  navigator.clipboard.writeText(String(id)).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  })
}

function checkOverflow() {
  if (!descRef.value) return
  const el = descRef.value
  descOverflows.value = el.scrollHeight > el.clientHeight + 1
}

watch(game, () => {
  nextTick(() => setTimeout(checkOverflow, 50))
})

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
  display: flex;
  align-items: center;
  gap: 6px;
}

.copy-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  font-size: 0.9rem;
  opacity: 0.6;
  transition: opacity 0.2s, color 0.2s;
  margin-top: 2px;
}
.copy-btn:hover {
  opacity: 1;
  color: var(--accent-teal);
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
  filter: drop-shadow(0 0 6px rgba(102, 192, 244, 0.4));
}

.source-icon.rawg {
  color: var(--accent-purple);
  filter: drop-shadow(0 0 6px rgba(123, 104, 238, 0.4));
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
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--accent-teal);
  cursor: pointer;
  font-size: 1.3rem;
  padding: 2px 0;
  margin: 4px auto 0;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.expand-btn:hover {
  opacity: 1;
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

/* Gameplay Tips Button */
.tips-button-wrapper {
  margin-bottom: 24px;
}

.btn-tips {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  font-size: 0.95rem;
  color: var(--accent-teal);
  border: 1px solid var(--accent-teal);
  border-radius: var(--radius-sm);
  background: rgba(0, 232, 184, 0.06);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-tips:hover {
  background: rgba(0, 232, 184, 0.14);
  box-shadow: 0 0 16px rgba(0, 232, 184, 0.15);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.modal-content {
  width: 100%;
  max-width: 680px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--glass-border);
}

.modal-header h2 {
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.4rem;
  cursor: pointer;
  padding: 4px;
  transition: color var(--transition-fast);
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 20px 24px;
  overflow-y: auto;
}

.tips-group-title {
  font-size: 1rem;
  color: var(--accent-teal);
  margin-bottom: 10px;
}

.tips-list {
  list-style: none;
  padding: 0;
}

.tip-item {
  position: relative;
  padding: 8px 0 8px 18px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.tip-item:last-child {
  border-bottom: none;
}

.tip-item::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--accent-teal);
}

/* Info sections (Game Data, Essential Improvements, etc.) */
.info-section {
  margin-bottom: 28px;
}

.info-section h2 {
  font-size: 1.4rem;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.info-card {
  padding: 16px;
  margin-bottom: 12px;
}

.info-card-title {
  font-size: 1.05rem;
  color: var(--accent-teal);
  margin-bottom: 8px;
}

.info-card-desc {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
  margin-bottom: 10px;
  word-break: break-word;
}

.info-card-notes {
  color: var(--text-muted);
  font-size: 0.85rem;
  font-style: italic;
  line-height: 1.5;
}

.solutions {
  margin-bottom: 10px;
}

.solution-note {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
  padding: 6px 0;
}

.info-table-wrap {
  margin-top: 10px;
}

/* Fixbox styling */
.fixbox {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.fixbox-row {
  padding: 10px 14px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.6;
  border-bottom: 1px solid var(--glass-border);
  word-break: break-word;
}

.fixbox-row:last-child {
  border-bottom: none;
}

.fixbox-row code {
  background: rgba(0, 232, 184, 0.1);
  color: var(--accent-teal);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.82rem;
}

/* Data tables */
.info-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.info-table th,
.info-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--glass-border);
  word-break: break-word;
}

.info-table th {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.info-table td {
  color: var(--text-secondary);
}

.info-table tr:last-child td {
  border-bottom: none;
}
</style>
