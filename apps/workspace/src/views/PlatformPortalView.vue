<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ShieldAlert,
  Building2,
  Users,
  Package,
  Mail,
  Plus,
  RefreshCw,
  Power,
  LogOut,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-vue-next';

interface OrgCount {
  users: number;
  products: number;
  orderLines: number;
  invites: number;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  createdAt: string;
  _count?: OrgCount;
}

const router = useRouter();
const organizations = ref<Organization[]>([]);
const isLoading = ref(true);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

// Create Org Form
const newOrg = reactive({ name: '', slug: '' });
const isCreating = ref(false);

// Invite Admin Form
const inviteData = reactive({ orgId: '', email: '' });
const isInviting = ref(false);
const latestInviteToken = ref<string | null>(null);

async function loadOrganizations() {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const data = await apiRequest<Organization[]>('/api/platform/organizations');
    organizations.value = data;
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to load platform organizations';
    if (
      err?.message?.includes('401') ||
      err?.message?.toLowerCase()?.includes('unauthorized') ||
      err?.message?.toLowerCase()?.includes('invalid')
    ) {
      authStore.logout();
      router.push('/superadmin/login');
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleCreateOrg() {
  if (!newOrg.name.trim()) return;
  isCreating.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await apiRequest('/api/platform/organizations', {
      method: 'POST',
      body: JSON.stringify({
        name: newOrg.name,
        slug: newOrg.slug || undefined,
      }),
    });
    successMessage.value = `Organization "${newOrg.name}" created successfully.`;
    newOrg.name = '';
    newOrg.slug = '';
    await loadOrganizations();
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to create organization';
  } finally {
    isCreating.value = false;
  }
}

async function toggleOrgStatus(org: Organization) {
  const newStatus = org.status === 'active' ? 'suspended' : 'active';
  try {
    await apiRequest(`/api/platform/organizations/${org.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    org.status = newStatus;
    successMessage.value = `Organization "${org.name}" status changed to ${newStatus}.`;
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to update organization status';
  }
}

async function handleInviteAdmin() {
  if (!inviteData.orgId || !inviteData.email) return;
  isInviting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  latestInviteToken.value = null;
  try {
    const res = await apiRequest<{ token: string; email: string }>(
      `/api/platform/organizations/${inviteData.orgId}/invites`,
      {
        method: 'POST',
        body: JSON.stringify({ email: inviteData.email }),
      }
    );
    latestInviteToken.value = res.token;
    successMessage.value = `Invitation sent to ${res.email}! Activation token generated.`;
    inviteData.email = '';
    await loadOrganizations();
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to send invite';
  } finally {
    isInviting.value = false;
  }
}

function handleLogout() {
  authStore.logout();
  router.push('/superadmin/login');
}

onMounted(async () => {
  if (authStore.state.user?.role !== 'super_admin') {
    router.push('/superadmin/login');
    return;
  }
  await loadOrganizations();
});
</script>

<template>
  <div class="min-h-screen bg-muted/30 flex flex-col">
    <!-- Super Admin Header -->
    <header class="border-b border-border bg-card/90 backdrop-blur-sm sticky top-0 z-30 px-6 py-3.5 flex items-center justify-between shadow-xs">
      <div class="flex items-center gap-3">
        <div class="grid size-9 place-items-center rounded-xl bg-amber-600 text-white">
          <ShieldAlert class="w-5 h-5" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-base tracking-tight">DealFlow360</span>
            <Badge variant="outline" class="border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10 text-xs uppercase font-semibold">
              Super Admin Console
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground">Platform-Wide Tenant Governance & Isolation Control</p>
        </div>
      </div>

      <div class="flex items-center gap-4">
        <div class="text-right hidden sm:block">
          <div class="text-xs font-semibold">{{ authStore.state.user?.name || 'Super Admin' }}</div>
          <div class="text-xs text-muted-foreground font-mono">{{ authStore.state.user?.email }}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="border-border hover:bg-muted"
          @click="handleLogout"
        >
          <LogOut class="w-4 h-4 mr-1.5" />
          Logout
        </Button>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
      <!-- Notification Alerts -->
      <Alert v-if="errorMessage" variant="destructive" class="py-2.5">
        <AlertTriangle class="h-4 w-4" />
        <AlertDescription class="text-xs">{{ errorMessage }}</AlertDescription>
      </Alert>

      <Alert v-if="successMessage" class="py-2.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 class="h-4 w-4 text-emerald-600" />
        <AlertDescription class="text-xs">{{ successMessage }}</AlertDescription>
      </Alert>

      <!-- Activation Token Banner if generated -->
      <div v-if="latestInviteToken" class="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
        <div class="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-semibold text-sm">
          <Mail class="w-4 h-4" />
          Generated Admin Activation Link:
        </div>
        <div class="flex items-center gap-2 bg-card border border-border p-2 rounded-lg font-mono text-xs break-all">
          <span>http://localhost/activate?token={{ latestInviteToken }}</span>
        </div>
        <p class="text-xs text-muted-foreground">
          An email has been dispatched via Mailhog. The recipient can visit the activation link above to complete their organization onboarding wizard.
        </p>
      </div>

      <!-- Quick Actions Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Create Organization Card -->
        <Card class="border-border shadow-xs">
          <CardHeader class="pb-3">
            <div class="flex items-center gap-2">
              <Building2 class="w-4 h-4 text-amber-600" />
              <CardTitle class="text-base font-semibold">Create Tenant Organization</CardTitle>
            </div>
            <CardDescription class="text-xs">
              Provision a new isolated organization boundary.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form class="space-y-3" @submit.prevent="handleCreateOrg">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="space-y-1">
                  <Label class="text-xs">Organization Name</Label>
                  <Input
                    v-model="newOrg.name"
                    required
                    placeholder="e.g. Stark Industries"
                    class="text-xs h-8"
                  />
                </div>
                <div class="space-y-1">
                  <Label class="text-xs">Custom Slug (optional)</Label>
                  <Input
                    v-model="newOrg.slug"
                    placeholder="e.g. stark"
                    class="text-xs h-8"
                  />
                </div>
              </div>
              <Button
                type="submit"
                size="sm"
                :disabled="isCreating || !newOrg.name.trim()"
                class="bg-amber-600 hover:bg-amber-700 text-white font-semibold h-8 text-xs"
              >
                <Plus class="w-3.5 h-3.5 mr-1" />
                {{ isCreating ? 'Creating...' : 'Provision Organization' }}
              </Button>
            </form>
          </CardContent>
        </Card>

        <!-- Invite Admin Card -->
        <Card class="border-border shadow-xs">
          <CardHeader class="pb-3">
            <div class="flex items-center gap-2">
              <Mail class="w-4 h-4 text-amber-600" />
              <CardTitle class="text-base font-semibold">Invite Organization Admin</CardTitle>
            </div>
            <CardDescription class="text-xs">
              Send an onboarding invitation token to a tenant administrator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form class="space-y-3" @submit.prevent="handleInviteAdmin">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="space-y-1">
                  <Label class="text-xs">Target Organization</Label>
                  <select
                    v-model="inviteData.orgId"
                    required
                    class="w-full bg-background border border-input text-foreground text-xs rounded-md h-8 px-2.5"
                  >
                    <option value="" disabled>Select Organization...</option>
                    <option v-for="org in organizations" :key="org.id" :value="org.id">
                      {{ org.name }} ({{ org.slug }})
                    </option>
                  </select>
                </div>
                <div class="space-y-1">
                  <Label class="text-xs">Admin Email</Label>
                  <Input
                    v-model="inviteData.email"
                    type="email"
                    required
                    placeholder="admin@org.com"
                    class="text-xs h-8"
                  />
                </div>
              </div>
              <Button
                type="submit"
                size="sm"
                :disabled="isInviting || !inviteData.orgId || !inviteData.email"
                class="bg-amber-600 hover:bg-amber-700 text-white font-semibold h-8 text-xs"
              >
                <Mail class="w-3.5 h-3.5 mr-1" />
                {{ isInviting ? 'Sending Invite...' : 'Send Activation Invite' }}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <!-- Organizations Table -->
      <Card class="border-border shadow-xs">
        <CardHeader class="pb-3 flex flex-row items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <Building2 class="w-4 h-4 text-amber-600" />
              <CardTitle class="text-base font-semibold">Tenant Organizations Directory</CardTitle>
            </div>
            <CardDescription class="text-xs">
              {{ organizations.length }} total tenants registered in platform registry.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-8 text-xs"
            @click="loadOrganizations"
          >
            <RefreshCw class="w-3.5 h-3.5 mr-1" :class="{ 'animate-spin': isLoading }" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div class="rounded-lg border border-border overflow-hidden">
            <table class="w-full text-left text-xs">
              <thead class="bg-muted/50 text-muted-foreground border-b border-border font-medium">
                <tr>
                  <th class="p-3">Organization</th>
                  <th class="p-3">Slug</th>
                  <th class="p-3">Status</th>
                  <th class="p-3">Users</th>
                  <th class="p-3">Products</th>
                  <th class="p-3">Invites</th>
                  <th class="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <tr v-if="isLoading" class="text-center text-muted-foreground">
                  <td colspan="7" class="p-6">Loading organizations...</td>
                </tr>
                <tr v-else-if="organizations.length === 0" class="text-center text-muted-foreground">
                  <td colspan="7" class="p-6">No organizations found. Provision one above.</td>
                </tr>
                <tr
                  v-for="org in organizations"
                  :key="org.id"
                  class="hover:bg-muted/50 transition-colors"
                >
                  <td class="p-3 font-semibold flex items-center gap-2">
                    <div class="size-6 rounded bg-primary/10 text-primary grid place-items-center text-xs font-bold">
                      {{ org.name.substring(0, 2).toUpperCase() }}
                    </div>
                    {{ org.name }}
                  </td>
                  <td class="p-3 font-mono text-muted-foreground">{{ org.slug }}</td>
                  <td class="p-3">
                    <Badge
                      :variant="org.status === 'active' ? 'secondary' : 'destructive'"
                      class="text-xs uppercase px-2 py-0.5"
                    >
                      {{ org.status }}
                    </Badge>
                  </td>
                  <td class="p-3 text-muted-foreground">{{ org._count?.users ?? '-' }}</td>
                  <td class="p-3 text-muted-foreground">{{ org._count?.products ?? '-' }}</td>
                  <td class="p-3 text-muted-foreground">{{ org._count?.invites ?? '-' }}</td>
                  <td class="p-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      class="h-7 text-xs"
                      :class="org.status === 'active' ? 'text-destructive hover:bg-destructive/10' : 'text-emerald-600 hover:bg-emerald-500/10'"
                      @click="toggleOrgStatus(org)"
                    >
                      <Power class="w-3 h-3 mr-1" />
                      {{ org.status === 'active' ? 'Suspend' : 'Reactivate' }}
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </main>
  </div>
</template>
