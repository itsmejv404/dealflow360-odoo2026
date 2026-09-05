<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { authStore } from '@/lib/auth';
import brandLogo from '@/assets/dataflow-logo.png';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Building2,
  Settings,
  LogOut,
  LayoutDashboard,
  Globe,
  Users,
  User,
  Package,
  ShieldCheck,
  Percent,
  FileText,
  Menu,
  SlidersHorizontal,
} from 'lucide-vue-next';

const router = useRouter();
const route = useRoute();

const isOrgAdmin = computed(() => authStore.state.user?.role === 'org_admin');
const canApprove = computed(() =>
  ['manager', 'finance', 'org_admin'].includes(authStore.state.user?.role || '')
);

onMounted(async () => {
  if (authStore.isAuthenticated()) {
    await authStore.fetchProfile();
  }
});

function handleLogout() {
  authStore.logout();
  router.push('/login');
}

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/';
  return route.path === path || route.path.startsWith(`${path}/`);
}

const navLinkClass =
  'px-2.5 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5 whitespace-nowrap';
const navLinkActiveClass = '!bg-muted !text-foreground font-semibold';

function getRoleDisplay(role?: string): string {
  switch (role) {
    case 'org_admin':
      return 'Org Admin';
    case 'rep':
      return 'Sales Rep';
    case 'manager':
      return 'Sales Manager';
    case 'finance':
      return 'Finance Approver';
    case 'ops':
      return 'Operations / Ops';
    default:
      return role || 'Internal User';
  }
}
</script>

<template>
  
          <h1>Hi</h1>
</template>
