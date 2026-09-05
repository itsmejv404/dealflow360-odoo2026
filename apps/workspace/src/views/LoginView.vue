<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { authStore, type User, type OrganizationProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LogIn, AlertCircle, Sparkles, Building2 } from 'lucide-vue-next';

interface LoginResult {
  token: string;
  user: User;
  organization: OrganizationProfile;
}

const router = useRouter();
const form = reactive({ email: 'admin@acme.com', password: 'Password123!' });
const errorMessage = ref<string | null>(null);
const isLoading = ref(false);

const demoAccounts = [
  { label: 'Acme Admin', email: 'admin@acme.com', role: 'org_admin', org: 'Acme Corp' },
  { label: 'Acme Rep', email: 'rep@acme.com', role: 'rep', org: 'Acme Corp' },
  { label: 'Acme Manager', email: 'manager@acme.com', role: 'manager', org: 'Acme Corp' },
  { label: 'Acme Finance', email: 'finance@acme.com', role: 'finance', org: 'Acme Corp' },
  { label: 'Acme Ops', email: 'ops@acme.com', role: 'ops', org: 'Acme Corp' },
  { label: 'Globex Admin', email: 'admin@globex.com', role: 'org_admin', org: 'Globex Corp' },
  { label: 'Globex Rep', email: 'rep@globex.com', role: 'rep', org: 'Globex Corp' },
];

function selectDemoAccount(account: typeof demoAccounts[0]) {
  form.email = account.email;
  form.password = 'Password123!';
  errorMessage.value = null;
}

async function onSubmit(): Promise<void> {
  errorMessage.value = null;
  isLoading.value = true;
  try {
    const res = await apiRequest<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(form),
    });

    authStore.setAuth(res.token, res.user, res.organization);

    if (!res.organization.onboardingCompleted) {
      router.push('/onboarding');
    } else {
      router.push('/');
    }
  } catch (err: any) {
    errorMessage.value = err.message || 'Login failed. Please check your credentials.';
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-muted/40 p-6">
    <div class="w-full max-w-md space-y-4">
      <Card class="border-border shadow-md">
        <CardHeader class="items-center text-center pb-4">
          <div
            class="mb-2 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground text-lg font-bold shadow-xs"
          >
            DF
          </div>
          <CardTitle class="text-2xl font-bold tracking-tight">DealFlow360</CardTitle>
          <CardDescription>Tenant-Scoped Workspace Authentication</CardDescription>
        </CardHeader>

        <CardContent class="space-y-4">
          <!-- Error Alert -->
          <Alert v-if="errorMessage" variant="destructive" class="py-2.5">
            <AlertCircle class="h-4 w-4" />
            <AlertDescription class="text-xs">{{ errorMessage }}</AlertDescription>
          </Alert>

          <form class="grid gap-4" @submit.prevent="onSubmit">
            <div class="grid gap-2">
              <Label for="email">Organization Email</Label>
              <Input
                id="email"
                v-model="form.email"
                type="email"
                required
                placeholder="you@your-org.com"
                autocomplete="username"
              />
            </div>
            <div class="grid gap-2">
              <Label for="password">Password</Label>
              <Input
                id="password"
                v-model="form.password"
                type="password"
                required
                placeholder="••••••••"
                autocomplete="current-password"
              />
            </div>
            <Button type="submit" :disabled="isLoading" class="w-full">
              <LogIn class="w-4 h-4 mr-2" />
              {{ isLoading ? 'Authenticating...' : 'Sign in to Workspace' }}
            </Button>
          </form>
        </CardContent>

        <CardFooter class="flex-col gap-3 pt-4 border-t border-border bg-muted/30 rounded-b-xl">
          <div class="flex items-center justify-between w-full">
            <span class="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Sparkles class="w-3.5 h-3.5 text-primary" />
              Quick Demo Personas:
            </span>
            <span class="text-2xs text-muted-foreground">Password: Password123!</span>
          </div>

          <div class="grid grid-cols-2 gap-1.5 w-full">
            <Button
              v-for="acc in demoAccounts"
              :key="acc.email"
              type="button"
              variant="outline"
              size="sm"
              class="text-xs justify-between h-8 bg-card hover:bg-accent"
              :class="{ 'border-primary ring-1 ring-primary bg-accent': form.email === acc.email }"
              @click="selectDemoAccount(acc)"
            >
              <span class="font-medium truncate">{{ acc.label }}</span>
              <Badge variant="secondary" class="text-2xs px-1 py-0 uppercase">
                {{ acc.role === 'org_admin' ? 'Admin' : acc.role }}
              </Badge>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  </main>
</template>
