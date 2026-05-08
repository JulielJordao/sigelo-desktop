import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { useUserStore } from 'stores/userStore';

// 1. Definição das rotas
const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/onboarding',
    name: 'Onboarding',
    component: () => import('../views/OnboardingView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/app',
    component: () => import('../layouts/MainLayout.vue'), // Layout com a sidebar e Bíblia
    meta: { requiresAuth: true },
    children: [
      {
        path: 'musicas',
        name: 'MusicList',
        component: () => import('../views/MusicListView.vue')
      },
      // Aqui você adicionará outras telas como 'slides', 'configuracoes', etc.
    ]
  },
  {
    path: '/projection', component: () => import('../views/ProjectionView.vue')
  },
  {
    path: '/transmission', component: () => import('../premium-modules/transmission/TransmissionWindow.vue')
  },
  {
    path: '/stage-monitor', component: () => import('../premium-modules/stage-monitor/StageMonitor.vue')
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

// 2. Guarda de Navegação (Segurança)
router.beforeEach((to, from, next) => {
  const hideOnboarding = localStorage.getItem('hideOnboarding') === 'true'

  if (to.path === '/app/musicas' && !hideOnboarding && from.name === 'Login') {
    return next({ name: 'Onboarding' })
  }

  next()
})

export default router;