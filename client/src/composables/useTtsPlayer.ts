import { ref, computed } from 'vue'

// Singleton state – lives as long as the app is mounted
const isActive = ref(false)
const isPlaying = ref(false)
const isLoading = ref(false)
const currentText = ref('')
const currentTime = ref(0)
const duration = ref(0)
const speed = ref(1)
const errorMessage = ref('')

let audio: HTMLAudioElement | null = null
let timeUpdateTimer: ReturnType<typeof setInterval> | null = null

const progressPercent = computed(() => {
  if (!duration.value) return 0
  return (currentTime.value / duration.value) * 100
})

const displayText = computed(() => {
  const text = currentText.value
  if (text.length > 80) return text.substring(0, 80) + '…'
  return text
})

function initAudio() {
  if (audio) return
  audio = new Audio()
  audio.addEventListener('loadedmetadata', () => {
    duration.value = audio!.duration
  })
  audio.addEventListener('ended', () => {
    isPlaying.value = false
    currentTime.value = duration.value
    if (timeUpdateTimer) clearInterval(timeUpdateTimer)
  })
  audio.addEventListener('play', () => {
    isPlaying.value = true
    startTimeUpdate()
  })
  audio.addEventListener('pause', () => {
    isPlaying.value = false
    if (timeUpdateTimer) clearInterval(timeUpdateTimer)
  })
}

function startTimeUpdate() {
  if (timeUpdateTimer) clearInterval(timeUpdateTimer)
  timeUpdateTimer = setInterval(() => {
    if (audio) currentTime.value = audio.currentTime
  }, 200)
}

async function speak(text: string) {
  if (!text.trim()) return

  errorMessage.value = ''
  isLoading.value = true
  isActive.value = true
  currentText.value = text.trim()
  currentTime.value = 0
  duration.value = 0

  try {
    const res = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: currentText.value }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'TTS request failed' }))
      errorMessage.value = err.error || 'TTS request failed'
      isLoading.value = false
      return
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)

    initAudio()
    // Stop any previous playback
    const oldSrc = audio!.src
    audio!.pause()
    audio!.src = url
    if (oldSrc) URL.revokeObjectURL(oldSrc)
    audio!.playbackRate = speed.value
    await audio!.play()
  } catch {
    errorMessage.value = 'Failed to connect to TTS service'
  } finally {
    isLoading.value = false
  }
}

function togglePlay() {
  if (!audio) return
  if (audio.paused) {
    audio.play()
  } else {
    audio.pause()
  }
}

function stop() {
  if (audio) {
    audio.pause()
    audio.currentTime = 0
    if (audio.src) URL.revokeObjectURL(audio.src)
    audio.src = ''
  }
  isActive.value = false
  isPlaying.value = false
  currentTime.value = 0
  duration.value = 0
  currentText.value = ''
  errorMessage.value = ''
  if (timeUpdateTimer) clearInterval(timeUpdateTimer)
}

function seek(e: MouseEvent) {
  if (!audio || !duration.value) return
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  audio.currentTime = ratio * audio.duration
  currentTime.value = audio.currentTime
}

function setSpeed(newSpeed: number) {
  speed.value = newSpeed
  if (audio) audio.playbackRate = newSpeed
}

function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Get selected text from page, trying EPUB shadow DOM, iframes, and clipboard */
async function getSelectedText(epubView?: any): Promise<string> {
  // First check main document selection (works for FB2, plain HTML)
  const mainSelection = window.getSelection()?.toString()?.trim()
  if (mainSelection) return mainSelection

  // Try EPUB foliate-view internal documents (closed shadow DOM)
  if (epubView?.renderer?.getContents) {
    try {
      for (const { doc } of epubView.renderer.getContents()) {
        const sel = doc?.defaultView?.getSelection?.()?.toString()?.trim()
        if (sel) return sel
      }
    } catch { /* ignore */ }
  }

  // Try same-origin iframes (works for ZIM via kiwix proxy)
  const iframes = document.querySelectorAll('iframe')
  for (const iframe of iframes) {
    try {
      const iframeSelection = iframe.contentWindow?.getSelection()?.toString()?.trim()
      if (iframeSelection) return iframeSelection
    } catch {
      // Cross-origin iframe — skip
    }
  }

  // Fallback: try clipboard (for PDF where browser viewer doesn't expose selection)
  try {
    const clipText = await navigator.clipboard.readText()
    if (clipText?.trim()) return clipText.trim()
  } catch { /* clipboard permission denied or empty */ }

  return ''
}

export function useTtsPlayer() {
  return {
    isActive,
    isPlaying,
    isLoading,
    currentText,
    displayText,
    currentTime,
    duration,
    speed,
    errorMessage,
    progressPercent,
    speak,
    togglePlay,
    stop,
    seek,
    setSpeed,
    formatDuration,
    getSelectedText,
  }
}
