<template>
  <div v-if="isActive && !isMinimized" class="player glass">
    <div class="player-info">
      <span class="player-title"><Icon icon="mdi:microphone" style="color: var(--askew-gold); vertical-align: middle" /> TTS</span>
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
  background: var(--askew-btn-disabled);
  border-top: 1px solid #000000;
  box-shadow: inset 0 1px 0 var(--askew-btn);
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

.ctrl-btn:disabled {
  background: var(--askew-btn);
  box-shadow: none;
  opacity: 0.5;
  cursor: not-allowed;
}

.ctrl-play {
  width: 36px;
  height: 36px;
  font-size: 1.3rem;
}

.ctrl-play:hover:not(:disabled) {
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
  position: relative;
}

.progress-fill::after {
  content: '';
  position: absolute;
  right: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  background: var(--askew-gold);
  border: 1px solid #000000;
}

.tts-speed {
  display: flex;
  gap: 4px;
}

.speed-btn {
  background: var(--askew-btn-disabled);
  border: 1px solid #000000;
  color: var(--askew-cream);
  padding: 2px 8px;
  font-size: 0.7rem;
  cursor: pointer;
}

.speed-btn:hover {
  background: var(--askew-btn);
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  color: var(--text-primary);
}

.speed-btn.active {
  background: var(--askew-tab-active);
  border-color: var(--askew-tab-border);
  box-shadow: inset 1px 1px 0 var(--askew-gold), inset -1px -1px 0 var(--askew-tab-inactive);
  color: var(--bg-primary);
}

.tts-error {
  font-size: 0.75rem;
  color: var(--askew-red);
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
  background: var(--askew-gold);
  border: 1px solid #000000;
  cursor: pointer;
}

.volume-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--askew-gold);
  border: 1px solid #000000;
  cursor: pointer;
}

.volume-slider::-moz-range-progress {
  background: var(--askew-gold);
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
