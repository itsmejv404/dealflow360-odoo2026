<script setup lang="ts">
import { ref } from 'vue';
import { apiRequest } from '@/lib/api';
import brandLogo from '@/assets/dataflow-logo.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, Loader2, CheckCircle2, ArrowLeft } from 'lucide-vue-next';

const email = ref('');
const isSubmitting = ref(false);
const submitted = ref(false);
const errorMessage = ref<string | null>(null);

async function submit() {
  errorMessage.value = null;
  if (!email.value.trim()) {
    errorMessage.value = 'Enter your email address.';
    return;
  }
  isSubmitting.value = true;
  try {
    await apiRequest('/api/auth/forgot-password', {
      method: 'POST',
      data: { email: email.value.trim() },
    });
    submitted.value = true;
  } catch (err: any) {
    errorMessage.value = err?.message || 'Failed to send reset link.';
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
        <CardTitle class="text-xl font-bold">Forgot your password?</CardTitle>
        <CardDescription class="text-sm">
          Enter your email and we'll send you a link to reset your password.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <template v-if="!submitted">
          <div class="space-y-1.5">
            <Label for="forgot-email" class="text-xs font-medium">Email Address</Label>
            <Input
              id="forgot-email"
              v-model="email"
              type="email"
              placeholder="you@company.com"
              autocomplete="email"
              @keyup.enter="submit"
            />
          </div>

          <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

          <Button class="w-full" :disabled="isSubmitting" @click="submit">
            <Loader2 v-if="isSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            <Mail v-else class="w-4 h-4 mr-2" />
            Send Reset Link
          </Button>
        </template>

        <div v-else class="text-center space-y-3 py-2">
          <CheckCircle2 class="w-10 h-10 text-emerald-500 mx-auto" />
          <p class="text-sm font-medium text-foreground">Check your inbox</p>
          <p class="text-xs text-muted-foreground">
            If an account exists for <span class="font-medium">{{ email }}</span>, a password reset
            link has been sent. The link expires in 1 hour.
          </p>
        </div>

        <router-link
          to="/login"
          class="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft class="w-3.5 h-3.5" />
          Back to sign in
        </router-link>
      </CardContent>
    </Card>
  </div>
</template>
