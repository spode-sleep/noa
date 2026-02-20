<template>
  <div v-if="currentTrack && !isMinimized" class="player glass">
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
      <button
        class="ctrl-btn"
        :class="{ 'ctrl-active': repeatMode !== 'off' }"
        @click="cycleRepeat"
        :title="repeatMode === 'off' ? 'Repeat off' : repeatMode === 'all' ? 'Repeat all' : 'Repeat one'"
      >
        <Icon :icon="repeatMode === 'one' ? 'mdi:repeat-once' : 'mdi:repeat'" />
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
    <button class="ctrl-btn ctrl-minimize" @click="toggleMinimize" title="Minimize player">
      <Icon icon="mdi:chevron-down" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useMusicPlayer, type Track } from '../composables/useMusicPlayer'
import { usePlayerStack } from '../composables/usePlayerStack'

defineEmits<{
  'open-playlist-picker': [track: Track]
}>()

const { isMinimized, toggleMinimize } = usePlayerStack()

const {
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  volume,
  repeatMode,
  progressPercent,
  togglePlay,
  prevTrack,
  nextTrack,
  seek,
  setVolume,
  formatDuration,
  cycleRepeat,
} = useMusicPlayer()
</script>

<style scoped>
.player {
  position: relative;
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

.ctrl-active {
  color: var(--accent-teal);
}

.ctrl-active:hover {
  color: var(--accent-teal);
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
  display: flex;
  align-items: center;
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

</style>
