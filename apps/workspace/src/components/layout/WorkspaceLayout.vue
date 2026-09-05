<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
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
  FileText,
} from 'lucide-vue-next';

const router = useRouter();

onMounted(async () => {
  if (authStore.isAuthenticated()) {
    await authStore.fetchProfile();
  }
});

function handleLogout() {
  authStore.logout();
  router.push('/login');
}

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
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <!-- Brand & Organization Identity -->
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-3">
            <Avatar class="h-10 w-10 rounded-lg border border-border shadow-xs">
              <AvatarImage
                v-if="authStore.state.organization?.logoUrl"
                :src="authStore.state.organization.logoUrl"
                :alt="authStore.state.organization?.name || 'Org Logo'"
                class="object-contain p-1"
              />
              <AvatarFallback class="rounded-lg bg-primary text-primary-foreground font-bold">
                {{ authStore.state.organization?.name?.charAt(0) || 'D' }}
              </AvatarFallback>
            </Avatar>

            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-foreground tracking-tight text-base">
                  {{ authStore.state.organization?.name || 'DealFlow360' }}
                </span>
                <Badge
                  v-if="authStore.state.organization?.status === 'active'"
                  variant="outline"
                  class="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-xs px-2 py-0"
                >
                  Active
                </Badge>
                <Badge
                  v-else-if="authStore.state.organization?.status === 'suspended'"
                  variant="destructive"
                  class="text-xs px-2 py-0"
                >
                  Suspended
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground flex items-center gap-1">
                <Globe class="w-3 h-3" />
                {{ authStore.state.organization?.currency || 'USD' }} · {{ authStore.state.organization?.timezone || 'UTC' }}
              </p>
            </div>
          </div>

          <!-- Navigation Links -->
          <nav class="hidden md:flex items-center gap-1 border-l border-border pl-6">
            <router-link
              to="/"
              class="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              active-class="!bg-muted !text-foreground font-semibold"
            >
              <LayoutDashboard class="w-4 h-4" />
              Workspace Home
            </router-link>

            <router-link
              to="/catalog"
              class="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              active-class="!bg-muted !text-foreground font-semibold"
            >
              <Package class="w-4 h-4" />
              Catalog & Pricing
            </router-link>

            <router-link
              to="/quotations"
              class="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              active-class="!bg-muted !text-foreground font-semibold"
            >
              <FileText class="w-4 h-4" />
              Quotations
            </router-link>

            <!-- Org Admin Only Navigation -->
            <router-link
              v-if="authStore.state.user?.role === 'org_admin'"
              to="/rulebook"
              class="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              active-class="!bg-muted !text-foreground font-semibold"
            >
              <ShieldCheck class="w-4 h-4" />
              Discount & Approvals
            </router-link>

            <router-link
              v-if="authStore.state.user?.role === 'org_admin'"
              to="/team"
              class="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              active-class="!bg-muted !text-foreground font-semibold"
            >
              <Users class="w-4 h-4" />
              Team & Roles
            </router-link>

            <router-link
              v-if="authStore.state.user?.role === 'org_admin'"
              to="/settings/organization"
              class="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              active-class="!bg-muted !text-foreground font-semibold"
            >
              <Settings class="w-4 h-4" />
              Org Settings
            </router-link>
          </nav>
        </div>

        <!-- Right Side: User Menu & Profile -->
        <div class="flex items-center gap-3">
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
            <DropdownMenuContent align="end" class="w-56">
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
              <DropdownMenuItem @click="router.push('/settings/organization')">
                <Settings class="mr-2 h-4 w-4" />
                <span>Organization Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
