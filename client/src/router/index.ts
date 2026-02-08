import { createRouter, createWebHistory } from 'vue-router'
import GamesPage from '../pages/GamesPage.vue'
import MusicPage from '../pages/MusicPage.vue'
import FictionPage from '../pages/FictionPage.vue'
import ReferencePage from '../pages/ReferencePage.vue'
import AiPage from '../pages/AiPage.vue'

const routes = [
  { path: '/', redirect: '/games' },
  { path: '/games', name: 'Games', component: GamesPage },
  { path: '/games/:id', name: 'GameDetail', component: () => import('../pages/GameDetailPage.vue') },
  { path: '/music', name: 'Music', component: MusicPage },
  { path: '/fiction', name: 'Fiction', component: FictionPage },
  { path: '/reference', name: 'Reference', component: ReferencePage },
  { path: '/ai', name: 'AI', component: AiPage },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
