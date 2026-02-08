<template>
  <nav class="header-nav glass">
    <div class="nav-content container">
      <span class="nav-logo">Noa</span>
      <ul class="nav-links">
        <li v-for="link in links" :key="link.to">
          <router-link :to="link.to" class="nav-link">
            {{ link.label }}
          </router-link>
        </li>
      </ul>
    </div>
  </nav>
</template>

<script setup lang="ts">
const links = [
  { to: '/games', label: 'Игры' },
  { to: '/music', label: 'Музыка' },
  { to: '/fiction', label: 'Художественная литература' },
  { to: '/reference', label: 'Справочная литература' },
  { to: '/ai', label: 'ИИ помощник' },
]
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
}

.nav-link:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
  text-shadow: 0 0 10px rgba(0, 232, 184, 0.15);
}

.nav-link.router-link-active {
  color: var(--accent-teal);
  background: rgba(0, 232, 184, 0.08);
  box-shadow: 0 0 16px rgba(0, 232, 184, 0.08);
}
</style>
