<script setup lang="ts">
import { ref, onMounted } from 'vue';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout.vue';
import { apiRequest } from '@/lib/api';
import { authStore, type OrganizationProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, UploadCloud, Save, CheckCircle2, AlertCircle } from 'lucide-vue-next';

const isSaving = ref<boolean>(false);
const isUploadingLogo = ref<boolean>(false);
const successMessage = ref<string>('');
const errorMessage = ref<string>('');

const logoFile = ref<File | null>(null);
const logoPreview = ref<string | null>(null);

const form = ref({
  name: '',
  address: '',
  description: '',
  contactEmail: '',
  contactPhone: '',
  website: '',
  currency: 'USD',
  timezone: 'UTC',
});

const currencies = [
  { code: 'USD', name: 'USD — US Dollar ($)' },
  { code: 'EUR', name: 'EUR — Euro (€)' },
  { code: 'GBP', name: 'GBP — British Pound (£)' },
  { code: 'CAD', name: 'CAD — Canadian Dollar (CA$)' },
  { code: 'AUD', name: 'AUD — Australian Dollar (AU$)' },
  { code: 'JPY', name: 'JPY — Japanese Yen (¥)' },
  { code: 'INR', name: 'INR — Indian Rupee (₹)' },
];

const timezones = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'America/New_York (Eastern Time)' },
  { value: 'America/Chicago', label: 'America/Chicago (Central Time)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (Pacific Time)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST)' },
];

onMounted(async () => {
  const profile = await authStore.fetchProfile();
  if (profile) {
    form.value.name = profile.name || '';
    form.value.address = profile.address || '';
    form.value.description = profile.description || '';
    form.value.contactEmail = profile.contactEmail || '';
    form.value.contactPhone = profile.contactPhone || '';
    form.value.website = profile.website || '';
    form.value.currency = profile.currency || 'USD';
    form.value.timezone = profile.timezone || 'UTC';
    if (profile.logoUrl) {
      logoPreview.value = profile.logoUrl;
    }
  }
});

function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    const file = target.files[0];
    logoFile.value = file;
    logoPreview.value = URL.createObjectURL(file);
  }
}

async function handleUploadLogo() {
  if (!logoFile.value) return;
  errorMessage.value = '';
  isUploadingLogo.value = true;
  try {
    const formData = new FormData();
    formData.append('logo', logoFile.value);
    const result = await apiRequest<{ logoUrl: string }>('/api/organization/logo', {
      method: 'POST',
      body: formData,
    });
    authStore.updateOrg({ logoUrl: result.logoUrl });
    successMessage.value = 'Logo uploaded and updated successfully!';
    setTimeout(() => { successMessage.value = ''; }, 3000);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to upload logo';
  } finally {
    isUploadingLogo.value = false;
  }
}

async function handleSaveSettings() {
  errorMessage.value = '';
  isSaving.value = true;
  try {
    const updated = await apiRequest<{ data: OrganizationProfile } | OrganizationProfile>('/api/organization/profile', {
      method: 'PATCH',
      body: JSON.stringify(form.value),
    });
    const orgData = (updated as any).data ? (updated as any).data : updated;
    authStore.updateOrg(orgData);
    successMessage.value = 'Organization profile settings saved successfully!';
    setTimeout(() => { successMessage.value = ''; }, 3000);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to save settings';
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground">Organization Settings</h1>
        <p class="text-sm text-muted-foreground">Manage your organization's profile, branding, contacts, and currency.</p>
      </div>

      <!-- Success / Error banners -->
      <Alert v-if="successMessage" class="py-2.5 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800">
        <CheckCircle2 class="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <AlertDescription class="text-xs">{{ successMessage }}</AlertDescription>
      </Alert>

      <Alert v-if="errorMessage" variant="destructive" class="py-2.5">
        <AlertCircle class="h-4 w-4" />
        <AlertDescription class="text-xs">{{ errorMessage }}</AlertDescription>
      </Alert>

      <!-- Logo Section -->
      <Card class="border-border shadow-xs">
        <CardHeader>
          <CardTitle class="text-base font-semibold">Brand Logo (MinIO Storage)</CardTitle>
          <CardDescription>Rendered across quotations, invoices, and your workspace header.</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex flex-col sm:flex-row items-center gap-6">
            <div
              class="w-24 h-24 rounded-xl border-2 border-dashed border-border flex items-center justify-center bg-muted/50 overflow-hidden shrink-0 shadow-inner"
            >
              <img
                v-if="logoPreview"
                :src="logoPreview"
                alt="Logo Preview"
                class="w-full h-full object-contain p-2"
              />
              <div v-else class="text-muted-foreground text-center text-xs">
                <UploadCloud class="w-6 h-6 mx-auto mb-1 opacity-60" />
                No logo
              </div>
            </div>

            <div class="space-y-3 flex-1 text-center sm:text-left">
              <Input
                type="file"
                accept="image/png, image/jpeg, image/svg+xml, image/webp"
                class="cursor-pointer text-xs"
                @change="handleFileChange"
              />
              <Button
                v-if="logoFile"
                size="sm"
                :disabled="isUploadingLogo"
                @click="handleUploadLogo"
              >
                <UploadCloud class="w-4 h-4 mr-2" />
                <span>{{ isUploadingLogo ? 'Uploading...' : 'Save New Logo' }}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Profile Form -->
      <form @submit.prevent="handleSaveSettings">
        <Card class="border-border shadow-xs">
          <CardHeader>
            <CardTitle class="text-base font-semibold">Organization Profile & Localization</CardTitle>
            <CardDescription>Company legal name, address, contact numbers, and currency rules.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label for="org-name" class="text-xs uppercase tracking-wider">Organization Name</Label>
                <Input
                  id="org-name"
                  v-model="form.name"
                  type="text"
                  required
                />
              </div>

              <div class="space-y-2">
                <Label for="org-website" class="text-xs uppercase tracking-wider">Company Website</Label>
                <Input
                  id="org-website"
                  v-model="form.website"
                  type="url"
                  placeholder="https://example.com"
                />
              </div>
            </div>

            <div class="space-y-2">
              <Label for="org-description" class="text-xs uppercase tracking-wider">Description</Label>
              <Textarea
                id="org-description"
                v-model="form.description"
                rows="2"
              />
            </div>

            <div class="space-y-2">
              <Label for="org-address" class="text-xs uppercase tracking-wider">Physical Address / Headquarters</Label>
              <Input
                id="org-address"
                v-model="form.address"
                type="text"
              />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label for="org-email" class="text-xs uppercase tracking-wider">Contact Email</Label>
                <Input
                  id="org-email"
                  v-model="form.contactEmail"
                  type="email"
                />
              </div>

              <div class="space-y-2">
                <Label for="org-phone" class="text-xs uppercase tracking-wider">Contact Phone</Label>
                <Input
                  id="org-phone"
                  v-model="form.contactPhone"
                  type="tel"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border">
              <div class="space-y-2">
                <Label class="text-xs uppercase tracking-wider">Operating Currency</Label>
                <Select v-model="form.currency">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="c in currencies" :key="c.code" :value="c.code">
                      {{ c.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-2">
                <Label class="text-xs uppercase tracking-wider">Timezone</Label>
                <Select v-model="form.timezone">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="tz in timezones" :key="tz.value" :value="tz.value">
                      {{ tz.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
          <CardFooter class="flex justify-end border-t border-border pt-4">
            <Button
              type="submit"
              :disabled="isSaving"
            >
              <Save class="w-4 h-4 mr-2" />
              <span>{{ isSaving ? 'Saving Changes...' : 'Save Profile Changes' }}</span>
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  </WorkspaceLayout>
</template>
