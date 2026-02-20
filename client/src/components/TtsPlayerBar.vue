<template>
  <div v-if="isActive && !isMinimized" class="tts-player glass">
    <div class="tts-info">
      <span class="tts-label"><Icon icon="mdi:volume-high" width="20" height="20" style="color: var(--accent-teal); vertical-align: middle" /> TTS</span>
      <span class="tts-text">{{ displayText }}</span>
    </div>
    <div class="tts-controls">
      <button class="ctrl-btn ctrl-play" @click="togglePlay" :disabled="isLoading">
        <Icon v-if="isLoading" icon="mdi:loading" class="spin" />
        <Icon v-else :icon="isPlaying ? 'mdi:pause' : 'mdi:play'" />
      </button>
      <button class="ctrl-btn" @click="stop" title="Stop">
        <Icon icon="mdi:stop" />
      </button>
    </div>
    <div class="tts-progress">
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
    <div class="tts-volume">
      <Icon icon="mdi:volume-high" class="volume-icon" />
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
    <button class="ctrl-btn ctrl-minimize" @click="toggleMinimize" title="Minimize player">
      <Icon icon="mdi:chevron-down" />
    </button>
    <div v-if="errorMessage" class="tts-error">{{ errorMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import { usePlayerStack } from '../composables/usePlayerStack'

const speeds = [0.75, 1, 1.25, 1.5]

const { isMinimized, toggleMinimize } = usePlayerStack()

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
.tts-player {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 24px;
  background: rgba(10, 10, 26, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--glass-border);
  z-index: 1001;
}

.tts-info {
  display: flex;
  flex-direction: column;
  min-width: 120px;
  max-width: 200px;
}

.tts-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.tts-text {
  font-size: 0.8rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tts-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ctrl-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 1.3rem;
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
  width: 36px;
  height: 36px;
  border: 1px solid var(--glass-border);
}

.ctrl-play:hover:not(:disabled) {
  border-color: var(--accent-teal);
  color: var(--accent-teal);
}

.tts-progress {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.time {
  font-size: 0.7rem;
  color: var(--text-muted);
  min-width: 32px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.progress-bar {
  flex: 1;
  height: 5px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  cursor: pointer;
}

.progress-bar:hover {
  height: 7px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-teal), var(--accent-purple));
  border-radius: 3px;
  transition: width 0.2s linear;
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

.ctrl-minimize {
  margin-left: 4px;
  font-size: 1.2rem;
}

.ctrl-minimize:hover {
  color: var(--accent-teal);
}

.tts-volume {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 100px;
}

.volume-icon {
  color: var(--text-muted);
  font-size: 1.1rem;
}

.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 4px;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  background: linear-gradient(
    to right,
    var(--accent-teal) var(--volume-pct, 100%),
    rgba(255, 255, 255, 0.1) var(--volume-pct, 100%),
  );
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-teal);
  border: none;
  cursor: pointer;
}

.volume-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-teal);
  border: none;
  cursor: pointer;
}

.volume-slider::-moz-range-progress {
  background: var(--accent-teal);
  border-radius: 2px;
  height: 4px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .tts-player {
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 16px;
  }

  .tts-info {
    min-width: unset;
    max-width: unset;
    flex: 1;
  }

  .tts-progress {
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
