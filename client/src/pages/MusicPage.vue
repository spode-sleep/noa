<template>
  <div class="page">
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

      <!-- Search sub-tabs -->
      <div v-if="search" class="search-tabs">
        <button
          class="search-tab"
          :class="{ active: searchMode === 'track' }"
          @click="searchMode = 'track'"
        >Track</button>
        <button
          class="search-tab"
          :class="{ active: searchMode === 'album' }"
          @click="searchMode = 'album'"
        >Album</button>
        <button
          class="search-tab"
          :class="{ active: searchMode === 'author' }"
          @click="searchMode = 'author'"
        >Author</button>
      </div>

      <div v-if="lastScanDate" class="scan-info">
        Last scanned: {{ lastScanDate }}
      </div>

      <div v-if="loading" class="loading">Loading tracks...</div>

      <!-- Search results: flat track list -->
      <div v-else-if="search && searchMode === 'track'">
        <div v-if="filteredTracks.length === 0" class="empty">No tracks found.</div>
        <div v-else class="track-list search-track-list">
          <div
            v-for="track in filteredTracks"
            :key="track.id"
            class="track-row"
            :class="{ active: currentTrack?.id === track.id }"
          >
            <button class="play-btn" @click="handlePlay(track)">
              <Icon :icon="currentTrack?.id === track.id && isPlaying ? 'mdi:pause' : 'mdi:play'" />
            </button>
            <span class="track-title">{{ track.title }} <span class="track-artist">— {{ track.artist }}</span></span>
            <span class="track-duration">{{ formatDuration(track.duration) }}</span>
            <div class="track-actions">
              <button class="add-to-playlist-btn" @click.stop="openPlaylistPicker(track)" title="Add to playlist">
                <Icon icon="mdi:playlist-plus" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Search results: grouped by album -->
      <div v-else-if="search && searchMode === 'album'">
        <div v-if="albumGroups.length === 0" class="empty">No albums found.</div>
        <div v-else class="album-grid">
          <div v-for="ag in albumGroups" :key="ag.album" class="album-card glass">
            <div class="album-card-header">
              <Icon icon="mdi:album" class="album-icon" />
              <div class="album-card-info">
                <span class="album-card-name">{{ ag.album }}</span>
                <span class="album-card-artist">{{ ag.artist }}</span>
              </div>
            </div>
            <div class="track-list">
              <div
                v-for="track in ag.tracks"
                :key="track.id"
                class="track-row"
                :class="{ active: currentTrack?.id === track.id }"
              >
                <button class="play-btn" @click="handlePlay(track)">
                  <Icon :icon="currentTrack?.id === track.id && isPlaying ? 'mdi:pause' : 'mdi:play'" />
                </button>
                <span class="track-title">{{ track.title }}</span>
                <span class="track-duration">{{ formatDuration(track.duration) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Search results: grouped by author (same as default tree) -->
      <div v-else-if="search && searchMode === 'author'">
        <div v-if="artistKeys.length === 0" class="empty">No artists found.</div>
        <div v-else class="track-tree">
          <div v-for="artist in artistKeys" :key="artist" class="artist-section glass">
            <button class="artist-header" @click="toggleArtist(artist)">
              <span class="collapse-icon">{{ expandedArtists.has(artist) ? '▾' : '▸' }}</span>
              <span class="artist-name">{{ artist }}</span>
              <span class="artist-count">{{ artistTrackCount(artist) }} tracks</span>
            </button>
            <div v-if="expandedArtists.has(artist)" class="artist-body">
              <div v-for="album in Object.keys(groupedTracks[artist])" :key="album" class="album-section">
                <div class="album-header">
                  <Icon icon="mdi:album" class="album-icon" />
                  <span class="album-name">{{ album }}</span>
                </div>
                <div class="track-list">
                  <div
                    v-for="track in groupedTracks[artist][album]"
                    :key="track.id"
                    class="track-row"
                    :class="{ active: currentTrack?.id === track.id }"
                  >
                    <button class="play-btn" @click="handlePlay(track)">
                      <Icon :icon="currentTrack?.id === track.id && isPlaying ? 'mdi:pause' : 'mdi:play'" />
                    </button>
                    <span class="track-title">{{ track.title }}</span>
                    <span class="track-duration">{{ formatDuration(track.duration) }}</span>
                    <div class="track-actions">
                      <button class="add-to-playlist-btn" @click.stop="openPlaylistPicker(track)" title="Add to playlist">
                        <Icon icon="mdi:playlist-plus" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Default view (no search): artist/album tree -->
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
                <Icon icon="mdi:album" class="album-icon" />
                <span class="album-name">{{ album }}</span>
              </div>
              <div class="track-list">
                <div
                  v-for="track in groupedTracks[artist][album]"
                  :key="track.id"
                  class="track-row"
                  :class="{ active: currentTrack?.id === track.id }"
                >
                  <button class="play-btn" @click="handlePlay(track)">
                    <Icon :icon="currentTrack?.id === track.id && isPlaying ? 'mdi:pause' : 'mdi:play'" />
                  </button>
                  <span class="track-title">{{ track.title }}</span>
                  <span class="track-duration">{{ formatDuration(track.duration) }}</span>
                  <div class="track-actions">
                    <button class="add-to-playlist-btn" @click.stop="openPlaylistPicker(track)" title="Add to playlist">
                      <Icon icon="mdi:playlist-plus" />
                    </button>
                  </div>
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
          class="search-input playlist-name-input"
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
              <span class="playlist-count">{{ pl.trackIds?.length || 0 }} tracks</span>
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
            <button class="play-btn" @click="handlePlay(track)">
              <Icon :icon="currentTrack?.id === track.id && isPlaying ? 'mdi:pause' : 'mdi:play'" />
            </button>
            <span class="track-title">{{ track.title }} <span class="track-artist">— {{ track.artist }}</span></span>
            <span class="track-duration">{{ formatDuration(track.duration) }}</span>
            <button class="btn btn-sm btn-danger" @click="removeFromPlaylist(selectedPlaylist!.id, track.id)">
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Playlist picker modal -->
    <Teleport to="body">
      <div v-if="showPlaylistPicker" class="playlist-picker-overlay" @click.self="showPlaylistPicker = false">
        <div class="playlist-picker glass">
          <div class="picker-header">
            <h3>Add to Playlist</h3>
            <button class="picker-close" @click="showPlaylistPicker = false">✕</button>
          </div>
          <div class="picker-track-info">
            {{ pickerTrack?.title }} — {{ pickerTrack?.artist }}
          </div>
          <div v-if="playlists.length === 0" class="picker-empty">
            No playlists yet. Create one first.
          </div>
          <div v-else class="picker-list">
            <button
              v-for="pl in playlists"
              :key="pl.id"
              class="picker-item"
              @click="addTrackToPlaylist(pl.id)"
            >
              <span class="picker-item-name">{{ pl.name }}</span>
              <span class="picker-item-count">{{ pl.trackIds?.length || 0 }} tracks</span>
            </button>
          </div>
          <div class="picker-create">
            <input
              v-model="pickerNewName"
              type="text"
              placeholder="New playlist name..."
              class="picker-input"
              @keyup.enter="createAndAdd"
            />
            <button class="btn btn-sm" :disabled="!pickerNewName.trim()" @click="createAndAdd">Create & Add</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useMusicPlayer, type Track, type Playlist } from '../composables/useMusicPlayer'

const {
  currentTrack,
  isPlaying,
  playTrack,
  setFlatList,
  formatDuration,
} = useMusicPlayer()

const activeTab = ref<'tracks' | 'playlists'>('tracks')
const search = ref('')
const searchMode = ref<'track' | 'album' | 'author'>('track')
const loading = ref(true)
const scanning = ref(false)
const lastScanDate = ref('')
const tracks = ref<Track[]>([])
const expandedArtists = ref<Set<string>>(new Set())

const playlists = ref<Playlist[]>([])
const loadingPlaylists = ref(false)
const newPlaylistName = ref('')
const selectedPlaylist = ref<Playlist | null>(null)

const showPlaylistPicker = ref(false)
const pickerTrack = ref<Track | null>(null)
const pickerNewName = ref('')

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
  // Sort tracks within each album by track number then title
  for (const artist of Object.keys(map)) {
    for (const album of Object.keys(map[artist])) {
      map[artist][album].sort((a, b) => {
        const na = a.trackNumber ?? Infinity
        const nb = b.trackNumber ?? Infinity
        if (na !== nb) return na - nb
        return a.title.localeCompare(b.title)
      })
    }
  }
  return map
})

const artistKeys = computed(() => Object.keys(groupedTracks.value).sort())

const albumGroups = computed(() => {
  const map: Record<string, { album: string; artist: string; tracks: Track[] }> = {}
  for (const t of filteredTracks.value) {
    const album = t.album || 'Unknown Album'
    if (!map[album]) map[album] = { album, artist: t.artist || 'Unknown Artist', tracks: [] }
    map[album].tracks.push(t)
  }
  return Object.values(map).sort((a, b) => a.album.localeCompare(b.album))
})

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

function handlePlay(track: Track) {
  // Update flat list for prev/next navigation
  if (activeTab.value === 'playlists' && selectedPlaylist.value?.tracks?.length) {
    setFlatList(selectedPlaylist.value.tracks)
  } else {
    setFlatList(filteredTracks.value)
  }
  playTrack(track)
}

// API calls
async function fetchTracks() {
  loading.value = true
  try {
    const res = await fetch('/api/music/tracks')
    const data = await res.json()
    tracks.value = data.tracks || []
    if (data.last_scan) {
      lastScanDate.value = new Date(data.last_scan).toLocaleString()
    }
    resolveZeroDurations()
  } catch (e) {
    console.error('Failed to fetch tracks:', e)
  } finally {
    loading.value = false
  }
}

function resolveZeroDurations() {
  const zeroDuration = tracks.value.filter(t => !t.duration)
  const BATCH_SIZE = 5
  let i = 0

  function processBatch() {
    const batch = zeroDuration.slice(i, i + BATCH_SIZE)
    if (batch.length === 0) return

    for (const track of batch) {
      const tmpAudio = new Audio(`/api/music/stream/${track.id}`)
      const onMeta = () => {
        if (tmpAudio.duration && isFinite(tmpAudio.duration)) {
          track.duration = Math.round(tmpAudio.duration)
        }
        cleanup()
      }
      const onError = () => cleanup()
      const cleanup = () => {
        tmpAudio.removeEventListener('loadedmetadata', onMeta)
        tmpAudio.removeEventListener('error', onError)
        tmpAudio.src = ''
      }
      tmpAudio.addEventListener('loadedmetadata', onMeta)
      tmpAudio.addEventListener('error', onError)
      tmpAudio.load()
    }
    i += BATCH_SIZE
    if (i < zeroDuration.length) {
      setTimeout(processBatch, 500)
    }
  }
  processBatch()
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
    const data = await res.json()
    playlists.value = data.playlists || []
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

function selectPlaylist(pl: Playlist) {
  const resolvedTracks = (pl.trackIds || [])
    .map(id => tracks.value.find(t => t.id === id))
    .filter((t): t is Track => t !== undefined)
  selectedPlaylist.value = { ...pl, tracks: resolvedTracks }
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

function openPlaylistPicker(track: Track) {
  pickerTrack.value = track
  pickerNewName.value = ''
  showPlaylistPicker.value = true
  if (playlists.value.length === 0) {
    fetchPlaylists()
  }
}

async function addTrackToPlaylist(playlistId: string) {
  if (!pickerTrack.value) return
  try {
    await fetch(`/api/music/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: pickerTrack.value.id }),
    })
    const pl = playlists.value.find(p => p.id === playlistId)
    if (pl && !pl.trackIds.includes(pickerTrack.value.id)) {
      pl.trackIds.push(pickerTrack.value.id)
    }
    showPlaylistPicker.value = false
  } catch (e) {
    console.error('Failed to add track to playlist:', e)
  }
}

async function createAndAdd() {
  const name = pickerNewName.value.trim()
  if (!name || !pickerTrack.value) return
  try {
    const res = await fetch('/api/music/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const pl = await res.json()
    playlists.value.push(pl)
    await addTrackToPlaylist(pl.id)
  } catch (e) {
    console.error('Failed to create playlist:', e)
  }
}

watch(activeTab, tab => {
  if (tab === 'playlists' && playlists.value.length === 0) {
    fetchPlaylists()
  }
})

onMounted(() => {
  document.title = 'BOX - Music'
  fetchTracks()
})
</script>

<style scoped>
.page {
  padding: 24px 0;
}

h1 {
  font-size: 2rem;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #8b6cee, var(--accent-blue));
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
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  border-bottom: 1px solid var(--glass-border);
}

.album-icon {
  font-size: 1rem;
  color: var(--accent-teal);
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

/* Responsive */
@media (max-width: 768px) {
  .track-row {
    padding-left: 8px;
  }
}

/* Search sub-tabs */
.search-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 4px;
  margin-bottom: 16px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
}

.search-tab {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 6px 16px;
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.search-tab:hover {
  color: var(--text-primary);
}

.search-tab.active {
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
  color: #fff;
}

/* Search track list */
.search-track-list {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  padding: 8px;
}

/* Album grid for album search */
.album-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.album-card {
  padding: 16px;
}

.album-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--glass-border);
}

.album-card-info {
  display: flex;
  flex-direction: column;
}

.album-card-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.album-card-artist {
  font-size: 0.85rem;
  color: var(--text-muted);
}

/* Track actions */
.track-actions {
  flex-shrink: 0;
}

.add-to-playlist-btn {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.add-to-playlist-btn:hover {
  border-color: var(--accent-teal);
  color: var(--accent-teal);
}

/* Playlist picker modal */
.playlist-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 24px;
}

.playlist-picker {
  width: 100%;
  max-width: 400px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 8px;
}

.picker-header h3 {
  font-size: 1.1rem;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.picker-close {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.picker-close:hover {
  border-color: var(--accent-teal);
  color: var(--text-primary);
}

.picker-track-info {
  padding: 4px 20px 12px;
  font-size: 0.85rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-empty {
  padding: 24px 20px;
  color: var(--text-muted);
  font-size: 0.9rem;
  text-align: center;
}

.picker-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background var(--transition-fast);
  text-align: left;
  color: var(--text-primary);
}

.picker-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.picker-item-name {
  font-size: 0.95rem;
}

.picker-item-count {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.picker-create {
  display: flex;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--glass-border);
}

.picker-input {
  flex: 1;
  background: var(--bg-primary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: 0.85rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.picker-input:focus {
  border-color: var(--accent-teal);
}
</style>
