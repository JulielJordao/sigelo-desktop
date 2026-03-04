import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';

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
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

// 2. Guarda de Navegação (Segurança)
router.beforeEach((to, from, next) => {
  const isAuthenticated = !!localStorage.getItem('userToken');
  const hideOnboarding = localStorage.getItem('hideOnboarding') === 'true';

  // Se a rota exige autenticação e o usuário não está logado
  if (to.meta.requiresAuth && !isAuthenticated) {
    next({ name: 'Login' });
  } 
  // Se o usuário logou agora e vai para a lista, mas não viu o onboarding
  else if (to.path === '/app/musicas' && !hideOnboarding && from.name === 'Login') {
    next({ name: 'Onboarding' });
  }
  else {
    next();
  }
});

export default router;