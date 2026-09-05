<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
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
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  UploadCloud,
  MapPin,
  Globe,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
} from 'lucide-vue-next';

const router = useRouter();

const currentStep = ref<number>(1);
const isSubmitting = ref<boolean>(false);
const errorMessage = ref<string>('');

// Form state
const logoFile = ref<File | null>(null);
const logoPreview = ref<string | null>(null);

const profile = ref({
  address: '',
  description: '',
  contactEmail: '',
  contactPhone: '',
  website: '',
  currency: 'USD',
  timezone: 'UTC',
});

const progressPercentage = computed(() => {
  return ((currentStep.value - 1) / 2) * 100;
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
  if (!authStore.isAuthenticated()) {
    router.push('/login');
    return;
  }
  const org = await authStore.fetchProfile();
  if (org) {
    profile.value.address = org.address || '';
    profile.value.description = org.description || '';
    profile.value.contactEmail = org.contactEmail || authStore.state.user?.email || '';
    profile.value.contactPhone = org.contactPhone || '';
    profile.value.website = org.website || '';
    profile.value.currency = org.currency || 'USD';
    profile.value.timezone = org.timezone || 'UTC';
    if (org.logoUrl) {
      logoPreview.value = org.logoUrl;
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

async function uploadLogoIfPresent(): Promise<void> {
  if (!logoFile.value) return;
  const formData = new FormData();
  formData.append('logo', logoFile.value);
  const result = await apiRequest<{ logoUrl: string }>('/api/organization/logo', {
    method: 'POST',
    body: formData,
  });
  authStore.updateOrg({ logoUrl: result.logoUrl });
}

async function nextStep() {
  errorMessage.value = '';
  if (currentStep.value === 1) {
    if (logoFile.value) {
      isSubmitting.value = true;
      try {
        await uploadLogoIfPresent();
      } catch (err: any) {
        errorMessage.value = err.message || 'Failed to upload logo';
        isSubmitting.value = false;
        return;
      }
      isSubmitting.value = false;
    }
    currentStep.value = 2;
  } else if (currentStep.value === 2) {
    currentStep.value = 3;
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
}

async function completeOnboarding() {
  errorMessage.value = '';
  isSubmitting.value = true;
  try {
    const updated = await apiRequest<{ data: OrganizationProfile } | OrganizationProfile>('/api/organization/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        ...profile.value,
        onboardingCompleted: true,
      }),
    });

    const orgData = (updated as any).data ? (updated as any).data : updated;
    authStore.updateOrg(orgData);
    router.push('/');
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to complete onboarding';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-muted/40 py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-3xl mx-auto space-y-6">
      <!-- Header & Progress -->
      <div class="text-center space-y-2">
        <div class="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
          <Building2 class="h-6 w-6" />
        </div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground">Organization Onboarding Wizard</h1>
        <p class="text-sm text-muted-foreground">
          Configure {{ authStore.state.organization?.name || 'your organization' }} profile, branding, and billing settings.
        </p>

        <!-- Step Pills & Progress Bar -->
        <div class="pt-4 max-w-md mx-auto space-y-2">
          <div class="flex justify-between text-xs font-medium">
            <span :class="currentStep >= 1 ? 'text-primary font-semibold' : 'text-muted-foreground'">1. Logo & Brand</span>
            <span :class="currentStep >= 2 ? 'text-primary font-semibold' : 'text-muted-foreground'">2. Profile & Contacts</span>
            <span :class="currentStep >= 3 ? 'text-primary font-semibold' : 'text-muted-foreground'">3. Localization</span>
          </div>
          <Progress :model-value="progressPercentage" class="h-1.5" />
        </div>
      </div>

      <!-- Step Cards -->
      <Card class="border-border shadow-sm">
        <!-- Error Alert -->
        <div v-if="errorMessage" class="p-6 pb-0">
          <Alert variant="destructive">
            <AlertCircle class="h-4 w-4" />
            <AlertDescription class="text-xs">{{ errorMessage }}</AlertDescription>
          </Alert>
        </div>

        <!-- STEP 1: Logo & Brand -->
        <div v-if="currentStep === 1">
          <CardHeader>
            <CardTitle class="text-lg font-semibold">Step 1: Upload Organization Logo</CardTitle>
            <CardDescription>
              Your logo will appear on customer quotations, billing invoices, and the workspace header.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-6">
            <div class="flex flex-col sm:flex-row items-center gap-6">
              <div
                class="w-32 h-32 rounded-xl border-2 border-dashed border-border flex items-center justify-center bg-muted/50 overflow-hidden shrink-0 shadow-inner"
              >
                <img
                  v-if="logoPreview"
                  :src="logoPreview"
                  alt="Logo Preview"
                  class="w-full h-full object-contain p-2"
                />
                <div v-else class="text-center p-3 text-muted-foreground">
                  <UploadCloud class="w-8 h-8 mx-auto mb-1 opacity-60" />
                  <span class="text-2xs block">No logo selected</span>
                </div>
              </div>

              <div class="flex-1 space-y-2 text-center sm:text-left">
                <Label class="text-sm font-medium">Choose an image file</Label>
                <p class="text-xs text-muted-foreground">Supports PNG, JPG, SVG, or WEBP up to 5MB.</p>
                <Input
                  type="file"
                  accept="image/png, image/jpeg, image/svg+xml, image/webp"
                  class="cursor-pointer text-xs"
                  @change="handleFileChange"
                />
              </div>
            </div>
          </CardContent>
          <CardFooter class="flex justify-end gap-3 border-t border-border pt-4">
            <Button
              :disabled="isSubmitting"
              @click="nextStep"
            >
              <span>{{ logoFile ? 'Upload & Next' : 'Next Step' }}</span>
              <ArrowRight class="w-4 h-4 ml-2" />
            </Button>
          </CardFooter>
        </div>

        <!-- STEP 2: Profile & Contacts -->
        <div v-if="currentStep === 2">
          <CardHeader>
            <CardTitle class="text-lg font-semibold">Step 2: Profile & Contact Information</CardTitle>
            <CardDescription>
              Enter location and contact details for business communications and legal invoices.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label for="description" class="text-xs uppercase tracking-wider">Company Description</Label>
              <Textarea
                id="description"
                v-model="profile.description"
                rows="2"
                placeholder="Brief summary of your business activities..."
              />
            </div>

            <div class="space-y-2">
              <Label for="address" class="text-xs uppercase tracking-wider">Primary Location / Address</Label>
              <Input
                id="address"
                v-model="profile.address"
                type="text"
                placeholder="e.g. 100 Innovation Way, Suite 400, San Francisco, CA"
              />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label for="contact-email" class="text-xs uppercase tracking-wider">Contact Email</Label>
                <Input
                  id="contact-email"
                  v-model="profile.contactEmail"
                  type="email"
                  placeholder="billing@company.com"
                />
              </div>

              <div class="space-y-2">
                <Label for="contact-phone" class="text-xs uppercase tracking-wider">Contact Phone</Label>
                <Input
                  id="contact-phone"
                  v-model="profile.contactPhone"
                  type="tel"
                  placeholder="+1 (555) 019-2834"
                />
              </div>
            </div>

            <div class="space-y-2">
              <Label for="website" class="text-xs uppercase tracking-wider">Company Website</Label>
              <Input
                id="website"
                v-model="profile.website"
                type="url"
                placeholder="https://acmecorp.com"
              />
            </div>
          </CardContent>
          <CardFooter class="flex justify-between border-t border-border pt-4">
            <Button variant="outline" @click="prevStep">
              <ArrowLeft class="w-4 h-4 mr-2" /> Back
            </Button>
            <Button @click="nextStep">
              <span>Next: Localization</span>
              <ArrowRight class="w-4 h-4 ml-2" />
            </Button>
          </CardFooter>
        </div>

        <!-- STEP 3: Localization -->
        <div v-if="currentStep === 3">
          <CardHeader>
            <CardTitle class="text-lg font-semibold">Step 3: Currency & Timezone Configuration</CardTitle>
            <CardDescription>
              Set your operating currency for quotation pricing and timezone for automated billing & deal-health jobs.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label class="text-xs uppercase tracking-wider">Operating Currency</Label>
              <Select v-model="profile.currency">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Select operating currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="c in currencies" :key="c.code" :value="c.code">
                    {{ c.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-muted-foreground">This currency sets the default pricing symbol across all catalogs and invoices.</p>
            </div>

            <div class="space-y-2">
              <Label class="text-xs uppercase tracking-wider">Operating Timezone</Label>
              <Select v-model="profile.timezone">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Select operating timezone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="tz in timezones" :key="tz.value" :value="tz.value">
                    {{ tz.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-muted-foreground">Automated BullMQ billing schedules and deal-health scans evaluate timestamps in this timezone.</p>
            </div>
          </CardContent>
          <CardFooter class="flex justify-between border-t border-border pt-4">
            <Button variant="outline" @click="prevStep">
              <ArrowLeft class="w-4 h-4 mr-2" /> Back
            </Button>
            <Button
              :disabled="isSubmitting"
              class="bg-emerald-600 hover:bg-emerald-700 text-white"
              @click="completeOnboarding"
            >
              <CheckCircle class="w-4 h-4 mr-2" />
              <span>{{ isSubmitting ? 'Finalizing...' : 'Complete Onboarding' }}</span>
            </Button>
          </CardFooter>
        </div>
      </Card>
    </div>
  </div>
</template>
