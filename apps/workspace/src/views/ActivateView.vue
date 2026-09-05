<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { authStore, type User, type OrganizationProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Building2, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();

const token = ref<string>('');
const email = ref<string>('');
const orgName = ref<string>('');
const name = ref<string>('');
const password = ref<string>('');
const confirmPassword = ref<string>('');

const isLoading = ref<boolean>(true);
const isSubmitting = ref<boolean>(false);
const errorMessage = ref<string>('');
const successMessage = ref<string>('');

onMounted(async () => {
  const queryToken = route.query.token as string;
  if (!queryToken) {
    errorMessage.value = 'Activation token missing from URL. Please check your invitation email.';
    isLoading.value = false;
    return;
  }
  token.value = queryToken;

  try {
    const inviteData = await apiRequest<{
      email: string;
      role: string;
      organization: { name: string; slug: string };
    }>(`/api/onboarding/invite/${token.value}`);

    email.value = inviteData.email;
    orgName.value = inviteData.organization.name;
    name.value = inviteData.email.split('@')[0] || '';
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to verify invitation token';
  } finally {
    isLoading.value = false;
  }
});

async function handleActivate() {
  errorMessage.value = '';
  if (!password.value || password.value.length < 8) {
    errorMessage.value = 'Password must be at least 8 characters long';
    return;
  }
  if (password.value !== confirmPassword.value) {
    errorMessage.value = 'Passwords do not match';
    return;
  }

  isSubmitting.value = true;
  try {
    const response = await apiRequest<{
      token: string;
      user: User;
      organization: OrganizationProfile;
    }>('/api/onboarding/activate', {
      method: 'POST',
      body: JSON.stringify({
        token: token.value,
        password: password.value,
        name: name.value,
      }),
    });

    authStore.setAuth(response.token, response.user, response.organization);
    successMessage.value = 'Account activated successfully! Redirecting to setup wizard...';

    setTimeout(() => {
      router.push('/onboarding');
    }, 1200);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to activate account';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-muted/40 px-4 py-12 sm:px-6 lg:px-8">
    <div class="w-full max-w-md space-y-6">
      <div class="text-center">
        <div class="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs mb-3">
          <Building2 class="h-6 w-6" />
        </div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground">DealFlow360</h1>
        <p class="mt-1 text-sm text-muted-foreground">Activate your organization workspace</p>
      </div>

      <Card class="border-border shadow-sm">
        <CardHeader>
          <CardTitle class="text-xl font-semibold">Set Up Your Admin Account</CardTitle>
          <CardDescription v-if="orgName">
            You are activating your admin role for <strong class="text-foreground">{{ orgName }}</strong>
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div v-if="isLoading" class="py-8 text-center text-sm text-muted-foreground">
            Verifying invitation link...
          </div>

          <Alert v-else-if="errorMessage && !email" variant="destructive">
            <AlertCircle class="h-4 w-4" />
            <AlertTitle>Invitation Error</AlertTitle>
            <AlertDescription class="text-xs">{{ errorMessage }}</AlertDescription>
          </Alert>

          <form v-else @submit.prevent="handleActivate" class="space-y-4">
            <Alert v-if="errorMessage" variant="destructive" class="py-2.5">
              <AlertCircle class="h-4 w-4" />
              <AlertDescription class="text-xs">{{ errorMessage }}</AlertDescription>
            </Alert>

            <Alert v-if="successMessage" class="py-2.5 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 class="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertDescription class="text-xs">{{ successMessage }}</AlertDescription>
            </Alert>

            <div class="space-y-2">
              <Label for="email" class="text-xs uppercase tracking-wider">Email Address</Label>
              <Input
                id="email"
                type="email"
                :value="email"
                disabled
                class="bg-muted cursor-not-allowed"
              />
            </div>

            <div class="space-y-2">
              <Label for="name" class="text-xs uppercase tracking-wider">Full Name</Label>
              <Input
                id="name"
                v-model="name"
                type="text"
                required
                placeholder="e.g. Jane Doe"
              />
            </div>

            <div class="space-y-2">
              <Label for="password" class="text-xs uppercase tracking-wider">Create Password</Label>
              <Input
                id="password"
                v-model="password"
                type="password"
                required
                minlength="8"
                placeholder="At least 8 characters"
              />
            </div>

            <div class="space-y-2">
              <Label for="confirm-password" class="text-xs uppercase tracking-wider">Confirm Password</Label>
              <Input
                id="confirm-password"
                v-model="confirmPassword"
                type="password"
                required
                placeholder="Re-enter your password"
              />
            </div>

            <Button
              type="submit"
              class="w-full"
              :disabled="isSubmitting"
            >
              <KeyRound class="w-4 h-4 mr-2" />
              <span>{{ isSubmitting ? 'Activating...' : 'Activate & Continue' }}</span>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
