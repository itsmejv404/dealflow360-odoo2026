<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import brandLogo from '@/assets/dataflow-logo.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, Loader2, CheckCircle2, AlertTriangle } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();

const email = ref('');
const token = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const isSubmitting = ref(false);
const success = ref(false);
const errorMessage = ref<string | null>(null);

onMounted(() => {
  token.value = (route.query.token as string) || '';
  if (route.query.email) email.value = route.query.email as string;
});

async function submit() {
  errorMessage.value = null;
  if (!email.value.trim() || !token.value) {
    errorMessage.value = 'This reset link is incomplete. Request a new one from the sign-in page.';
    return;
  }
  if (!newPassword.value || newPassword.value.length < 8) {
    errorMessage.value = 'Password must be at least 8 characters.';
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = 'Passwords do not match.';
    return;
  }
  isSubmitting.value = true;
  try {
    await apiRequest('/api/auth/reset-password', {
      method: 'POST',
      data: {
        email: email.value.trim(),
        token: token.value,
        newPassword: newPassword.value,
      },
    });
    success.value = true;
    setTimeout(() => router.push('/login'), 2500);
  } catch (err: any) {
    errorMessage.value = err?.message || 'Failed to reset password.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
    <Card class="w-full max-w-md shadow-lg">
      <CardHeader class="text-center">
        <div class="mx-auto mb-2 size-12 rounded-xl bg-primary/10 grid place-items-center">
          <img :src="brandLogo" alt="DealFlow360" class="size-8 object-contain" />
        </div>
        <CardTitle class="text-xl font-bold">Choose a new password</CardTitle>
        <CardDescription class="text-sm">
          Set a new password for your account.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <template v-if="!success">
          <div class="space-y-1.5">
            <Label for="reset-email" class="text-xs font-medium">Email Address</Label>
            <Input id="reset-email" v-model="email" type="email" autocomplete="email" />
          </div>
          <div class="space-y-1.5">
            <Label for="reset-password" class="text-xs font-medium">New Password</Label>
            <Input
              id="reset-password"
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              placeholder="At least 8 characters"
            />
          </div>
          <div class="space-y-1.5">
            <Label for="reset-confirm" class="text-xs font-medium">Confirm New Password</Label>
            <Input
              id="reset-confirm"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              @keyup.enter="submit"
            />
          </div>

          <p v-if="errorMessage" class="text-xs text-destructive flex items-center gap-1.5">
            <AlertTriangle class="w-3.5 h-3.5 shrink-0" /> {{ errorMessage }}
          </p>

          <Button class="w-full" :disabled="isSubmitting" @click="submit">
            <Loader2 v-if="isSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            <KeyRound v-else class="w-4 h-4 mr-2" />
            Reset Password
          </Button>
        </template>

        <div v-else class="text-center space-y-3 py-2">
          <CheckCircle2 class="w-10 h-10 text-emerald-500 mx-auto" />
          <p class="text-sm font-medium text-foreground">Password updated!</p>
          <p class="text-xs text-muted-foreground">Redirecting you to sign in…</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
