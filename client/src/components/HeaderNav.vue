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
  { to: '/games', label: 'Games' },
  { to: '/music', label: 'Music' },
  { to: '/fiction', label: 'Fiction' },
  { to: '/reference', label: 'Reference' },
  { to: '/ai', label: 'AI' },
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
}

.nav-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  padding-bottom: 16px;
}

.nav-logo {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent-teal), var(--accent-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.nav-links {
  display: flex;
  list-style: none;
  gap: 8px;
}

.nav-link {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  font-weight: 500;
}

.nav-link:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.nav-link.router-link-active {
  color: var(--accent-teal);
  background: rgba(0, 212, 170, 0.1);
}
</style>
