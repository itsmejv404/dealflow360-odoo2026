import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import ActivateView from '../views/ActivateView.vue';
import OnboardingView from '../views/OnboardingView.vue';
import DashboardView from '../views/DashboardView.vue';
import OrganizationSettingsView from '../views/OrganizationSettingsView.vue';
import TeamManagementView from '../views/TeamManagementView.vue';
import CatalogView from '../views/CatalogView.vue';
import RulebookView from '../views/RulebookView.vue';
import QuotationsView from '../views/QuotationsView.vue';
import QuotationBuilderView from '../views/QuotationBuilderView.vue';
import ApprovalsView from '../views/ApprovalsView.vue';
import SuperAdminLoginView from '../views/SuperAdminLoginView.vue';
import PlatformPortalView from '../views/PlatformPortalView.vue';
import WarehousesView from '../views/WarehousesView.vue';
import { authStore } from '../lib/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { isPublic: true },
    },
    {
      path: '/activate',
      name: 'activate',
      component: ActivateView,
      meta: { isPublic: true },
    },
    {
      path: '/superadmin/login',
      name: 'superadmin-login',
      component: SuperAdminLoginView,
      meta: { isPublic: true },
    },
    {
      path: '/platform/login',
      name: 'platform-login',
      component: SuperAdminLoginView,
      meta: { isPublic: true },
    },
    {
      path: '/platform',
      name: 'platform-portal',
      component: PlatformPortalView,
      meta: { requiresSuperAdmin: true },
    },
    {
      path: '/superadmin',
      redirect: '/platform',
    },
    {
      path: '/onboarding',
      name: 'onboarding',
      component: OnboardingView,
      meta: { requiresAdmin: true },
    },
    { path: '/', name: 'dashboard', component: DashboardView },
    {
      path: '/catalog',
      name: 'catalog',
      component: CatalogView,
    },
    {
      path: '/rulebook',
      name: 'rulebook',
      component: RulebookView,
      meta: { requiresAdmin: true },
    },
    {
      path: '/quotations',
      name: 'quotations',
      component: QuotationsView,
    },
    {
      path: '/approvals',
      name: 'approvals',
      component: ApprovalsView,
    },
    {
      path: '/quotations/:id',
      name: 'quotation-builder',
      component: QuotationBuilderView,
    },
    {
      path: '/team',
      name: 'team',
      component: TeamManagementView,
      meta: { requiresAdmin: true },
    },
    {
      path: '/settings/organization',
      name: 'organization-settings',
      component: OrganizationSettingsView,
      meta: { requiresAdmin: true },
    },
    {
      path: '/warehouses',
      name: 'warehouses',
      component: WarehousesView,
      meta: { requiresRoles: ['org_admin', 'ops'] },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      redirect: '/',
    },
  ],
});

router.beforeEach((to, _from, next) => {
  const publicNames = ['login', 'activate', 'superadmin-login', 'platform-login'];
  const publicPaths = ['/login', '/activate', '/superadmin/login', '/platform/login'];
  const cleanPath = to.path.replace(/\/$/, '') || '/';
  
  const isPublic =
    !!to.meta.isPublic ||
    publicNames.includes(to.name as string) ||
    publicPaths.includes(cleanPath);

  if (isPublic) {
    return next();
  }

  if (!authStore.isAuthenticated()) {
    if (to.meta.requiresSuperAdmin || cleanPath.startsWith('/platform') || cleanPath.startsWith('/superadmin')) {
      return next({ name: 'superadmin-login' });
    }
    return next({ name: 'login' });
  }

  if (to.meta.requiresSuperAdmin) {
    if (authStore.state.user?.role !== 'super_admin') {
      return next({ name: 'superadmin-login' });
    }
    return next();
  }

  if (authStore.state.user?.role === 'super_admin') {
    if (to.name !== 'platform-portal') {
      return next({ name: 'platform-portal' });
    }
    return next();
  }

  if (to.meta.requiresAdmin && authStore.state.user?.role !== 'org_admin') {
    return next({ name: 'dashboard' });
  }

  // Role-list gated routes (e.g. Warehouses & Inventory for org_admin + ops).
  const requiredRoles = to.meta.requiresRoles as string[] | undefined;
  if (requiredRoles && !requiredRoles.includes(authStore.state.user?.role || '')) {
    return next({ name: 'dashboard' });
  }

  return next();
});
