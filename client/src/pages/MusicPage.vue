<template>
  <div class="page" :class="{ 'has-player': currentTrack }">
    <h1>Music</h1>

    <!-- Tab Switcher -->
    <div class="tab-switcher glass">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'tracks' }"
        @click="activeTab = 'tracks'"
      >
        Tracks
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'playlists' }"
        @click="activeTab = 'playlists'"
      >
        Playlists
      </button>
    </div>

    <!-- Tracks Tab -->
    <div v-if="activeTab === 'tracks'">
      <div class="toolbar glass">
        <input
          v-model="search"
          type="text"
          placeholder="Search by title, artist, album..."
          class="search-input"
        />
        <button class="btn" :disabled="scanning" @click="rescanLibrary">
          <span v-if="scanning" class="spinner"></span>
          {{ scanning ? 'Scanning...' : 'Rescan Library' }}
        </button>
      </div>

      <div v-if="lastScanDate" class="scan-info">
        Last scanned: {{ lastScanDate }}
      </div>

      <div v-if="loading" class="loading">Loading tracks...</div>

      <div v-else-if="artistKeys.length === 0" class="empty">
        No tracks found.
      </div>

      <div v-else class="track-tree">
        <div v-for="artist in artistKeys" :key="artist" class="artist-section glass">
          <button class="artist-header" @click="toggleArtist(artist)">
            <span class="collapse-icon">{{ expandedArtists.has(artist) ? '▾' : '▸' }}</span>
            <span class="artist-name">{{ artist }}</span>
            <span class="artist-count">{{ artistTrackCount(artist) }} tracks</span>
          </button>

          <div v-if="expandedArtists.has(artist)" class="artist-body">
            <div
              v-for="album in Object.keys(groupedTracks[artist])"
              :key="album"
              class="album-section"
            >
              <div class="album-header">
                <span class="album-icon">💿</span>
                <span class="album-name">{{ album }}</span>
              </div>
              <div class="track-list">
                <div
                  v-for="track in groupedTracks[artist][album]"
                  :key="track.id"
                  class="track-row"
                  :class="{ active: currentTrack?.id === track.id }"
                >
                  <button class="play-btn" @click="playTrack(track)">
                    {{ currentTrack?.id === track.id && isPlaying ? '⏸' : '▶' }}
                  </button>
                  <span class="track-title">{{ track.title }}</span>
                  <span class="track-duration">{{ formatDuration(track.duration) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Playlists Tab -->
    <div v-if="activeTab === 'playlists'">
      <div class="toolbar glass">
        <input
          v-model="newPlaylistName"
          type="text"
          placeholder="New playlist name..."
          class="search-input"
          @keyup.enter="createPlaylist"
        />
        <button class="btn" :disabled="!newPlaylistName.trim()" @click="createPlaylist">
          Create Playlist
        </button>
      </div>

      <div v-if="loadingPlaylists" class="loading">Loading playlists...</div>

      <div v-else-if="!selectedPlaylist">
        <div v-if="playlists.length === 0" class="empty">No playlists yet.</div>
        <div v-else class="playlist-list">
          <div
            v-for="pl in playlists"
            :key="pl.id"
            class="playlist-card glass"
            @click="selectPlaylist(pl)"
          >
            <div class="playlist-info">
              <span class="playlist-name">{{ pl.name }}</span>
              <span class="playlist-count">{{ pl.tracks?.length || 0 }} tracks</span>
            </div>
            <button class="btn btn-danger" @click.stop="deletePlaylist(pl.id)">Delete</button>
          </div>
        </div>
      </div>

      <div v-else class="playlist-detail">
        <div class="playlist-detail-header">
          <button class="btn btn-back" @click="selectedPlaylist = null">← Back</button>
          <h2>{{ selectedPlaylist.name }}</h2>
        </div>
        <div v-if="!selectedPlaylist.tracks?.length" class="empty">
          This playlist is empty.
        </div>
        <div v-else class="track-list">
          <div
            v-for="track in selectedPlaylist.tracks"
            :key="track.id"
            class="track-row"
            :class="{ active: currentTrack?.id === track.id }"
          >
            <button class="play-btn" @click="playTrack(track)">
              {{ currentTrack?.id === track.id && isPlaying ? '⏸' : '▶' }}
            </button>
            <span class="track-title">{{ track.title }}</span>
            <span class="track-artist">{{ track.artist }}</span>
            <span class="track-duration">{{ formatDuration(track.duration) }}</span>
            <button class="btn btn-sm btn-danger" @click="removeFromPlaylist(selectedPlaylist!.id, track.id)">
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Audio Player (sticky bottom bar) -->
    <div v-if="currentTrack" class="player glass">
      <div class="player-info">
        <span class="player-title">{{ currentTrack.title }}</span>
        <span class="player-artist">{{ currentTrack.artist }}</span>
      </div>
      <div class="player-controls">
        <button class="ctrl-btn" @click="prevTrack">⏮</button>
        <button class="ctrl-btn ctrl-play" @click="togglePlay">
          {{ isPlaying ? '⏸' : '▶' }}
        </button>
        <button class="ctrl-btn" @click="nextTrack">⏭</button>
      </div>
      <div class="player-progress">
        <span class="time">{{ formatDuration(currentTime) }}</span>
        <div class="progress-bar" @click="seek($event)">
          <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <span class="time">{{ formatDuration(duration) }}</span>
      </div>
      <div class="player-volume">
        <span class="volume-icon">🔊</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="volume"
          class="volume-slider"
          @input="setVolume($event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
}

interface Playlist {
  id: string
  name: string
  tracks?: Track[]
}

const activeTab = ref<'tracks' | 'playlists'>('tracks')
const search = ref('')
const loading = ref(true)
const scanning = ref(false)
const lastScanDate = ref('')
const tracks = ref<Track[]>([])
const expandedArtists = ref<Set<string>>(new Set())

const playlists = ref<Playlist[]>([])
const loadingPlaylists = ref(false)
const newPlaylistName = ref('')
const selectedPlaylist = ref<Playlist | null>(null)

const currentTrack = ref<Track | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)

let audio: HTMLAudioElement | null = null
let flatList: Track[] = []

function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const filteredTracks = computed(() => {
  if (!search.value) return tracks.value
  const q = search.value.toLowerCase()
  return tracks.value.filter(
    t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
  )
})

const groupedTracks = computed(() => {
  const map: Record<string, Record<string, Track[]>> = {}
  for (const t of filteredTracks.value) {
    const artist = t.artist || 'Unknown Artist'
    const album = t.album || 'Unknown Album'
    if (!map[artist]) map[artist] = {}
    if (!map[artist][album]) map[artist][album] = []
    map[artist][album].push(t)
  }
  return map
})

const artistKeys = computed(() => Object.keys(groupedTracks.value).sort())

function artistTrackCount(artist: string): number {
  const albums = groupedTracks.value[artist]
  if (!albums) return 0
  return Object.values(albums).reduce((sum, arr) => sum + arr.length, 0)
}

function toggleArtist(artist: string) {
  const next = new Set(expandedArtists.value)
  if (next.has(artist)) {
    next.delete(artist)
  } else {
    next.add(artist)
  }
  expandedArtists.value = next
}

// Audio playback
function initAudio() {
  if (audio) return
  audio = new Audio()
  audio.volume = volume.value
  audio.addEventListener('timeupdate', () => {
    currentTime.value = audio!.currentTime
  })
  audio.addEventListener('loadedmetadata', () => {
    duration.value = audio!.duration
  })
  audio.addEventListener('ended', () => {
    nextTrack()
  })
  audio.addEventListener('play', () => {
    isPlaying.value = true
  })
  audio.addEventListener('pause', () => {
    isPlaying.value = false
  })
}

function buildFlatList() {
  if (activeTab.value === 'playlists' && selectedPlaylist.value?.tracks?.length) {
    flatList = selectedPlaylist.value.tracks
  } else {
    flatList = filteredTracks.value
  }
}

function playTrack(track: Track) {
  if (currentTrack.value?.id === track.id) {
    togglePlay()
    return
  }
  initAudio()
  currentTrack.value = track
  audio!.src = `/api/music/stream/${track.id}`
  audio!.play()
  buildFlatList()
}

function togglePlay() {
  if (!audio) return
  if (audio.paused) {
    audio.play()
  } else {
    audio.pause()
  }
}

function prevTrack() {
  if (!currentTrack.value || flatList.length === 0) return
  const idx = flatList.findIndex(t => t.id === currentTrack.value!.id)
  const prev = idx > 0 ? flatList[idx - 1] : flatList[flatList.length - 1]
  currentTrack.value = null
  playTrack(prev)
}

function nextTrack() {
  if (!currentTrack.value || flatList.length === 0) return
  const idx = flatList.findIndex(t => t.id === currentTrack.value!.id)
  const next = idx < flatList.length - 1 ? flatList[idx + 1] : flatList[0]
  currentTrack.value = null
  playTrack(next)
}

function seek(e: MouseEvent) {
  if (!audio) return
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  audio.currentTime = ratio * audio.duration
}

function setVolume(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  volume.value = val
  if (audio) audio.volume = val
}

const progressPercent = computed(() => {
  if (!duration.value) return 0
  return (currentTime.value / duration.value) * 100
})

// API calls
async function fetchTracks() {
  loading.value = true
  try {
    const res = await fetch('/api/music/tracks')
    tracks.value = await res.json()
  } catch (e) {
    console.error('Failed to fetch tracks:', e)
  } finally {
    loading.value = false
  }
}

async function rescanLibrary() {
  scanning.value = true
  try {
    await fetch('/api/music/scan')
    await fetchTracks()
    lastScanDate.value = new Date().toLocaleString()
  } catch (e) {
    console.error('Failed to scan library:', e)
  } finally {
    scanning.value = false
  }
}

async function fetchPlaylists() {
  loadingPlaylists.value = true
  try {
    const res = await fetch('/api/music/playlists')
    playlists.value = await res.json()
  } catch (e) {
    console.error('Failed to fetch playlists:', e)
  } finally {
    loadingPlaylists.value = false
  }
}

async function createPlaylist() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  try {
    const res = await fetch('/api/music/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const pl = await res.json()
    playlists.value.push(pl)
    newPlaylistName.value = ''
  } catch (e) {
    console.error('Failed to create playlist:', e)
  }
}

async function deletePlaylist(id: string) {
  try {
    await fetch(`/api/music/playlists/${id}`, { method: 'DELETE' })
    playlists.value = playlists.value.filter(p => p.id !== id)
  } catch (e) {
    console.error('Failed to delete playlist:', e)
  }
}

async function selectPlaylist(pl: Playlist) {
  try {
    const res = await fetch(`/api/music/playlists/${pl.id}`)
    selectedPlaylist.value = await res.json()
  } catch (e) {
    console.error('Failed to fetch playlist:', e)
  }
}

async function removeFromPlaylist(playlistId: string, trackId: string) {
  try {
    await fetch(`/api/music/playlists/${playlistId}/tracks/${trackId}`, {
      method: 'DELETE',
    })
    if (selectedPlaylist.value) {
      selectedPlaylist.value = {
        ...selectedPlaylist.value,
        tracks: selectedPlaylist.value.tracks?.filter(t => t.id !== trackId),
      }
    }
  } catch (e) {
    console.error('Failed to remove track:', e)
  }
}

watch(activeTab, tab => {
  if (tab === 'playlists' && playlists.value.length === 0) {
    fetchPlaylists()
  }
})

onMounted(() => {
  fetchTracks()
})

onUnmounted(() => {
  if (audio) {
    audio.pause()
    audio.src = ''
    audio = null
  }
})
</script>

<style scoped>
.page {
  padding: 24px 0;
}

.page.has-player {
  padding-bottom: 120px;
}

h1 {
  font-size: 2rem;
  margin-bottom: 16px;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Tab Switcher */
.tab-switcher {
  display: inline-flex;
  gap: 2px;
  padding: 4px;
  margin-bottom: 20px;
}

.tab-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 10px 24px;
  font-size: 0.95rem;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  color: #fff;
  font-weight: 600;
}

/* Toolbar */
.toolbar {
  display: flex;
  gap: 12px;
  padding: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
}

.search-input {
  background: var(--bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 10px 14px;
  font-size: 0.95rem;
  outline: none;
  flex: 1;
  min-width: 200px;
  transition: border-color var(--transition-fast);
}

.search-input:focus {
  border-color: var(--accent-teal);
}

.btn {
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  border: none;
  color: #fff;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  cursor: pointer;
  transition: opacity var(--transition-fast);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn:hover {
  opacity: 0.85;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-danger {
  background: linear-gradient(135deg, #e74c3c, #c0392b);
}

.btn-back {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
}

.btn-back:hover {
  color: var(--text-primary);
  border-color: var(--accent-teal);
  opacity: 1;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 0.8rem;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.scan-info {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: 16px;
}

.loading,
.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 0;
  font-size: 1.1rem;
}

/* Track Tree */
.track-tree {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.artist-section {
  overflow: hidden;
}

.artist-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.artist-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.collapse-icon {
  color: var(--accent-teal);
  font-size: 0.9rem;
  width: 16px;
}

.artist-name {
  flex: 1;
}

.artist-count {
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 400;
}

.artist-body {
  padding: 0 16px 16px;
}

.album-section {
  margin-top: 8px;
}

.album-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  border-bottom: 1px solid var(--glass-border);
}

.album-icon {
  font-size: 0.85rem;
}

.album-name {
  flex: 1;
}

/* Track rows */
.track-list {
  display: flex;
  flex-direction: column;
}

.track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 24px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.track-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.track-row.active {
  background: rgba(123, 104, 238, 0.15);
}

.play-btn {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--accent-teal);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.play-btn:hover {
  background: var(--accent-teal);
  color: #fff;
  border-color: var(--accent-teal);
}

.track-title {
  flex: 1;
  font-size: 0.9rem;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-artist {
  color: var(--text-muted);
  font-size: 0.85rem;
  flex-shrink: 0;
}

.track-duration {
  color: var(--text-muted);
  font-size: 0.85rem;
  flex-shrink: 0;
  min-width: 40px;
  text-align: right;
}

/* Playlists */
.playlist-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.playlist-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.playlist-card:hover {
  background: rgba(255, 255, 255, 0.08);
}

.playlist-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.playlist-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.playlist-count {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.playlist-detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.playlist-detail-header h2 {
  font-size: 1.4rem;
  color: var(--text-primary);
  margin: 0;
}

/* Audio Player */
.player {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 24px;
  background: rgba(10, 10, 26, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--glass-border);
  z-index: 1000;
}

.player-info {
  display: flex;
  flex-direction: column;
  min-width: 150px;
  max-width: 200px;
}

.player-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-artist {
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctrl-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  transition: color var(--transition-fast);
}

.ctrl-btn:hover {
  color: var(--text-primary);
}

.ctrl-play {
  width: 40px;
  height: 40px;
  border: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.ctrl-play:hover {
  border-color: var(--accent-teal);
  color: var(--accent-teal);
}

.player-progress {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.time {
  font-size: 0.75rem;
  color: var(--text-muted);
  min-width: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}

.progress-bar:hover {
  height: 6px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-teal), var(--accent-purple));
  border-radius: 2px;
  transition: width 0.1s linear;
}

.player-volume {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.volume-icon {
  font-size: 0.85rem;
}

.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  outline: none;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-teal);
  cursor: pointer;
}

.volume-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-teal);
  cursor: pointer;
  border: none;
}

/* Responsive */
@media (max-width: 768px) {
  .player {
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 16px;
  }

  .player-info {
    min-width: unset;
    max-width: unset;
    flex: 1;
  }

  .player-progress {
    order: 3;
    flex-basis: 100%;
  }

  .player-volume {
    min-width: unset;
  }

  .page.has-player {
    padding-bottom: 160px;
  }

  .track-row {
    padding-left: 8px;
  }
}
</style>
