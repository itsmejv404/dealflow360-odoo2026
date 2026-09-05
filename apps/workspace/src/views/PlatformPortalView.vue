<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { formatCurrency, marginTone } from '@/lib/currency';
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
  History,
  FileText,
  UserCheck,
  Clock,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
} from 'lucide-vue-next';

interface OrgCount {
  users: number;
  products: number;
  orderLines: number;
  invites: number;
}

interface AuditLogEntry {
  id: string;
  quotationId?: string | null;
  action: string;
  actorId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  reason?: string | null;
  metadata?: any;
  createdAt: string;
  quotation?: {
    quotationNumber: string;
    title: string;
  } | null;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  createdAt: string;
  currency?: string;
  _count?: OrgCount;
  profit?: { totalProfit: number; quotationCount: number };
}

const router = useRouter();
const organizations = ref<Organization[]>([]);

// Total profit across the whole chain (sum of each organization's quotation profit).
const totalChainProfit = computed(() =>
  organizations.value.reduce((sum, org) => sum + Number(org.profit?.totalProfit ?? 0), 0)
);
const chainQuotationCount = computed(() =>
  organizations.value.reduce((sum, org) => sum + Number(org.profit?.quotationCount ?? 0), 0)
);
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

// Audit Log Inspection Modal
const selectedOrgForAudit = ref<Organization | null>(null);
const auditLogs = ref<AuditLogEntry[]>([]);
const isLoadingAuditLogs = ref(false);
const isAuditModalOpen = ref(false);

async function openAuditModal(org: Organization) {
  selectedOrgForAudit.value = org;
  isAuditModalOpen.value = true;
  isLoadingAuditLogs.value = true;
  auditLogs.value = [];
  try {
    const res = await apiRequest<AuditLogEntry[]>(`/api/platform/organizations/${org.id}/audit-logs`);
    auditLogs.value = res;
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to fetch organization audit logs';
  } finally {
    isLoadingAuditLogs.value = false;
  }
}

function closeAuditModal() {
  isAuditModalOpen.value = false;
  selectedOrgForAudit.value = null;
  auditLogs.value = [];
}

function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
    successMessage.value = `Organization "${org.name}" is now ${newStatus === "active" ? "active" : "suspended"}.`;
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
          <p class="text-xs text-muted-foreground">Platform-wide organization governance and control</p>
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
          An invitation email has been sent. The recipient can visit the activation link above to complete their organization onboarding wizard.
        </p>
      </div>

      <!-- Quick Actions Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Create Organization Card -->
        <Card class="border-border shadow-xs">
          <CardHeader class="pb-3">
            <div class="flex items-center gap-2">
              <Building2 class="w-4 h-4 text-amber-600" />
              <CardTitle class="text-base font-semibold">Create Organization</CardTitle>
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
              Send an onboarding invitation to an organization administrator.
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
              <CardTitle class="text-base font-semibold">Organizations Directory</CardTitle>
            </div>
            <CardDescription class="text-xs">
              {{ organizations.length }} organizations registered on the platform.
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
          <!-- Total Profit Chain -->
          <div
            class="mb-4 p-4 rounded-xl border space-y-1"
            :class="marginTone(totalChainProfit).bg"
          >
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <TrendingUp class="w-4 h-4" :class="marginTone(totalChainProfit).text" />
                <span
                  class="text-sm font-semibold"
                  :class="marginTone(totalChainProfit).text"
                >
                  Total Profit Chain ({{ organizations.length }} organizations)
                </span>
              </div>
              <span
                class="text-xl font-bold font-mono"
                :class="marginTone(totalChainProfit).text"
              >
                {{ formatCurrency(totalChainProfit) }}
              </span>
            </div>
            <p class="text-2xs text-muted-foreground">
              Combined profit across all {{ chainQuotationCount }} quotations on the platform.
            </p>
          </div>

          <div class="rounded-lg border border-border overflow-x-auto">
            <table class="w-full text-left text-xs min-w-[640px]">
              <thead class="bg-muted/50 text-muted-foreground border-b border-border font-medium">
                <tr>
                  <th class="p-3">Organization</th>
                  <th class="p-3">Status</th>
                  <th class="p-3 text-right">Users</th>
                  <th class="p-3 text-right">Products</th>
                  <th class="p-3 text-right">Quotes</th>
                  <th class="p-3 text-right">Total Profit</th>
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
                  <td class="p-3 font-semibold">
                    <div class="flex items-center gap-2">
                      <div class="size-6 rounded bg-primary/10 text-primary grid place-items-center text-xs font-bold shrink-0">
                        {{ org.name.substring(0, 2).toUpperCase() }}
                      </div>
                      <span class="truncate">{{ org.name }}</span>
                    </div>
                  </td>
                  <td class="p-3">
                    <Badge
                      :variant="org.status === 'active' ? 'secondary' : 'destructive'"
                      class="text-xs uppercase px-2 py-0.5"
                    >
                      {{ org.status === 'active' ? 'Active' : 'Suspended' }}
                    </Badge>
                  </td>
                  <td class="p-3 text-right text-muted-foreground">{{ org._count?.users ?? '-' }}</td>
                  <td class="p-3 text-right text-muted-foreground">{{ org._count?.products ?? '-' }}</td>
                  <td class="p-3 text-right text-muted-foreground">{{ org.profit?.quotationCount ?? 0 }}</td>
                  <td
                    class="p-3 text-right font-bold font-mono"
                    :class="marginTone(Number(org.profit?.totalProfit ?? 0)).text"
                  >
                    {{ formatCurrency(org.profit?.totalProfit ?? 0, org.currency) }}
                  </td>
                  <td class="p-3 text-right">
                    <div class="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 text-xs border-border hover:bg-muted text-foreground"
                        @click="openAuditModal(org)"
                        title="View activity history"
                      >
                        <History class="w-3 h-3 mr-1 text-primary" />
                        Activity
                      </Button>
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
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </main>

    <!-- Super Admin Organization Audit Logs Modal -->
    <div
      v-if="isAuditModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
    >
      <div class="bg-card border border-border rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
        <div class="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/40">
          <div class="flex items-center gap-2.5">
            <div class="p-2 rounded-lg bg-primary/10 text-primary">
              <ShieldCheck class="w-5 h-5" />
            </div>
            <div>
              <h3 class="font-bold text-sm tracking-tight flex items-center gap-2">
                Organization Audit Trail — {{ selectedOrgForAudit?.name }}
                <Badge variant="outline" class="font-mono text-[10px] uppercase">
                  {{ selectedOrgForAudit?.slug }}
                </Badge>
              </h3>
              <p class="text-xs text-muted-foreground">Immutable activity and approval timeline for this organization</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" class="h-8 px-2" @click="closeAuditModal">
            ✕
          </Button>
        </div>

        <div class="p-6 overflow-y-auto flex-1 space-y-4">
          <div v-if="isLoadingAuditLogs" class="text-center py-12 text-muted-foreground text-xs">
            <RefreshCw class="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
            Loading audit records...
          </div>
          <div v-else-if="auditLogs.length === 0" class="text-center py-12 text-muted-foreground text-xs">
            <FileText class="w-8 h-8 mx-auto mb-2 opacity-40" />
            No audit records found for this organization.
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="log in auditLogs"
              :key="log.id"
              class="border border-border/80 rounded-lg p-3.5 bg-background/60 hover:bg-muted/30 transition-colors space-y-1.5 text-xs"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2">
                  <Badge variant="secondary" class="font-mono uppercase text-[10px] px-1.5 py-0">
                    {{ log.action }}
                  </Badge>
                  <span v-if="log.quotation" class="font-semibold text-foreground">
                    Quotation {{ log.quotation.quotationNumber }} ({{ log.quotation.title }})
                  </span>
                </div>
                <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock class="w-3 h-3" />
                  <span>{{ formatDate(log.createdAt) }}</span>
                </div>
              </div>

              <div class="flex items-center gap-2 text-muted-foreground">
                <UserCheck class="w-3.5 h-3.5 text-primary" />
                <span class="font-medium text-foreground">{{ log.actorName || log.actorEmail || 'System/Unknown' }}</span>
                <span v-if="log.actorRole" class="text-[10px] uppercase font-mono px-1 rounded bg-muted">
                  ({{ log.actorRole }})
                </span>
                <span v-if="log.actorEmail && log.actorName" class="text-muted-foreground">
                  &lt;{{ log.actorEmail }}&gt;
                </span>
              </div>

              <div v-if="log.reason" class="rounded bg-muted/50 p-2 border border-border/40 text-foreground italic">
                "{{ log.reason }}"
              </div>

              <div v-if="log.metadata && Object.keys(log.metadata).length > 0" class="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded p-1.5 overflow-x-auto">
                {{ JSON.stringify(log.metadata) }}
              </div>
            </div>
          </div>
        </div>

        <div class="px-6 py-3 border-t border-border flex justify-between items-center bg-muted/20">
          <span class="text-xs text-muted-foreground">
            {{ auditLogs.length }} audit records logged
          </span>
          <Button size="sm" variant="outline" class="h-8 text-xs" @click="closeAuditModal">
            Close
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
