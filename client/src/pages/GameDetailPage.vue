<template>
  <div class="page-wrapper">
    <!-- Sticky left sidebar -->
    <nav class="sidebar" v-if="game">
      <a class="sidebar-link" @click="router.push('/games')" style="cursor:pointer">
        <Icon icon="mdi:arrow-left" class="back-icon" /> Games
      </a>
      <div class="sidebar-divider"></div>
      <a href="#top" class="sidebar-link" @click.prevent="scrollToSection('top')">{{ game.name || 'Top' }}</a>
      <a v-if="game.game_data?.length" href="#game-data" class="sidebar-link" @click.prevent="scrollToSection('game-data')">Game Data</a>
      <a v-if="game.essential_improvements?.length" href="#essential-improvements" class="sidebar-link" @click.prevent="scrollToSection('essential-improvements')">Essential Improvements</a>
      <a v-if="game.issues_fixed?.length" href="#issues-fixed" class="sidebar-link" @click.prevent="scrollToSection('issues-fixed')">Issues Fixed</a>
      <a v-if="game.issues_unresolved?.length" href="#issues-unsolved" class="sidebar-link" @click.prevent="scrollToSection('issues-unsolved')">Issues Unsolved</a>
      <a v-if="game.modifications?.length" href="#modifications" class="sidebar-link" @click.prevent="scrollToSection('modifications')">Modifications</a>
      <a v-if="game.other_information?.length" href="#other-information" class="sidebar-link" @click.prevent="scrollToSection('other-information')">Other Information</a>
      <a v-if="game.protondb_reports?.length" href="#protondb-reports" class="sidebar-link" @click.prevent="scrollToSection('protondb-reports')">ProtonDB Reports</a>
    </nav>

    <div class="page">
      <a v-if="!game" class="btn btn-back" @click="router.push('/games')" style="cursor:pointer">← Games</a>

      <div v-if="loading" class="loading">Loading game...</div>
      <div v-else-if="error" class="error">{{ error }}</div>

      <template v-else-if="game">
        <div id="top" class="game-top">
          <div class="game-header">
            <Icon :icon="game.source === 'steam' ? 'mdi:steam' : 'mdi:gamepad-variant'" class="source-icon" :class="game.source" />
            <h1>{{ game.name }}</h1>
            <span v-if="!game.isArchived" class="archive-chip not-archived">Not Archived</span>
          </div>
          <span v-if="game.isArchived && game.archivePath" class="archive-path">
            {{ game.archivePath }}
            <button class="copy-btn" @click="copyPath" :title="pathCopied ? 'Copied!' : 'Copy path'">
              <Icon :icon="pathCopied ? 'mdi:check' : 'mdi:content-copy'" />
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
                <span v-for="tag in game.tags" :key="tag" class="tag-pill clickable-tag" @click="router.push({ path: '/games', query: { tag: tag } })">{{ tag }}</span>
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
                    <TipItem v-for="(tip, ti) in group.tips" :key="ti" :tip="tip" :format-tip-text="formatTipText" />
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </Teleport>

        <!-- Game Data -->
        <div v-if="game.game_data?.length" id="game-data" class="info-section">
          <h2>Game Data</h2>
          <div v-for="(item, i) in game.game_data" :key="'gd'+i" class="info-card glass">
            <h3 v-if="item.title" class="info-card-title">{{ item.title }}</h3>
            <p v-if="item.description" class="info-card-desc" v-html="formatContent(item.description)"></p>
            <template v-if="item.tables?.length">
              <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
                <div v-if="table.type === 'fixbox'" class="fixbox">
                  <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
                </div>
                <table v-else-if="table.type === 'table'" class="info-table">
                  <thead v-if="table.headers?.length">
                    <tr><th v-for="(h, hi) in table.headers" :key="hi" :class="{ 'arch-col': isArchColumn(h), 'middle-col': isMiddleCol(hi, table.headers.length, h) }">{{ h }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in table.rows" :key="ri">
                      <td v-for="(cell, ci) in row" :key="ci" :class="{ 'arch-col': table.headers && isArchColumn(table.headers[ci]), 'middle-col': table.headers && isMiddleCol(ci, table.headers.length, table.headers[ci]) }">
                        <span v-if="getArchIcon(typeof cell === 'string' ? cell : '')" :title="typeof cell === 'string' ? cell : ''" :aria-label="typeof cell === 'string' ? cell : ''" class="arch-icon-wrap"><Icon :icon="getArchIcon(typeof cell === 'string' ? cell : '')!.icon" :class="['arch-icon', getArchIcon(typeof cell === 'string' ? cell : '')!.cls]" /></span>
                        <span v-else v-html="formatContent(cell)"></span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>

        <!-- Essential Improvements -->
        <div v-if="game.essential_improvements?.length" id="essential-improvements" class="info-section">
          <h2>Essential Improvements</h2>
          <div v-for="(item, i) in game.essential_improvements" :key="'ei'+i" class="info-card glass">
            <h3 v-if="item.title" class="info-card-title">{{ item.title }}</h3>
            <p v-if="item.description" class="info-card-desc" v-html="formatContent(item.description)"></p>
            <template v-if="item.tables?.length">
              <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
                <div v-if="table.type === 'fixbox'" class="fixbox">
                  <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
                </div>
                <table v-else-if="table.type === 'table'" class="info-table">
                  <thead v-if="table.headers?.length">
                    <tr><th v-for="(h, hi) in table.headers" :key="hi" :class="{ 'arch-col': isArchColumn(h), 'middle-col': isMiddleCol(hi, table.headers.length, h) }">{{ h }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in table.rows" :key="ri">
                      <td v-for="(cell, ci) in row" :key="ci" :class="{ 'arch-col': table.headers && isArchColumn(table.headers[ci]), 'middle-col': table.headers && isMiddleCol(ci, table.headers.length, table.headers[ci]) }">
                        <span v-if="getArchIcon(typeof cell === 'string' ? cell : '')" :title="typeof cell === 'string' ? cell : ''" :aria-label="typeof cell === 'string' ? cell : ''" class="arch-icon-wrap"><Icon :icon="getArchIcon(typeof cell === 'string' ? cell : '')!.icon" :class="['arch-icon', getArchIcon(typeof cell === 'string' ? cell : '')!.cls]" /></span>
                        <span v-else v-html="formatContent(cell)"></span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>

        <!-- Issues Fixed -->
        <div v-if="game.issues_fixed?.length" id="issues-fixed" class="info-section">
          <h2>Issues Fixed</h2>
          <div v-for="(item, i) in game.issues_fixed" :key="'if'+i" class="info-card glass">
            <h3 v-if="item.issue" class="info-card-title">{{ item.issue }}</h3>
            <div v-if="item.solutions?.length" class="solutions">
              <div v-for="(sol, si) in item.solutions" :key="si" class="solution-note" v-html="formatContent(sol.content)"></div>
            </div>
            <template v-if="item.tables?.length">
              <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
                <div v-if="table.type === 'fixbox'" class="fixbox">
                  <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
                </div>
                <table v-else-if="table.type === 'table'" class="info-table">
                  <thead v-if="table.headers?.length">
                    <tr><th v-for="(h, hi) in table.headers" :key="hi" :class="{ 'arch-col': isArchColumn(h), 'middle-col': isMiddleCol(hi, table.headers.length, h) }">{{ h }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in table.rows" :key="ri">
                      <td v-for="(cell, ci) in row" :key="ci" :class="{ 'arch-col': table.headers && isArchColumn(table.headers[ci]), 'middle-col': table.headers && isMiddleCol(ci, table.headers.length, table.headers[ci]) }">
                        <span v-if="getArchIcon(typeof cell === 'string' ? cell : '')" :title="typeof cell === 'string' ? cell : ''" :aria-label="typeof cell === 'string' ? cell : ''" class="arch-icon-wrap"><Icon :icon="getArchIcon(typeof cell === 'string' ? cell : '')!.icon" :class="['arch-icon', getArchIcon(typeof cell === 'string' ? cell : '')!.cls]" /></span>
                        <span v-else v-html="formatContent(cell)"></span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>

        <!-- Issues Unsolved -->
        <div v-if="game.issues_unresolved?.length" id="issues-unsolved" class="info-section">
          <h2>Issues Unsolved</h2>
          <div v-for="(item, i) in game.issues_unresolved" :key="'iu'+i" class="info-card glass">
            <h3 v-if="item.issue" class="info-card-title">{{ item.issue }}</h3>
            <p v-if="item.description" class="info-card-desc" v-html="formatContent(item.description)"></p>
            <p v-if="item.notes" class="info-card-notes">{{ item.notes }}</p>
          </div>
        </div>

        <!-- Modifications -->
        <div v-if="game.modifications?.length" id="modifications" class="info-section">
          <h2>Modifications</h2>
          <div v-for="(item, i) in game.modifications" :key="'mod'+i" class="info-card glass">
            <h3 v-if="item.title" class="info-card-title">{{ item.title }}</h3>
            <p v-if="item.description" class="info-card-desc" v-html="formatContent(item.description)"></p>
            <template v-if="item.tables?.length">
              <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
                <div v-if="table.type === 'fixbox'" class="fixbox">
                  <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
                </div>
                <table v-else-if="table.type === 'table'" class="info-table">
                  <thead v-if="table.headers?.length">
                    <tr><th v-for="(h, hi) in table.headers" :key="hi" :class="{ 'arch-col': isArchColumn(h), 'middle-col': isMiddleCol(hi, table.headers.length, h) }">{{ h }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in table.rows" :key="ri">
                      <td v-for="(cell, ci) in row" :key="ci" :class="{ 'arch-col': table.headers && isArchColumn(table.headers[ci]), 'middle-col': table.headers && isMiddleCol(ci, table.headers.length, table.headers[ci]) }">
                        <span v-if="getArchIcon(typeof cell === 'string' ? cell : '')" :title="typeof cell === 'string' ? cell : ''" :aria-label="typeof cell === 'string' ? cell : ''" class="arch-icon-wrap"><Icon :icon="getArchIcon(typeof cell === 'string' ? cell : '')!.icon" :class="['arch-icon', getArchIcon(typeof cell === 'string' ? cell : '')!.cls]" /></span>
                        <span v-else v-html="formatContent(cell)"></span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>

        <!-- Other Information -->
        <div v-if="game.other_information?.length" id="other-information" class="info-section">
          <h2>Other Information</h2>
          <div v-for="(item, i) in game.other_information" :key="'oi'+i" class="info-card glass">
            <h3 v-if="item.title" class="info-card-title">{{ item.title }}</h3>
            <p v-if="item.description" class="info-card-desc" v-html="formatContent(item.description)"></p>
            <template v-if="item.tables?.length">
              <div v-for="(table, ti) in item.tables" :key="ti" class="info-table-wrap">
                <div v-if="table.type === 'fixbox'" class="fixbox">
                  <div v-for="(row, ri) in table.rows" :key="ri" class="fixbox-row" v-html="formatFixboxRow(row)"></div>
                </div>
                <table v-else-if="table.type === 'table'" class="info-table">
                  <thead v-if="table.headers?.length">
                    <tr><th v-for="(h, hi) in table.headers" :key="hi" :class="{ 'arch-col': isArchColumn(h), 'middle-col': isMiddleCol(hi, table.headers.length, h) }">{{ h }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in table.rows" :key="ri">
                      <td v-for="(cell, ci) in row" :key="ci" :class="{ 'arch-col': table.headers && isArchColumn(table.headers[ci]), 'middle-col': table.headers && isMiddleCol(ci, table.headers.length, table.headers[ci]) }">
                        <span v-if="getArchIcon(typeof cell === 'string' ? cell : '')" :title="typeof cell === 'string' ? cell : ''" :aria-label="typeof cell === 'string' ? cell : ''" class="arch-icon-wrap"><Icon :icon="getArchIcon(typeof cell === 'string' ? cell : '')!.icon" :class="['arch-icon', getArchIcon(typeof cell === 'string' ? cell : '')!.cls]" /></span>
                        <span v-else v-html="formatContent(cell)"></span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>

        <!-- ProtonDB Reports (last) -->
        <div v-if="game.protondb_reports?.length" id="protondb-reports" class="reviews-section">
          <h2>ProtonDB Reports</h2>
          <div
            v-for="(report, i) in sortedProtonReports"
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon, getIcon, buildIcon } from '@iconify/vue'
import TipItem from '../components/TipItem.vue'

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
  rows: (string | string[])[]
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

interface Tip {
  text: string
  children?: Tip[]
}

interface TipsGroup {
  title?: string
  tips: Tip[]
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
  isArchived?: boolean
  archivePath?: string
}

const route = useRoute()
const router = useRouter()
const game = ref<Game | null>(null)
const loading = ref(true)
const error = ref('')
const descExpanded = ref(false)
const descRef = ref<HTMLElement | null>(null)
const descOverflows = ref(false)
const copied = ref(false)
const pathCopied = ref(false)
const showTipsModal = ref(false)

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function iconSvg(name: string, cls: string): string {
  const data = getIcon(name)
  if (!data) return ''
  const built = buildIcon(data, {})
  const attrs = built.attributes
  return `<svg class="emoji-icon ${cls}" viewBox="${attrs.viewBox}" xmlns="http://www.w3.org/2000/svg">${built.body}</svg>`
}

const emojiMap: [RegExp, string][] = [
  [/📁/g, iconSvg('mdi:folder', 'emoji-folder')],
  [/👎/g, iconSvg('mdi:thumb-down', 'emoji-dislike')],
  [/👍/g, iconSvg('mdi:thumb-up', 'emoji-like')],
  [/ℹ️/g, iconSvg('mdi:information', 'emoji-info')],
  [/🔧/g, iconSvg('mdi:wrench', 'emoji-wrench')],
  [/📄/g, iconSvg('mdi:file-document-outline', 'emoji-file')],
  [/🟦/g, iconSvg('mdi:checkbox-blank', 'emoji-blue')],
]

function replaceEmojis(str: string): string {
  let result = str
  for (const [re, replacement] of emojiMap) {
    result = result.replace(re, replacement)
  }
  return result
}

function formatContent(text: string | string[]): string {
  const str = typeof text === 'string' ? text : text.join(' ')
  const escaped = escapeHtml(str)
  return replaceEmojis(escaped.replace(/\n/g, '<br>').replace(/§([^§]+)§/g, '<code>$1</code>'))
}

function formatFixboxRow(row: string | string[]): string {
  const text = typeof row === 'string' ? row : row.join(' ')
  const escaped = escapeHtml(text)
  return replaceEmojis(escaped.replace(/\n/g, '<br>').replace(/§([^§]+)§/g, '<code>$1</code>').replace(/`([^`]+)`/g, '<code>$1</code>'))
}

function formatTipText(text: string): string {
  const escaped = escapeHtml(text)
  return replaceEmojis(escaped.replace(/\n/g, '<br>').replace(/§([^§]+)§/g, '<code>$1</code>'))
}

const archColumns = new Set(['PPC', '16-bit', '32-bit', '64-bit', 'ARM'])

function isArchColumn(header: string): boolean {
  return archColumns.has(header)
}

function isMiddleCol(index: number, total: number, header: string): boolean {
  return index > 0 && index < total - 1 && !isArchColumn(header)
}

const archValueMap: Record<string, { icon: string; cls: string }> = {
  'Native support': { icon: 'mdi:check-circle', cls: 'arch-native' },
  'No native support': { icon: 'mdi:close-circle', cls: 'arch-none' },
  'Not applicable': { icon: 'mdi:minus-circle', cls: 'arch-na' },
  'Hackable': { icon: 'mdi:wrench', cls: 'arch-hackable' },
  'Unknown': { icon: 'mdi:help-circle', cls: 'arch-unknown' },
}

function getArchIcon(value: string): { icon: string; cls: string } | null {
  return archValueMap[value] || null
}

function scrollToSection(id: string) {
  if (id === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function copyAppId() {
  const id = game.value?.appId || game.value?.id || ''
  navigator.clipboard.writeText(String(id)).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  })
}

function copyPath() {
  const path = game.value?.archivePath || ''
  if (!path) return
  navigator.clipboard.writeText(path).then(() => {
    pathCopied.value = true
    setTimeout(() => { pathCopied.value = false }, 1500)
  }).catch(() => {})
}

function checkOverflow() {
  if (!descRef.value) return
  const el = descRef.value
  descOverflows.value = el.scrollHeight > el.clientHeight + 1
}

watch(game, () => {
  nextTick(() => setTimeout(checkOverflow, 50))
})

watch(showTipsModal, (val) => {
  document.body.style.overflow = val ? 'hidden' : ''
})

function ratingClass(rating: string): string {
  return (rating || '').toLowerCase()
}

const protonRankOrder: Record<string, number> = {
  platinum: 0,
  gold: 1,
  silver: 2,
  bronze: 3,
  borked: 4,
}

const sortedProtonReports = computed(() => {
  if (!game.value?.protondb_reports) return []
  return [...game.value.protondb_reports].sort((a, b) => {
    const ra = protonRankOrder[a.rating?.toLowerCase()] ?? 99
    const rb = protonRankOrder[b.rating?.toLowerCase()] ?? 99
    return ra - rb
  })
})

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
    if (game.value?.name) document.title = `${game.value.name} - BOX`
    await nextTick()
    checkOverflow()
  } catch (e) {
    error.value = 'Failed to load game'
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.title = 'BOX'
})
</script>

<style scoped>
.page-wrapper {
  display: flex;
  gap: 0;
}

/* Sticky sidebar */
.sidebar {
  position: sticky;
  top: 80px;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  min-width: 180px;
  max-width: 200px;
  flex-shrink: 0;
}

.sidebar-link {
  display: block;
  padding: 6px 12px;
  font-size: 0.8rem;
  color: var(--text-muted);
  border-radius: 0px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow-wrap: break-word;
}

.sidebar-link:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.back-icon {
  vertical-align: -2px;
}

.sidebar-divider {
  height: 1px;
  background: var(--glass-border);
  margin: 6px 12px;
}

@media (max-width: 1024px) {
  .sidebar {
    display: none;
  }
}

.page {
  padding: 24px 0;
  flex: 1;
  min-width: 0;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 0px;
  background: var(--askew-btn);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  color: var(--text-primary);
  font-size: 0.9rem;
  margin-bottom: 20px;
  cursor: pointer;
}

.btn-back:hover {
  color: var(--text-primary);
  background: var(--askew-btn-hover);
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

.archive-chip {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 0px;
  white-space: nowrap;
  align-self: center;
}

.archive-chip.not-archived {
  background: var(--askew-red);
  border: 1px solid #000000;
  color: var(--text-primary);
}

.archive-path {
  font-size: 0.75rem;
  color: var(--text-muted);
  opacity: 0.5;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 6px;
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
  margin-top: 2px;
}
.copy-btn:hover {
  opacity: 1;
  color: var(--askew-cyan);
}

.game-top {
  margin-bottom: 12px;
  scroll-margin-top: 70px;
}

h1 {
  font-size: 2rem;
  color: var(--askew-gold);
}

.source-icon {
  font-size: 1.6rem;
  flex-shrink: 0;
}

.source-icon.steam {
  color: var(--askew-cyan);
}

.source-icon.rawg {
  color: var(--askew-salmon);
}

.hero-image {
  width: 100%;
  aspect-ratio: 460 / 215;
  object-fit: cover;
  border-radius: 0px;
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
  color: var(--askew-cyan);
  cursor: pointer;
  font-size: 1.3rem;
  padding: 2px 0;
  margin: 4px auto 0;
  opacity: 0.7;
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
  border-radius: 0px;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  background: var(--bg-tertiary);
}

.clickable-tag {
  cursor: pointer;
}
.clickable-tag:hover {
  border-color: var(--askew-cyan);
  color: var(--text-primary);
}

.reviews-section {
  margin-top: 16px;
  scroll-margin-top: 70px;
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
  border-radius: 0px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: capitalize;
}

.rating-badge.platinum {
  background: #0a2e14;
  color: var(--accent-green);
  border: 1px solid var(--accent-green);
}

.rating-badge.gold {
  background: #2e2408;
  color: var(--askew-gold);
  border: 1px solid var(--askew-gold);
}

.rating-badge.silver {
  background: #1a1a1a;
  color: #b4b4b4;
  border: 1px solid #b4b4b4;
}

.rating-badge.bronze {
  background: #2e1a08;
  color: var(--askew-container-light);
  border: 1px solid var(--askew-container-light);
}

.rating-badge.borked {
  background: #2e0808;
  color: var(--askew-red);
  border: 1px solid var(--askew-red);
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
  color: var(--text-primary);
  border: 1px solid #000000;
  border-radius: 0px;
  background: var(--askew-btn);
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  cursor: pointer;
}

.btn-tips:hover {
  background: var(--askew-btn-hover);
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
  border: 1px solid #000000;
  border-radius: 0px;
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
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
  color: var(--askew-cyan);
  margin-bottom: 10px;
}

.tips-list {
  list-style: none;
  padding: 0;
}

/* Info sections (Game Data, Essential Improvements, etc.) */
.info-section {
  margin-bottom: 28px;
  scroll-margin-top: 70px;
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
  color: var(--askew-cyan);
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
  overflow-x: auto;
}

/* Fixbox styling */
.fixbox {
  border: 1px solid #000000;
  border-radius: 0px;
  overflow: hidden;
  box-shadow: inset 1px 1px 0 var(--glass-border), inset -1px -1px 0 var(--askew-dark-border);
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

.fixbox-row :deep(code) {
  background: var(--askew-btn-disabled);
  color: var(--askew-cream);
  padding: 1px 6px;
  border-radius: 0px;
  border: 1px solid #000000;
  font-size: 0.82rem;
}

/* Global code styling for all content areas */
.info-card-desc :deep(code),
.solution-note :deep(code),
.info-table td :deep(code) {
  background: var(--askew-btn-disabled);
  color: var(--askew-cream);
  padding: 1px 6px;
  border-radius: 0px;
  border: 1px solid #000000;
  font-size: 0.82rem;
}

/* Emoji icon replacements */
:deep(.emoji-icon) {
  display: inline-block;
  width: 1em;
  height: 1em;
  vertical-align: -0.125em;
  margin: 0 1px;
}

:deep(.emoji-folder) {
  color: var(--askew-gold);
}

:deep(.emoji-like) {
  color: var(--accent-green);
}

:deep(.emoji-dislike) {
  color: var(--askew-red);
}

:deep(.emoji-info) {
  color: var(--askew-cyan);
}

:deep(.emoji-wrench) {
  color: var(--askew-gold);
}

:deep(.emoji-file) {
  color: var(--text-secondary);
}

:deep(.emoji-blue) {
  color: var(--askew-cyan);
}

/* Data tables */
.info-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  border: 1px solid #000000;
  border-radius: 0px;
  overflow: hidden;
}

.info-table th,
.info-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--glass-border);
  word-break: break-word;
}

.info-table th:first-child,
.info-table td:first-child {
  min-width: 0;
  width: 1%;
  white-space: nowrap;
}

.info-table th.middle-col,
.info-table td.middle-col {
  min-width: 0;
  width: 1%;
  white-space: nowrap;
}

.info-table th.arch-col,
.info-table td.arch-col {
  min-width: 0;
  width: 1%;
  white-space: nowrap;
  text-align: center;
}

.arch-icon-wrap {
  cursor: help;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.arch-icon {
  font-size: 1.2rem;
  pointer-events: none;
}

.arch-native {
  color: var(--accent-green);
}

.arch-none {
  color: var(--askew-red);
}

.arch-na {
  color: var(--text-muted);
}

.arch-hackable {
  color: var(--askew-salmon);
}

.arch-unknown {
  color: var(--text-muted);
  opacity: 0.6;
}

.info-table th {
  background: var(--bg-tertiary);
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
