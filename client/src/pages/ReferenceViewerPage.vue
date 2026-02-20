<template>
  <div class="page">
    <div class="viewer-header">
      <a class="btn btn-back" @click="router.push('/reference')" style="cursor:pointer">← Reference</a>
      <h1>{{ displayName }}</h1>
      <button class="ctrl-btn" @click="readAloud" title="Read Aloud"><Icon icon="mdi:volume-high" width="20" height="20" style="color: var(--askew-gold); vertical-align: middle" /></button>
    </div>

    <div v-if="loading" class="loading">Checking kiwix-serve...</div>

    <div v-else-if="!kiwixUrl" class="empty-state glass">
      <div class="empty-icon">📚</div>
      <h2>Reference not available</h2>
      <p>kiwix-serve is not running or this archive is not loaded.</p>
    </div>

    <div v-else class="viewer-container">
      <iframe :src="kiwixUrl" class="zim-viewer"></iframe>
    </div>

    <div v-if="showTtsMessage" class="tts-modal glass" @click="showTtsMessage = false">
      <p>{{ ttsMessage }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { useTtsPlayer } from '../composables/useTtsPlayer'

const route = useRoute()
const router = useRouter()
const archiveId = computed(() => route.params.id as string)
const displayName = computed(() => archiveId.value.replace(/_/g, ' '))
const kiwixUrl = ref('')
const loading = ref(true)
const showTtsMessage = ref(false)
const ttsMessage = ref('')

const { speak, getSelectedText } = useTtsPlayer()

async function readAloud() {
  const text = await getSelectedText()
  if (text) {
    speak(text)
  } else {
    ttsMessage.value = 'Select text and copy (Ctrl+C), then press the speaker button'
    showTtsMessage.value = true
  }
}

onMounted(async () => {
  document.title = `${displayName.value} - BOX`
  try {
    const res = await fetch('/api/reference/status')
    const data = await res.json()
    if (data.kiwixUrl) {
      const base = data.kiwixUrl.replace(/\/+$/, '')
      kiwixUrl.value = `${base}/${archiveId.value}`
    }
  } catch (e) {
    console.error('Failed to check kiwix status:', e)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  document.title = 'BOX'
})
</script>

<style scoped>

.viewer-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.viewer-header h1 {
  flex: 1;
  font-size: 2rem;
  margin: 0;
  color: var(--askew-gold);
}

.ctrl-btn {
  background: var(--askew-btn);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  color: var(--text-primary);
  padding: 6px 12px;
  cursor: pointer;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.ctrl-btn:hover {
  background: var(--askew-btn-hover);
  border-color: var(--askew-dark-border);
  box-shadow: inset 1px 1px 0 var(--askew-cream), inset -1px -1px 0 var(--askew-btn);
  color: var(--bg-primary);
}

.btn-back {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  background: var(--askew-btn-disabled);
  border: 1px solid #000000;
  color: var(--text-secondary);
  font-size: 0.9rem;
  text-decoration: none;
  cursor: pointer;
  flex-shrink: 0;
  line-height: 1;
}

.btn-back:hover {
  background: var(--askew-btn);
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn);
  color: var(--text-primary);
}

.loading {
  text-align: center;
  color: var(--text-muted);
  padding: 48px 0;
  font-size: 1.1rem;
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
  max-width: 520px;
  margin: 48px auto;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 16px;
}

.empty-state h2 {
  font-size: 1.3rem;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.empty-state p {
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}

.viewer-container {
  height: calc(100vh - 180px);
}

.zim-viewer {
  width: 100%;
  height: 100%;
  border: 1px solid #000000;
  background: #fff;
}

.tts-modal {
  position: fixed;
  bottom: 80px;
  right: 24px;
  padding: 16px 24px;
  z-index: 200;
  cursor: pointer;
  max-width: 320px;
}

.tts-modal p {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin: 0;
}
</style>
