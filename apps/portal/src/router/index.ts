import { createRouter, createWebHistory } from 'vue-router';
import PortalQuotationView from '@/views/PortalQuotationView.vue';
import PortalAccessView from '@/views/PortalAccessView.vue';

const router = createRouter({
  history: createWebHistory('/portal/'),
  routes: [
    {
      path: '/',
      name: 'home',
      redirect: '/quotation',
    },
    {
      path: '/access',
      name: 'access',
      component: PortalAccessView,
    },
    {
      path: '/quotation',
      name: 'quotation',
      component: PortalQuotationView,
    },
    {
      path: '/quotation/:id',
      name: 'quotation-detail',
      component: PortalQuotationView,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/quotation',
    },
  ],
});

export default router;
