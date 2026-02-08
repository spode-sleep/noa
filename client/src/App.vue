<template>
  <div id="app">
    <HeaderNav />
    <main class="container">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import HeaderNav from './components/HeaderNav.vue'
</script>

<style scoped>
main {
  padding-top: 24px;
  padding-bottom: 48px;
}
</style>
