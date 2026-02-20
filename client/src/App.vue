<template>
  <div id="app">
    <HeaderNav />
    <main class="container" :class="{ 'has-player': !!currentTrack || ttsActive }">
      <router-view />
    </main>
    <MusicPlayerBar @open-playlist-picker="openPicker" />
    <TtsPlayerBar />

    <!-- Playlist picker modal (global) -->
    <Teleport to="body">
      <div v-if="showPlaylistPicker" class="playlist-picker-overlay" @click.self="showPlaylistPicker = false">
        <div class="playlist-picker glass">
          <div class="picker-header">
            <h3>Add to Playlist</h3>
            <button class="picker-close" @click="showPlaylistPicker = false"><Icon icon="mdi:close" /></button>
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
import { ref, onMounted, onUnmounted } from 'vue'
import HeaderNav from './components/HeaderNav.vue'
import MusicPlayerBar from './components/MusicPlayerBar.vue'
import TtsPlayerBar from './components/TtsPlayerBar.vue'
import { Icon } from '@iconify/vue'
import { useMusicPlayer, type Track, type Playlist } from './composables/useMusicPlayer'
import { useTtsPlayer } from './composables/useTtsPlayer'

const { currentTrack } = useMusicPlayer()
const { speak, getSelectedText, isActive: ttsActive } = useTtsPlayer()

function onGlobalKeydown(e: KeyboardEvent) {
  // Ctrl+Shift+S — speak selected text
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault()
    const text = getSelectedText()
    if (text) speak(text)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

const showPlaylistPicker = ref(false)
const pickerTrack = ref<Track | null>(null)
const pickerNewName = ref('')
const playlists = ref<Playlist[]>([])

function openPicker(track: Track) {
  pickerTrack.value = track
  pickerNewName.value = ''
  showPlaylistPicker.value = true
  fetchPlaylists()
}

async function fetchPlaylists() {
  try {
    const res = await fetch('/api/music/playlists')
    const data = await res.json()
    playlists.value = data.playlists || []
  } catch (e) {
    console.error('Failed to fetch playlists:', e)
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
</script>

<style scoped>
main {
  padding-top: 24px;
  padding-bottom: 48px;
}

main.has-player {
  padding-bottom: 120px;
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

.btn-sm {
  padding: 4px 12px;
  font-size: 0.8rem;
}
</style>
