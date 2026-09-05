<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiRequest } from '@/lib/api';
import { authStore } from '@/lib/auth';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout.vue';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { User, KeyRound, Save, Loader2, CheckCircle2, AlertTriangle } from 'lucide-vue-next';

const nameInput = ref('');
const isLoading = ref(false);
const isSavingProfile = ref(false);
const isSavingPassword = ref(false);
const profileSuccess = ref<string | null>(null);
const passwordSuccess = ref<string | null>(null);
const profileError = ref<string | null>(null);
const passwordError = ref<string | null>(null);

const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Organization Admin',
  rep: 'Sales Rep',
  manager: 'Sales Manager',
  finance: 'Finance',
  ops: 'Operations',
};

function roleLabel(role?: string | null): string {
  if (!role) return '';
  return ROLE_LABELS[role] || role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

onMounted(async () => {
  isLoading.value = true;
  try {
    await authStore.fetchProfile();
    nameInput.value = authStore.state.user?.name || '';
  } finally {
    isLoading.value = false;
  }
});

async function saveProfile() {
  profileError.value = null;
  profileSuccess.value = null;
  if (!nameInput.value.trim()) {
    profileError.value = 'Name cannot be empty.';
    return;
  }
  isSavingProfile.value = true;
  try {
    await apiRequest('/api/auth/profile', {
      method: 'PUT',
      data: { name: nameInput.value.trim() },
    });
    await authStore.fetchProfile();
    profileSuccess.value = 'Profile updated successfully.';
  } catch (err: any) {
    profileError.value = err?.message || 'Failed to update profile.';
  } finally {
    isSavingProfile.value = false;
  }
}

async function savePassword() {
  passwordError.value = null;
  passwordSuccess.value = null;
  const { currentPassword, newPassword, confirmPassword } = passwordForm.value;
  if (!currentPassword || !newPassword) {
    passwordError.value = 'Enter your current and new password.';
    return;
  }
  if (newPassword.length < 8) {
    passwordError.value = 'New password must be at least 8 characters.';
    return;
  }
  if (newPassword !== confirmPassword) {
    passwordError.value = 'New passwords do not match.';
    return;
  }
  isSavingPassword.value = true;
  try {
    await apiRequest('/api/auth/profile', {
      method: 'PUT',
      data: { currentPassword, newPassword },
    });
    passwordSuccess.value = 'Password changed successfully.';
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' };
  } catch (err: any) {
    passwordError.value = err?.message || 'Failed to change password.';
  } finally {
    isSavingPassword.value = false;
  }
}
</script>

<template>
  <WorkspaceLayout>
    <div class="max-w-2xl mx-auto space-y-6">
      <!-- Header -->
      <div class="border-b border-border pb-5">
        <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <User class="w-6 h-6 text-primary" />
          My Profile
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
          Manage your personal details and account security.
        </p>
      </div>

      <!-- Profile Details -->
      <Card class="border-border bg-card shadow-xs">
        <CardHeader class="pb-3 border-b border-border/70">
          <CardTitle class="text-base font-semibold">Personal Details</CardTitle>
          <CardDescription class="text-xs">
            Your display name shown across the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent class="pt-4 space-y-4">
          <div class="space-y-1.5">
            <Label class="text-xs font-medium">Full Name</Label>
            <Input v-model="nameInput" placeholder="Your name" class="h-9 text-sm" />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs font-medium">Email</Label>
            <Input
              :model-value="authStore.state.user?.email"
              disabled
              class="h-9 text-sm opacity-70"
            />
            <p class="text-2xs text-muted-foreground">Email address cannot be changed.</p>
          </div>
          <div class="flex items-center gap-2">
            <Badge variant="secondary" class="text-2xs">{{ roleLabel(authStore.state.user?.role) }}</Badge>
          </div>

          <p v-if="profileError" class="text-xs text-destructive flex items-center gap-1.5">
            <AlertTriangle class="w-3.5 h-3.5" /> {{ profileError }}
          </p>
          <p v-else-if="profileSuccess" class="text-xs text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 class="w-3.5 h-3.5" /> {{ profileSuccess }}
          </p>

          <Button size="sm" :disabled="isSavingProfile" @click="saveProfile">
            <Loader2 v-if="isSavingProfile" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
            <Save v-else class="w-3.5 h-3.5 mr-1.5" />
            Save Changes
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <!-- Change Password -->
      <Card class="border-border bg-card shadow-xs">
        <CardHeader class="pb-3 border-b border-border/70">
          <CardTitle class="text-base font-semibold flex items-center gap-2">
            <KeyRound class="w-4 h-4 text-primary" />
            Change Password
          </CardTitle>
          <CardDescription class="text-xs">
            Verify your current password to set a new one.
          </CardDescription>
        </CardHeader>
        <CardContent class="pt-4 space-y-4">
          <div class="space-y-1.5">
            <Label class="text-xs font-medium">Current Password</Label>
            <Input
              v-model="passwordForm.currentPassword"
              type="password"
              autocomplete="current-password"
              class="h-9 text-sm"
            />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs font-medium">New Password</Label>
            <Input
              v-model="passwordForm.newPassword"
              type="password"
              autocomplete="new-password"
              class="h-9 text-sm"
            />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs font-medium">Confirm New Password</Label>
            <Input
              v-model="passwordForm.confirmPassword"
              type="password"
              autocomplete="new-password"
              class="h-9 text-sm"
            />
          </div>

          <p v-if="passwordError" class="text-xs text-destructive flex items-center gap-1.5">
            <AlertTriangle class="w-3.5 h-3.5" /> {{ passwordError }}
          </p>
          <p v-else-if="passwordSuccess" class="text-xs text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 class="w-3.5 h-3.5" /> {{ passwordSuccess }}
          </p>

          <Button size="sm" :disabled="isSavingPassword" @click="savePassword">
            <Loader2 v-if="isSavingPassword" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
            <KeyRound v-else class="w-3.5 h-3.5 mr-1.5" />
            Update Password
          </Button>
        </CardContent>
      </Card>
    </div>
  </WorkspaceLayout>
</template>
