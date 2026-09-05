<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { authStore } from '@/lib/auth';
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
  <div class="min-h-screen bg-background text-foreground flex flex-col">
    <!-- Top Navigation Header -->
    <header class="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-30 shadow-xs">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        <!-- Brand & Organization Identity (slim) -->
        <div class="flex items-center gap-2 min-w-0">
          <Avatar class="h-8 w-8 rounded-lg border border-border shadow-xs shrink-0">
            <AvatarImage
              v-if="authStore.state.organization?.logoSrc"
              :src="authStore.state.organization.logoSrc"
              :alt="authStore.state.organization?.name || 'Org Logo'"
              class="object-contain p-0.5"
            />
            <AvatarFallback class="rounded-lg bg-primary text-primary-foreground font-bold text-xs">
              {{ authStore.state.organization?.name?.charAt(0) || 'D' }}
            </AvatarFallback>
          </Avatar>
          <span class="font-bold text-foreground tracking-tight text-sm truncate max-w-[140px] sm:max-w-[200px]">
            {{ authStore.state.organization?.name || 'DealFlow360' }}
          </span>
        </div>

        <!-- Primary Navigation (md+) — labels collapse to icons below xl -->
        <nav class="hidden md:flex items-center gap-0.5 flex-1 justify-center min-w-0">
          <router-link to="/" :class="[navLinkClass, isActive('/') ? navLinkActiveClass : '']">
            <LayoutDashboard class="w-4 h-4 shrink-0" />
            <span class="hidden xl:inline">Dashboard</span>
          </router-link>

          <router-link to="/catalog" :class="[navLinkClass, isActive('/catalog') ? navLinkActiveClass : '']">
            <Package class="w-4 h-4 shrink-0" />
            <span class="hidden xl:inline">Catalog</span>
          </router-link>

          <router-link to="/quotations" :class="[navLinkClass, isActive('/quotations') ? navLinkActiveClass : '']">
            <FileText class="w-4 h-4 shrink-0" />
            <span class="hidden xl:inline">Quotations</span>
          </router-link>

          <router-link
            v-if="canApprove"
            to="/approvals"
            :class="[navLinkClass, isActive('/approvals') ? navLinkActiveClass : '']"
          >
            <ShieldCheck class="w-4 h-4 shrink-0" />
            <span class="hidden xl:inline">Approvals</span>
          </router-link>

          <!-- Org Admin: configuration grouped behind one trigger -->
          <DropdownMenu v-if="isOrgAdmin">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                class="h-8 px-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md gap-1.5"
                :class="['/rulebook', '/team', '/settings/organization'].some((p) => isActive(p)) ? '!bg-muted !text-foreground font-semibold' : ''"
              >
                <SlidersHorizontal class="w-4 h-4" />
                <span class="hidden xl:inline">Administration</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-52">
              <DropdownMenuLabel>Organization Setup</DropdownMenuLabel>
              <DropdownMenuItem @click="router.push('/rulebook')">
                <Percent class="mr-2 h-4 w-4" />
                <span>Discount Rulebook</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="router.push('/team')">
                <Users class="mr-2 h-4 w-4" />
                <span>Team & Roles</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="router.push('/settings/organization')">
                <Settings class="mr-2 h-4 w-4" />
                <span>Org Settings</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        <!-- Right Side: user menu + mobile nav -->
        <div class="flex items-center gap-1.5 shrink-0">
          <!-- Mobile navigation (below md) -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon" class="md:hidden h-9 w-9">
                <Menu class="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuLabel>Navigation</DropdownMenuLabel>
              <DropdownMenuItem @click="router.push('/')">
                <LayoutDashboard class="mr-2 h-4 w-4" />
                <span>Dashboard</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="router.push('/catalog')">
                <Package class="mr-2 h-4 w-4" />
                <span>Catalog</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="router.push('/quotations')">
                <FileText class="mr-2 h-4 w-4" />
                <span>Quotations</span>
              </DropdownMenuItem>
              <DropdownMenuItem v-if="canApprove" @click="router.push('/approvals')">
                <ShieldCheck class="mr-2 h-4 w-4" />
                <span>Approvals</span>
              </DropdownMenuItem>
              <template v-if="isOrgAdmin">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Organization Setup</DropdownMenuLabel>
                <DropdownMenuItem @click="router.push('/rulebook')">
                  <Percent class="mr-2 h-4 w-4" />
                  <span>Discount Rulebook</span>
                </DropdownMenuItem>
                <DropdownMenuItem @click="router.push('/team')">
                  <Users class="mr-2 h-4 w-4" />
                  <span>Team & Roles</span>
                </DropdownMenuItem>
                <DropdownMenuItem @click="router.push('/settings/organization')">
                  <Settings class="mr-2 h-4 w-4" />
                  <span>Org Settings</span>
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" class="flex items-center gap-2 pl-2 pr-3 py-1.5 h-auto rounded-lg">
                <Avatar class="h-8 w-8">
                  <AvatarFallback class="bg-secondary text-secondary-foreground font-semibold text-xs">
                    {{ authStore.state.user?.name?.charAt(0) || authStore.state.user?.email?.charAt(0) || 'U' }}
                  </AvatarFallback>
                </Avatar>
                <div class="text-left hidden sm:block">
                  <p class="text-xs font-medium text-foreground leading-none">
                    {{ authStore.state.user?.name || authStore.state.user?.email || 'User' }}
                  </p>
                  <p class="text-2xs text-muted-foreground mt-0.5">
                    {{ getRoleDisplay(authStore.state.user?.role) }}
                  </p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-60">
              <DropdownMenuLabel class="font-normal">
                <div class="flex flex-col space-y-1">
                  <p class="text-sm font-medium leading-none">{{ authStore.state.user?.name || 'User' }}</p>
                  <p class="text-xs leading-none text-muted-foreground">{{ authStore.state.user?.email }}</p>
                  <Badge variant="secondary" class="w-fit text-2xs mt-1">
                    {{ getRoleDisplay(authStore.state.user?.role) }}
                  </Badge>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <!-- Organization context (moved out of the header to keep it slim) -->
              <DropdownMenuLabel class="font-normal">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium text-foreground flex items-center gap-1.5 truncate">
                    <Building2 class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span class="truncate">{{ authStore.state.organization?.name || 'No organization' }}</span>
                  </span>
                  <Badge
                    v-if="authStore.state.organization?.status === 'suspended'"
                    variant="destructive"
                    class="text-2xs px-1.5 py-0"
                  >
                    Suspended
                  </Badge>
                  <Badge
                    v-else-if="authStore.state.organization"
                    variant="outline"
                    class="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-2xs px-1.5 py-0"
                  >
                    Active
                  </Badge>
                </div>
                <p class="text-2xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Globe class="w-3 h-3" />
                  {{ authStore.state.organization?.currency || 'USD' }} · {{ authStore.state.organization?.timezone || 'UTC' }}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem v-if="isOrgAdmin" @click="router.push('/settings/organization')">
                <Settings class="mr-2 h-4 w-4" />
                <span>Organization Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="handleLogout">
                <LogOut class="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>

    <!-- Main View Content -->
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <slot />
    </main>
  </div>
</template>
