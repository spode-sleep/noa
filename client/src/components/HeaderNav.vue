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
  { to: '/main', label: 'Main' },
  { to: '/games', label: 'Games' },
  { to: '/music', label: 'Music' },
  { to: '/fiction', label: 'Fiction' },
  { to: '/reference', label: 'Reference' },
  { to: '/warez', label: 'Warez' },
  { to: '/ai', label: 'AI Librarian' },
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
  background: var(--askew-btn-disabled);
  border: none;
  border-bottom: 1px solid #000000;
  box-shadow: inset 0 1px 0 var(--askew-btn);
}

.nav-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  padding-bottom: 10px;
}

.nav-logo {
  font-family: 'AskewFont', 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif;
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
  color: var(--askew-gold);
}

.nav-links {
  display: flex;
  list-style: none;
  gap: 2px;
}

.nav-link {
  font-family: 'AskewFont', 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif;
  padding: 6px 14px;
  color: var(--text-primary);
  font-weight: 500;
  font-size: 0.92rem;
  display: inline-flex;
  justify-content: center;
  min-width: max-content;
  background: var(--askew-btn);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-btn-highlight), inset -1px -1px 0 var(--askew-btn-disabled);
  text-decoration: none;
}

.nav-link:hover {
  color: var(--text-primary);
  background: var(--askew-btn-hover);
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-mint), inset -1px -1px 0 var(--askew-btn);
}

.nav-link.active {
  background: var(--askew-gold);
  color: var(--bg-primary);
  font-weight: 700;
  border: 1px solid #000000;
  box-shadow: inset 1px 1px 0 var(--askew-gold-light), inset -1px -1px 0 var(--askew-tab-active);
}
</style>
