<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { authStore, type User } from '@/lib/auth';
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
import { ShieldAlert, AlertCircle, KeyRound, Lock, Sparkles } from 'lucide-vue-next';

interface SuperAdminLoginResult {
  token: string;
  user: User;
}

const router = useRouter();
const form = reactive({
  email: 'superadmin@dealflow360.com',
  password: 'SuperAdminSecret123!',
});
const errorMessage = ref<string | null>(null);
const isLoading = ref(false);

function autofill() {
  form.email = 'superadmin@dealflow360.com';
  form.password = 'SuperAdminSecret123!';
  errorMessage.value = null;
}

async function onSubmit(): Promise<void> {
  errorMessage.value = null;
  isLoading.value = true;
  try {
    const res = await apiRequest<SuperAdminLoginResult>('/api/platform/auth/login', {
      method: 'POST',
      body: JSON.stringify(form),
    });

    authStore.setAuth(res.token, res.user);
    router.push('/platform');
  } catch (err: any) {
    errorMessage.value = err.message || 'Invalid Super Admin credentials.';
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-muted/40 p-6">
    <div class="w-full max-w-md space-y-4">
      <Card class="border-border shadow-lg">
        <CardHeader class="items-center text-center pb-4">
          <div
            class="mb-2 grid size-12 place-items-center rounded-xl bg-amber-600 text-white shadow-xs"
          >
            <ShieldAlert class="w-6 h-6" />
          </div>
          <div class="flex items-center gap-2 justify-center">
            <CardTitle class="text-2xl font-bold tracking-tight">DealFlow360</CardTitle>
            <Badge variant="outline" class="border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-xs font-semibold uppercase">
              Platform Root
            </Badge>
          </div>
          <CardDescription>
            Super Admin Cross-Tenant Governance Console
          </CardDescription>
        </CardHeader>

        <CardContent class="space-y-4">
          <div class="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <Lock class="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span class="font-semibold">Direct URL Only:</span> This console manages tenant organizations, global policies, and platform invites.
            </div>
          </div>

          <!-- Error Alert -->
          <Alert v-if="errorMessage" variant="destructive" class="py-2.5">
            <AlertCircle class="h-4 w-4" />
            <AlertDescription class="text-xs">{{ errorMessage }}</AlertDescription>
          </Alert>

          <form class="grid gap-4" @submit.prevent="onSubmit">
            <div class="grid gap-2">
              <Label for="email">Platform Super Admin Email</Label>
              <Input
                id="email"
                v-model="form.email"
                type="email"
                required
                placeholder="superadmin@dealflow360.com"
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
            <Button
              type="submit"
              :disabled="isLoading"
              class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            >
              <KeyRound class="w-4 h-4 mr-2" />
              {{ isLoading ? 'Authenticating...' : 'Sign in as Super Admin' }}
            </Button>
          </form>
        </CardContent>

        <CardFooter class="flex-col gap-3 pt-4 border-t border-border bg-muted/30 rounded-b-xl">
          <div class="flex items-center justify-between w-full">
            <span class="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Sparkles class="w-3.5 h-3.5 text-amber-600" />
              Platform Credentials:
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="text-xs h-7 px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
              @click="autofill"
            >
              Autofill Credentials
            </Button>
          </div>

          <div class="w-full rounded-md bg-background border border-border p-2.5 text-xs space-y-1 font-mono text-muted-foreground">
            <div><span class="text-foreground font-semibold">Email:</span> superadmin@dealflow360.com</div>
            <div><span class="text-foreground font-semibold">Password:</span> SuperAdminSecret123!</div>
          </div>
        </CardFooter>
      </Card>
    </div>
  </main>
</template>
