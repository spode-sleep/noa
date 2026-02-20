import { ref } from 'vue'

const isMinimized = ref(false)

export function usePlayerStack() {
  function toggleMinimize() {
    isMinimized.value = !isMinimized.value
  }

  return {
    isMinimized,
    toggleMinimize,
  }
}
