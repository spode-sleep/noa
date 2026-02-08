<template>
  <nav class="header-nav glass">
    <div class="nav-content container">
      <span class="nav-logo"><Icon icon="mdi:package-variant-closed" class="nav-logo-icon" /> BOX</span>
      <ul class="nav-links">
        <li v-for="link in links" :key="link.to">
          <router-link
            :to="link.to"
            class="nav-link"
            :class="{ active: isActive(link.to) }"
            :style="isActive(link.to) ? { color: link.color, background: link.color + '14', boxShadow: '0 0 16px ' + link.color + '14' } : {}"
          >
            {{ link.label }}
          </router-link>
        </li>
      </ul>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'

const route = useRoute()

const links = [
  { to: '/games', label: 'Games', color: '#4cc9f0' },
  { to: '/music', label: 'Music', color: '#8b6cee' },
  { to: '/fiction', label: 'Fiction', color: '#7ec8e3' },
  { to: '/reference', label: 'Reference', color: '#34d399' },
  { to: '/ai', label: 'AI Librarian', color: '#a855f7' },
]

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<style scoped>
.header-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  border-radius: 0;
  border-top: none;
  border-left: none;
  border-right: none;
  background: rgba(7, 11, 26, 0.75);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.nav-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  padding-bottom: 14px;
}

.nav-logo {
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple), var(--accent-blue));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 12px rgba(0, 232, 184, 0.3));
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.nav-logo-icon {
  font-size: 1.4rem;
  -webkit-text-fill-color: var(--accent-teal);
  filter: drop-shadow(0 0 6px rgba(0, 232, 184, 0.5));
}

.nav-links {
  display: flex;
  list-style: none;
  gap: 4px;
}

.nav-link {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  font-weight: 500;
  font-size: 0.92rem;
  display: inline-flex;
  justify-content: center;
  min-width: max-content;
}

.nav-link:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
  text-shadow: 0 0 10px rgba(0, 232, 184, 0.15);
}

.nav-link.active {
  /* Use text-shadow to simulate bold instead of font-weight to avoid layout shift */
  text-shadow: 0 0 0.5px currentColor, 0 0 0.5px currentColor;
}
</style>
