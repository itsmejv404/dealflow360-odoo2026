<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout.vue';
import { authStore } from '@/lib/auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Settings,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Layers,
  Coins,
  Clock,
  Users,
  FileText,
} from 'lucide-vue-next';

const router = useRouter();

onMounted(async () => {
  if (!authStore.isAuthenticated()) {
    router.push('/login');
    return;
  }
  const org = await authStore.fetchProfile();
  // Only the Org Admin gets the onboarding wizard; other roles inherit the
  // organization's details and work straight away.
  if (org && !org.onboardingCompleted && authStore.state.user?.role === 'org_admin') {
    router.push('/onboarding');
  }
});
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-8">
      <!-- Welcome Hero Banner -->
      <div
        class="rounded-2xl p-6 sm:p-8 text-primary-foreground bg-primary shadow-md relative overflow-hidden"
      >
        <div class="relative z-10 max-w-2xl space-y-3">
          <div class="flex items-center gap-2">
            <Badge variant="secondary" class="bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground border-primary-foreground/20 backdrop-blur-xs flex items-center gap-1">
              <CheckCircle2 class="w-3.5 h-3.5 text-emerald-300" />
              <span>Workspace Active</span>
            </Badge>
            <Badge variant="outline" class="text-primary-foreground border-primary-foreground/20">
              Role: {{ authStore.state.user?.role?.toUpperCase() || 'ORG ADMIN' }}
            </Badge>
          </div>

          <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Welcome, {{ authStore.state.user?.name || authStore.state.user?.email || 'Admin' }}
          </h1>

          <p class="text-primary-foreground/90 text-sm sm:text-base leading-relaxed">
            Workspace for <strong class="text-primary-foreground font-semibold">{{ authStore.state.organization?.name || 'Your Organization' }}</strong>. 
            Operating in <strong class="text-primary-foreground">{{ authStore.state.organization?.currency || 'USD' }}</strong> ({{ authStore.state.organization?.timezone || 'UTC' }}).
          </p>

          <div class="pt-2 flex flex-wrap gap-3">
            <Button
              variant="secondary"
              class="font-semibold shadow-xs"
              @click="router.push('/quotations')"
            >
              <FileText class="w-4 h-4 mr-1.5" />
              Quotations & Deals
            </Button>
            <Button
              variant="outline"
              class="font-semibold shadow-xs bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 border-primary-foreground/20"
              @click="router.push('/catalog')"
            >
              <Layers class="w-4 h-4 mr-1.5" />
              Catalog
            </Button>
          </div>
        </div>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardDescription class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Operating Currency
              </CardDescription>
              <Coins class="w-4 h-4 text-primary" />
            </div>
            <CardTitle class="text-2xl font-bold text-foreground mt-1">
              {{ authStore.state.organization?.currency || 'USD' }}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-xs text-muted-foreground">Catalog and invoice pricing denomination</p>
          </CardContent>
        </Card>

        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardDescription class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Operating Timezone
              </CardDescription>
              <Clock class="w-4 h-4 text-primary" />
            </div>
            <CardTitle class="text-2xl font-bold text-foreground mt-1">
              {{ authStore.state.organization?.timezone || 'UTC' }}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-xs text-muted-foreground">Billing schedules & health evaluation timezone</p>
          </CardContent>
        </Card>

        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardDescription class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Data Isolation & Security
              </CardDescription>
              <ShieldCheck class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <CardTitle class="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-2">
              <span>Active</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-xs text-muted-foreground">Tenant-scoped PostgreSQL + Secure Storage</p>
          </CardContent>
        </Card>
      </div>

      <!-- Workspace Modules Overview -->
      <Card class="border-border bg-card shadow-xs">
        <CardHeader>
          <CardTitle class="text-lg font-semibold text-foreground">Workspace Modules</CardTitle>
          <CardDescription>Direct access to active operational features and organization tools.</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
              class="border border-border/70 rounded-xl p-5 hover:border-primary/50 transition-all cursor-pointer bg-card/50 flex flex-col justify-between space-y-4 group"
              @click="router.push('/quotations')"
            >
              <div class="space-y-2">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                  <FileText class="w-5 h-5" />
                </div>
                <h3 class="font-semibold text-base text-foreground group-hover:text-primary transition-colors">Quotation Builder</h3>
                <p class="text-xs text-muted-foreground leading-relaxed">
                  Build quotes, manage mixed line items, configure discounts, and review margins in real time.
                </p>
              </div>
              <div class="flex items-center text-xs font-medium text-primary">
                <span>Open Quotations</span>
                <ArrowRight class="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            <div
              class="border border-border/70 rounded-xl p-5 hover:border-primary/50 transition-all cursor-pointer bg-card/50 flex flex-col justify-between space-y-4 group"
              @click="router.push('/catalog')"
            >
              <div class="space-y-2">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                  <Layers class="w-5 h-5" />
                </div>
                <h3 class="font-semibold text-base text-foreground group-hover:text-primary transition-colors">Catalog & Price Lists</h3>
                <p class="text-xs text-muted-foreground leading-relaxed">
                  Manage products, services, recurring subscriptions, and customer-specific price tier rules.
                </p>
              </div>
              <div class="flex items-center text-xs font-medium text-primary">
                <span>Open Catalog</span>
                <ArrowRight class="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            <div
              v-if="authStore.state.user?.role === 'org_admin'"
              class="border border-border/70 rounded-xl p-5 hover:border-primary/50 transition-all cursor-pointer bg-card/50 flex flex-col justify-between space-y-4 group"
              @click="router.push('/team')"
            >
              <div class="space-y-2">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                  <Users class="w-5 h-5" />
                </div>
                <h3 class="font-semibold text-base text-foreground group-hover:text-primary transition-colors">Team & Access Control</h3>
                <p class="text-xs text-muted-foreground leading-relaxed">
                  Invite sales reps, managers, finance officers, and manage tenant role assignments.
                </p>
              </div>
              <div class="flex items-center text-xs font-medium text-primary">
                <span>Manage Team</span>
                <ArrowRight class="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            <div
              v-if="authStore.state.user?.role === 'org_admin'"
              class="border border-border/70 rounded-xl p-5 hover:border-primary/50 transition-all cursor-pointer bg-card/50 flex flex-col justify-between space-y-4 group"
              @click="router.push('/settings/organization')"
            >
              <div class="space-y-2">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                  <Settings class="w-5 h-5" />
                </div>
                <h3 class="font-semibold text-base text-foreground group-hover:text-primary transition-colors">Organization Settings</h3>
                <p class="text-xs text-muted-foreground leading-relaxed">
                  Configure company branding, logo, legal address, currency, and timezone preferences.
                </p>
              </div>
              <div class="flex items-center text-xs font-medium text-primary">
                <span>Settings</span>
                <ArrowRight class="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </WorkspaceLayout>
</template>
