<template>
  <!-- Mini mode: floating circle in bottom-right corner -->
  <div v-if="currentTrack && minimized" class="mini-player" @click="minimized = false">
    <div v-if="isPlaying" class="wave wave1"></div>
    <div v-if="isPlaying" class="wave wave2"></div>
    <div v-if="isPlaying" class="wave wave3"></div>
    <div class="mini-circle">
      <Icon icon="mdi:music-note" />
    </div>
  </div>
  <!-- Full player bar -->
  <div v-if="currentTrack && !minimized" class="player glass">
    <div class="player-info">
      <span class="player-title">{{ currentTrack.title }}</span>
      <span class="player-artist">{{ currentTrack.artist }}</span>
    </div>
    <div class="player-controls">
      <button class="ctrl-btn" @click="prevTrack">
        <Icon icon="mdi:skip-previous" />
      </button>
      <button class="ctrl-btn ctrl-play" @click="togglePlay">
        <Icon :icon="isPlaying ? 'mdi:pause' : 'mdi:play'" />
      </button>
      <button class="ctrl-btn" @click="nextTrack">
        <Icon icon="mdi:skip-next" />
      </button>
      <button class="ctrl-btn ctrl-add" @click="$emit('open-playlist-picker', currentTrack)" title="Add to playlist">
        <Icon icon="mdi:playlist-plus" />
      </button>
    </div>
    <div class="player-progress">
      <span class="time">{{ formatDuration(currentTime) }}</span>
      <div class="progress-bar" @click="seek($event)">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="time">{{ formatDuration(duration) }}</span>
    </div>
    <div class="player-volume">
      <Icon icon="mdi:volume-high" class="volume-icon" />
      <div class="volume-bar-wrapper">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="volume"
          class="volume-slider"
          :style="{ '--volume-pct': (volume * 100) + '%' }"
          @input="setVolume($event)"
        />
      </div>
    </div>
    <button class="ctrl-btn ctrl-minimize" @click="minimized = true" title="Minimize player">
      <Icon icon="mdi:chevron-down" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useMusicPlayer, type Track } from '../composables/useMusicPlayer'

defineEmits<{
  'open-playlist-picker': [track: Track]
}>()

const minimized = ref(false)

const {
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  volume,
  progressPercent,
  togglePlay,
  prevTrack,
  nextTrack,
  seek,
  setVolume,
  formatDuration,
} = useMusicPlayer()
</script>

<style scoped>
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
  font-size: 1.4rem;
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  transition: color var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ctrl-btn:hover {
  color: var(--text-primary);
}

.ctrl-play {
  width: 40px;
  height: 40px;
  border: 1px solid var(--glass-border);
  font-size: 1.3rem;
}

.ctrl-play:hover {
  border-color: var(--accent-teal);
  color: var(--accent-teal);
}

.ctrl-add {
  width: 32px;
  height: 32px;
  border: 1px solid var(--glass-border);
  font-size: 1.2rem;
}

.ctrl-add:hover {
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
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  cursor: pointer;
  position: relative;
}

.progress-bar:hover {
  height: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-teal), var(--accent-purple));
  border-radius: 3px;
  transition: width 0.1s linear;
}

.player-volume {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.volume-icon {
  font-size: 1.2rem;
  color: var(--text-secondary);
}

.volume-bar-wrapper {
  position: relative;
  width: 80px;
}

.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    var(--accent-teal) 0%,
    var(--accent-teal) var(--volume-pct, 100%),
    rgba(255, 255, 255, 0.1) var(--volume-pct, 100%),
    rgba(255, 255, 255, 0.1) 100%
  );
  outline: none;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent-teal);
  cursor: pointer;
  box-shadow: 0 0 6px rgba(0, 232, 184, 0.4);
}

.volume-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent-teal);
  cursor: pointer;
  border: none;
  box-shadow: 0 0 6px rgba(0, 232, 184, 0.4);
}

.volume-slider::-moz-range-progress {
  background: var(--accent-teal);
  border-radius: 3px;
  height: 6px;
}

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
}

.ctrl-minimize {
  margin-left: 4px;
  font-size: 1.2rem;
}

.ctrl-minimize:hover {
  color: var(--accent-teal);
}

/* Mini player floating circle */
.mini-player {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1000;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-circle {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: #fff;
  box-shadow: 0 0 16px rgba(0, 232, 184, 0.5);
  position: relative;
  z-index: 2;
  transition: transform 0.2s ease;
}

.mini-player:hover .mini-circle {
  transform: scale(1.1);
}

/* Animated waves */
.wave {
  position: absolute;
  border-radius: 50%;
  border: 2px solid var(--accent-teal);
  opacity: 0;
  animation: wave-pulse 2.4s ease-out infinite;
}

.wave1 {
  width: 52px;
  height: 52px;
  animation-delay: 0s;
}

.wave2 {
  width: 52px;
  height: 52px;
  animation-delay: 0.8s;
}

.wave3 {
  width: 52px;
  height: 52px;
  animation-delay: 1.6s;
}

@keyframes wave-pulse {
  0% {
    width: 52px;
    height: 52px;
    opacity: 0.6;
  }
  100% {
    width: 120px;
    height: 120px;
    opacity: 0;
  }
}
</style>
