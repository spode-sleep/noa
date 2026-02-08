import { ref, computed } from 'vue'

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  tracks?: Track[]
}

// Singleton state – lives as long as the app is mounted
const currentTrack = ref<Track | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)

let audio: HTMLAudioElement | null = null
let flatList: Track[] = []

const progressPercent = computed(() => {
  if (!duration.value) return 0
  return (currentTime.value / duration.value) * 100
})

function initAudio() {
  if (audio) return
  audio = new Audio()
  audio.volume = volume.value
  audio.addEventListener('timeupdate', () => {
    currentTime.value = audio!.currentTime
  })
  audio.addEventListener('loadedmetadata', () => {
    duration.value = audio!.duration
  })
  audio.addEventListener('ended', () => {
    nextTrack()
  })
  audio.addEventListener('play', () => {
    isPlaying.value = true
  })
  audio.addEventListener('pause', () => {
    isPlaying.value = false
  })
}

function setFlatList(list: Track[]) {
  flatList = list
}

function playTrack(track: Track) {
  if (currentTrack.value?.id === track.id) {
    togglePlay()
    return
  }
  initAudio()
  currentTrack.value = track
  audio!.src = `/api/music/stream/${track.id}`
  audio!.play()
}

function togglePlay() {
  if (!audio) return
  if (audio.paused) {
    audio.play()
  } else {
    audio.pause()
  }
}

function prevTrack() {
  if (!currentTrack.value || flatList.length === 0) return
  const idx = flatList.findIndex(t => t.id === currentTrack.value!.id)
  const prev = idx > 0 ? flatList[idx - 1] : flatList[flatList.length - 1]
  playTrackForced(prev)
}

function nextTrack() {
  if (!currentTrack.value || flatList.length === 0) return
  const idx = flatList.findIndex(t => t.id === currentTrack.value!.id)
  const next = idx < flatList.length - 1 ? flatList[idx + 1] : flatList[0]
  playTrackForced(next)
}

function playTrackForced(track: Track) {
  initAudio()
  currentTrack.value = track
  audio!.src = `/api/music/stream/${track.id}`
  audio!.play()
}

function seek(e: MouseEvent) {
  if (!audio) return
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  audio.currentTime = ratio * audio.duration
}

function setVolume(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value)
  volume.value = val
  if (audio) audio.volume = val
}

function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function useMusicPlayer() {
  return {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    progressPercent,
    playTrack,
    togglePlay,
    prevTrack,
    nextTrack,
    seek,
    setVolume,
    setFlatList,
    formatDuration,
  }
}
