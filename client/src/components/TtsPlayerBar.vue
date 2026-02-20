<template>
  <div v-if="isActive && !isMinimized" class="player glass">
    <div class="player-info">
      <span class="player-title"><Icon icon="mdi:microphone" style="color: var(--accent-teal); vertical-align: middle" /> TTS</span>
      <span class="player-artist">{{ displayText }}</span>
    </div>
    <div class="player-controls">
      <button class="ctrl-btn ctrl-play" @click="togglePlay" :disabled="isLoading">
        <Icon v-if="isLoading" icon="mdi:loading" class="spin" />
        <Icon v-else :icon="isPlaying ? 'mdi:pause' : 'mdi:play'" />
      </button>
      <button class="ctrl-btn" @click="stop" title="Stop">
        <Icon icon="mdi:stop" />
      </button>
    </div>
    <div class="player-progress">
      <span class="time">{{ formatDuration(currentTime) }}</span>
      <div class="progress-bar" @click="seek($event)">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="time">{{ formatDuration(duration) }}</span>
    </div>
    <div class="tts-speed">
      <button
        v-for="s in speeds"
        :key="s"
        class="speed-btn"
        :class="{ active: speed === s }"
        @click="setSpeed(s)"
        :title="s + 'x speed'"
      >
        {{ s }}x
      </button>
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
    <div v-if="errorMessage" class="tts-error">{{ errorMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import { usePlayerStack } from '../composables/usePlayerStack'

const speeds = [0.75, 1, 1.25, 1.5]

const { isMinimized } = usePlayerStack()

const {
  isActive,
  isPlaying,
  isLoading,
  displayText,
  currentTime,
  duration,
  speed,
  volume,
  errorMessage,
  progressPercent,
  togglePlay,
  stop,
  seek,
  setSpeed,
  setVolume,
  formatDuration,
} = useTtsPlayer()
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
  z-index: 1001;
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
  min-width: 264px;
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

.ctrl-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ctrl-play {
  width: 40px;
  height: 40px;
  border: 1px solid var(--glass-border);
  font-size: 1.3rem;
}

.ctrl-play:hover:not(:disabled) {
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

.tts-speed {
  display: flex;
  gap: 4px;
}

.speed-btn {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.speed-btn:hover {
  border-color: var(--accent-teal);
  color: var(--text-primary);
}

.speed-btn.active {
  background: rgba(0, 212, 170, 0.15);
  border-color: var(--accent-teal);
  color: var(--accent-teal);
}

.tts-error {
  font-size: 0.75rem;
  color: #e74c3c;
}

.player-volume {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.volume-icon {
  font-size: 1.1rem;
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

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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

  .tts-speed {
    order: 4;
    flex-basis: 100%;
    justify-content: center;
  }
}
</style>
