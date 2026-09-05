<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customerAuth } from '@/lib/auth';
import { portalApiRequest } from '@/lib/api';
import { ShieldCheck, AlertCircle, Loader2, ArrowRight } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();

const status = ref<'loading' | 'success' | 'error'>('loading');
const errorMessage = ref<string | null>(null);

onMounted(async () => {
  const token = (route.query.token as string) || (route.params.token as string);

  if (!token) {
    status.value = 'error';
    errorMessage.value = 'No magic link access token was provided in the URL.';
    return;
  }

  try {
    customerAuth.setToken(token);
    
    // Verify token validity by checking the portal access endpoint
    const res = await portalApiRequest<{ quotationId: string; orgName: string }>('/api/portal/verify');
    
    status.value = 'success';
    
    // Auto-redirect to quotation after 1s
    setTimeout(() => {
      if (res.quotationId) {
        router.push(`/quotation/${res.quotationId}`);
      } else {
        router.push('/quotation');
      }
    }, 800);
  } catch (err: any) {
    status.value = 'error';
    customerAuth.clearToken();
    errorMessage.value = err.message || 'The quotation access link is invalid or has expired.';
  }
});
</script>

<template>
  <div class="min-h-screen bg-muted/40 flex items-center justify-center p-4">
    <div class="max-w-md w-full bg-card border border-border rounded-2xl p-8 shadow-xl text-center space-y-6">
      <div v-if="status === 'loading'" class="space-y-4">
        <div class="size-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto animate-pulse">
          <Loader2 class="w-7 h-7 animate-spin" />
        </div>
        <div class="space-y-1">
          <h2 class="text-lg font-bold tracking-tight">Authenticating Access</h2>
          <p class="text-xs text-muted-foreground">Validating your secure customer magic link...</p>
        </div>
      </div>

      <div v-else-if="status === 'success'" class="space-y-4">
        <div class="size-14 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mx-auto">
          <ShieldCheck class="w-7 h-7" />
        </div>
        <div class="space-y-1">
          <h2 class="text-lg font-bold tracking-tight text-emerald-600">Access Granted</h2>
          <p class="text-xs text-muted-foreground">Redirecting to your quotation viewer...</p>
        </div>
      </div>

      <div v-else class="space-y-4">
        <div class="size-14 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <AlertCircle class="w-7 h-7" />
        </div>
        <div class="space-y-1">
          <h2 class="text-lg font-bold tracking-tight text-destructive">Invalid or Expired Link</h2>
          <p class="text-xs text-muted-foreground">{{ errorMessage }}</p>
        </div>
        <p class="text-xs text-muted-foreground border-t border-border pt-4">
          Please contact your sales representative or request a new quotation link.
        </p>
      </div>
    </div>
  </div>
</template>
