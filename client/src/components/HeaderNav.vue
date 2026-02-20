<template>
  <nav class="header-nav glass">
    <div class="nav-content container">
      <router-link to="/main" class="nav-logo"><Icon icon="mdi:package-variant-closed" class="nav-logo-icon" /> BOX</router-link>
      <ul class="nav-links">
        <li v-for="link in links" :key="link.to">
          <router-link
            :to="link.to"
            class="nav-link"
            :class="{ active: isActive(link.to) }"
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
  { to: '/main', label: 'Main', color: '#c072f4' },
  { to: '/games', label: 'Games', color: '#4cc9f0' },
  { to: '/music', label: 'Music', color: '#8b6cee' },
  { to: '/fiction', label: 'Fiction', color: '#7ec8e3' },
  { to: '/reference', label: 'Reference', color: '#34d399' },
  { to: '/warez', label: 'Warez', color: '#f59e0b' },
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
  background: var(--askew-tab-border);
  border: none;
  border-bottom: 1px solid #000000;
  box-shadow: inset 0 1px 0 var(--askew-tab-inactive);
}

.nav-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  padding-bottom: 10px;
}

.nav-logo {
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: var(--askew-gold);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
}

.nav-logo-icon {
  font-size: 1.4rem;
  color: var(--askew-salmon);
}

.nav-links {
  display: flex;
  list-style: none;
  gap: 2px;
}

.nav-link {
  padding: 6px 14px;
  color: var(--askew-cream);
  transition: all var(--transition-fast);
  font-weight: 500;
  font-size: 0.92rem;
  display: inline-flex;
  justify-content: center;
  min-width: max-content;
  border: 1px solid transparent;
  text-decoration: none;
}

.nav-link:hover {
  color: var(--text-primary);
  background: var(--askew-tab-inactive);
  border: 1px solid var(--askew-tab-border);
  box-shadow: inset 1px 1px 0 var(--askew-salmon), inset -1px -1px 0 var(--askew-tab-border);
}

.nav-link.active {
  background: var(--askew-tab-active);
  color: var(--bg-primary);
  font-weight: 700;
  border: 1px solid var(--askew-tab-border);
  box-shadow: inset 1px 1px 0 var(--askew-gold), inset -1px -1px 0 var(--askew-tab-inactive);
}
</style>
