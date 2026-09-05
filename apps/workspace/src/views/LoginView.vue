<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { authStore, type User, type OrganizationProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LogIn, AlertCircle } from 'lucide-vue-next';
import brandLogo from '@/assets/dataflow-logo.png';

interface LoginResult {
  token: string;
  user: User;
  organization: OrganizationProfile;
}

const router = useRouter();
const form = reactive({ email: '', password: '' });
const errorMessage = ref<string | null>(null);
const isLoading = ref(false);

async function onSubmit(): Promise<void> {
  errorMessage.value = null;
  isLoading.value = true;
  try {
    const res = await apiRequest<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(form),
    });

    authStore.setAuth(res.token, res.user, res.organization);

    // Only the Org Admin is walked through organization onboarding — every
    // other role inherits the org's details and goes straight to the workspace.
    const isAdmin = res.user?.role === 'org_admin';
    if (isAdmin && res.organization && !res.organization.onboardingCompleted) {
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
          <img
            :src="brandLogo"
            alt="DealFlow360"
            class="mb-2 h-14 mx-auto object-contain"
          />
          <CardTitle class="text-2xl font-bold tracking-tight">DealFlow360</CardTitle>
          <CardDescription>Sign in to your workspace</CardDescription>
        </CardHeader>

        <CardContent class="space-y-4">
          <!-- Error Alert -->
          <Alert v-if="errorMessage" variant="destructive" class="py-2.5">
            <AlertCircle class="h-4 w-4" />
            <AlertDescription class="text-xs">{{ errorMessage }}</AlertDescription>
          </Alert>

          <form class="grid gap-4" @submit.prevent="onSubmit">
            <div class="grid gap-2">
              <Label for="email">Work Email</Label>
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
      </Card>
    </div>
  </main>
</template>
