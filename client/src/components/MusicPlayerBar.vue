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
      <button class="ctrl-btn" @click="stop" title="Stop">
        <Icon icon="mdi:stop" />
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
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useMusicPlayer, type Track } from '../composables/useMusicPlayer'
import { usePlayerStack } from '../composables/usePlayerStack'

defineEmits<{
  'open-playlist-picker': [track: Track]
}>()

const { isMinimized } = usePlayerStack()

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
  stop,
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
  background: var(--askew-btn-disabled);
  border-top: 1px solid #000000;
  box-shadow: inset 0 1px 0 var(--askew-btn);
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
  background: var(--askew-btn-hover);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-cream), inset -1px -1px 0 var(--askew-btn);
  color: var(--bg-primary);
  font-size: 1.3rem;
  cursor: pointer;
  padding: 6px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ctrl-btn:hover {
  background: var(--askew-btn-highlight);
  border-color: var(--askew-dark-border);
  box-shadow: inset 1px 1px 0 var(--askew-cream), inset -1px -1px 0 var(--askew-btn-hover);
  color: var(--askew-gold);
}

.ctrl-play {
  width: 36px;
  height: 36px;
  font-size: 1.3rem;
}

.ctrl-play:hover {
  background: var(--askew-btn-highlight);
  border-color: var(--askew-dark-border);
  color: var(--askew-gold);
}

.ctrl-add {
  width: 36px;
  height: 36px;
  font-size: 1.2rem;
}

.ctrl-active {
  color: var(--askew-gold);
}

.ctrl-active:hover {
  color: var(--askew-gold);
}

.ctrl-add:hover {
  background: var(--askew-btn-highlight);
  border-color: var(--askew-dark-border);
  color: var(--askew-gold);
}

.player-progress {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.time {
  font-size: 0.75rem;
  color: var(--askew-cream);
  min-width: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--askew-btn-disabled);
  border: 1px solid #000000;
  cursor: pointer;
  position: relative;
}

.progress-bar:hover {
  height: 8px;
}

.progress-fill {
  height: 100%;
  background: var(--askew-gold);
  transition: width 0.1s linear;
}

.player-volume {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.volume-icon {
  font-size: 1.1rem;
  color: var(--askew-cream);
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
  background: linear-gradient(
    to right,
    var(--askew-gold) 0%,
    var(--askew-gold) var(--volume-pct, 100%),
    var(--askew-btn-disabled) var(--volume-pct, 100%),
    var(--askew-btn-disabled) 100%
  );
  border: 1px solid #000000;
  outline: none;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: var(--askew-btn-hover);
  border: 1px solid #000000;
  cursor: pointer;
}

.volume-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--askew-btn-hover);
  border: 1px solid #000000;
  cursor: pointer;
}

.volume-slider::-moz-range-progress {
  background: var(--askew-gold);
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

</style>
