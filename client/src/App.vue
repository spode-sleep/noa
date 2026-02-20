<template>
  <div id="app">
    <HeaderNav />
    <main class="container" :class="{ 'has-player': !!currentTrack || ttsActive }">
      <router-view />
    </main>
    <div class="player-stack">
      <button
        v-if="!isMinimized && (!!currentTrack || ttsActive)"
        class="stack-minimize-btn"
        @click="toggleMinimize"
        title="Minimize players"
      >
        <Icon icon="mdi:chevron-down" />
      </button>
      <TtsPlayerBar />
      <MusicPlayerBar @open-playlist-picker="openPicker" />
    </div>

    <!-- Shared mini expand button when players are minimized -->
    <div v-if="isMinimized && (!!currentTrack || ttsActive)" class="mini-player" @click="toggleMinimize">
      <svg v-if="isPlaying || ttsPlaying" class="sq-waves" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <rect class="sq-wave sq-wave1" x="128" y="128" width="72" height="72" fill="none" stroke="var(--askew-btn)" stroke-width="2"/>
        <rect class="sq-wave sq-wave2" x="100" y="100" width="100" height="100" fill="none" stroke="var(--askew-btn)" stroke-width="2"/>
        <rect class="sq-wave sq-wave3" x="68" y="68" width="132" height="132" fill="none" stroke="var(--askew-btn-disabled)" stroke-width="2"/>
      </svg>
      <div class="mini-sq">
        <Icon v-if="!!currentTrack" icon="mdi:music-note" />
        <Icon v-else icon="mdi:volume-high" />
      </div>
    </div>

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
import { ref } from 'vue'
import HeaderNav from './components/HeaderNav.vue'
import MusicPlayerBar from './components/MusicPlayerBar.vue'
import TtsPlayerBar from './components/TtsPlayerBar.vue'
import { Icon } from '@iconify/vue'
import { useMusicPlayer, type Track, type Playlist } from './composables/useMusicPlayer'
import { useTtsPlayer } from './composables/useTtsPlayer'
import { usePlayerStack } from './composables/usePlayerStack'

const { currentTrack, isPlaying } = useMusicPlayer()
const { isActive: ttsActive, isPlaying: ttsPlaying } = useTtsPlayer()
const { isMinimized, toggleMinimize } = usePlayerStack()

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

.player-stack {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.stack-minimize-btn {
  position: absolute;
  top: 0;
  right: 16px;
  transform: translateY(-50%);
  z-index: 1002;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--askew-btn);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  color: var(--text-primary);
  font-size: 1.1rem;
  cursor: pointer;
}

.stack-minimize-btn:hover {
  background: var(--askew-btn-hover);
  border-color: var(--askew-dark-border);
  color: var(--bg-primary);
}

/* Shared mini player square button in bottom-right corner */
.mini-player {
  position: fixed;
  bottom: 0;
  right: 0;
  z-index: 1001;
  cursor: pointer;
  width: 72px;
  height: 72px;
}

.mini-sq {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 72px;
  height: 72px;
  background: var(--askew-btn);
  border-top: 1px solid #000000;
  border-left: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: var(--text-primary);
  z-index: 2;
}

.mini-player:hover .mini-sq {
  background: var(--askew-btn-hover);
  color: var(--bg-primary);
}

.sq-waves {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 200px;
  height: 200px;
  z-index: 1;
  pointer-events: none;
}

.sq-wave {
  opacity: 0;
}

.sq-wave1 {
  animation: sq-pulse 2.4s ease-out infinite;
}

.sq-wave2 {
  animation: sq-pulse 2.4s ease-out 0.8s infinite;
}

.sq-wave3 {
  animation: sq-pulse 2.4s ease-out 1.6s infinite;
}

@keyframes sq-pulse {
  0% {
    opacity: 0.5;
    stroke-width: 3;
  }
  100% {
    opacity: 0;
    stroke-width: 1;
  }
}

/* Playlist picker modal */
.playlist-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
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
  color: var(--askew-gold);
}

.picker-close {
  background: var(--askew-btn);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  color: var(--text-primary);
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.picker-close:hover {
  background: var(--askew-btn-hover);
  border-color: var(--askew-dark-border);
  color: var(--bg-primary);
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
  text-align: left;
  color: var(--text-primary);
}

.picker-item:hover {
  background: var(--askew-btn-disabled);
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
  background: var(--askew-input-bg);
  border: 1px solid var(--askew-input-border);
  color: var(--text-primary);
  padding: 8px 12px;
  font-size: 0.85rem;
  outline: none;
}

.picker-input:focus {
  border-color: var(--askew-btn-hover);
  box-shadow: inset 1px 1px 0 var(--askew-dark-border);
}

.btn {
  background: var(--askew-btn);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  color: var(--text-primary);
  padding: 10px 20px;
  font-size: 0.9rem;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn:hover {
  background: var(--askew-btn-hover);
  border-color: var(--askew-dark-border);
  box-shadow: inset 1px 1px 0 var(--askew-cream), inset -1px -1px 0 var(--askew-btn);
  color: var(--bg-primary);
}

.btn:disabled {
  background: var(--askew-btn-disabled);
  box-shadow: none;
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 0.8rem;
}
</style>
