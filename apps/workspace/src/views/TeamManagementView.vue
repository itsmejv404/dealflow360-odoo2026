<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import WorkspaceLayout from '../components/layout/WorkspaceLayout.vue';
import { apiRequest } from '../lib/api';
import { authStore } from '../lib/auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Users,
  UserPlus,
  Shield,
  CheckCircle2,
  AlertTriangle,
  UserX,
  UserCheck,
  Mail,
  Copy,
  Check,
} from 'lucide-vue-next';

interface TeamUser {
  id: string;
  email: string;
  name?: string;
  role: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

interface UsersApiResponse {
  users: TeamUser[];
  pendingInvites: PendingInvite[];
}

const users = ref<TeamUser[]>([]);
const pendingInvites = ref<PendingInvite[]>([]);
const isLoading = ref(true);
const isSubmitting = ref(false);
const isDialogOpen = ref(false);
const actionError = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const copiedId = ref<string | null>(null);

const inviteForm = reactive({
  email: '',
  name: '',
  role: 'rep',
});

const rolesList = [
  { value: 'rep', label: 'Sales Rep', desc: 'Builds quotes, manages lines, responds to customer feedback' },
  { value: 'manager', label: 'Sales Manager', desc: 'First-line approver for high-risk discounts & deal terms' },
  { value: 'finance', label: 'Finance', desc: 'Second-line approver for extreme discounts & billing terms' },
  { value: 'ops', label: 'Operations', desc: 'Fulfillment splits, warehouse inventory & backorders' },
  { value: 'org_admin', label: 'Org Admin', desc: 'Full organization administration & user management' },
];

async function loadTeam() {
  isLoading.value = true;
  actionError.value = null;
  try {
    const res = await apiRequest<UsersApiResponse>('/api/users');
    users.value = res.users;
    pendingInvites.value = res.pendingInvites;
  } catch (err: any) {
    actionError.value = err.message || 'Failed to load team members';
  } finally {
    isLoading.value = false;
  }
}

async function handleInvite() {
  isSubmitting.value = true;
  actionError.value = null;
  successMessage.value = null;
  try {
    await apiRequest('/api/users/invite', {
      method: 'POST',
      body: JSON.stringify(inviteForm),
    });
    successMessage.value = `Invitation sent to ${inviteForm.email}!`;
    inviteForm.email = '';
    inviteForm.name = '';
    inviteForm.role = 'rep';
    isDialogOpen.value = false;
    await loadTeam();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to invite team member';
  } finally {
    isSubmitting.value = false;
  }
}

async function toggleUserStatus(user: TeamUser) {
  const newStatus = user.status === 'active' ? 'suspended' : 'active';
  actionError.value = null;
  successMessage.value = null;
  try {
    await apiRequest(`/api/users/${user.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    user.status = newStatus;
    successMessage.value = `Updated status for ${user.email} to ${newStatus}`;
  } catch (err: any) {
    actionError.value = err.message || 'Failed to update user status';
  }
}

function getRoleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (role) {
    case 'org_admin':
      return 'default';
    case 'manager':
      return 'secondary';
    case 'finance':
      return 'outline';
    default:
      return 'outline';
  }
}

function formatRoleLabel(role: string): string {
  const found = rolesList.find((r) => r.value === role);
  return found ? found.label : role;
}

onMounted(() => {
  loadTeam();
});
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-6">
      <!-- Header Bar -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Users class="w-6 h-6 text-indigo-600" />
            Team & Role-Based Access Control
          </h1>
          <p class="text-sm text-slate-500">
            Manage organization members, assign role permissions, and issue invitations for {{ authStore.state.organization?.name }}.
          </p>
        </div>

        <!-- Invite Member Dialog Trigger -->
        <Dialog v-model:open="isDialogOpen">
          <DialogTrigger as-child>
            <Button class="bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs">
              <UserPlus class="w-4 h-4 mr-2" />
              Invite Team Member
            </Button>
          </DialogTrigger>
          <DialogContent class="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite New Team Member</DialogTitle>
              <DialogDescription>
                Send an activation invitation to a colleague. They will receive an email via Mailhog to activate their account.
              </DialogDescription>
            </DialogHeader>

            <form class="space-y-4 py-2" @submit.prevent="handleInvite">
              <div class="grid gap-2">
                <Label for="invite-email">Email Address</Label>
                <Input
                  id="invite-email"
                  v-model="inviteForm.email"
                  type="email"
                  required
                  placeholder="colleague@your-org.com"
                />
              </div>

              <div class="grid gap-2">
                <Label for="invite-name">Full Name (Optional)</Label>
                <Input
                  id="invite-name"
                  v-model="inviteForm.name"
                  type="text"
                  placeholder="Jane Doe"
                />
              </div>

              <div class="grid gap-2">
                <Label for="invite-role">Assigned Role</Label>
                <select
                  id="invite-role"
                  v-model="inviteForm.role"
                  class="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                >
                  <option v-for="r in rolesList" :key="r.value" :value="r.value">
                    {{ r.label }} — {{ r.desc }}
                  </option>
                </select>
              </div>

              <DialogFooter class="pt-4">
                <Button type="button" variant="outline" @click="isDialogOpen = false">
                  Cancel
                </Button>
                <Button type="submit" :disabled="isSubmitting" class="bg-indigo-600 hover:bg-indigo-700">
                  {{ isSubmitting ? 'Sending Invite...' : 'Send Invitation' }}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <!-- Alerts -->
      <div
        v-if="actionError"
        class="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2"
      >
        <AlertTriangle class="w-4 h-4 shrink-0" />
        <span>{{ actionError }}</span>
      </div>

      <div
        v-if="successMessage"
        class="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-center gap-2"
      >
        <CheckCircle2 class="w-4 h-4 shrink-0" />
        <span>{{ successMessage }}</span>
      </div>

      <!-- Active Members Table -->
      <Card class="border-slate-200 bg-white shadow-xs">
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <div>
              <CardTitle class="text-lg font-semibold text-slate-900">Organization Members</CardTitle>
              <CardDescription>Active and suspended users with access to this tenant workspace.</CardDescription>
            </div>
            <Badge variant="secondary" class="font-semibold text-slate-700">
              {{ users.length }} Total Members
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="isLoading" class="py-8 text-center text-sm text-slate-400">
            Loading team members...
          </div>
          <Table v-else>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead class="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="u in users" :key="u.id">
                <TableCell>
                  <div class="font-medium text-slate-900">{{ u.name || 'Unnamed User' }}</div>
                  <div class="text-xs text-slate-500">{{ u.email }}</div>
                </TableCell>
                <TableCell>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
                    :class="{
                      'bg-indigo-100 text-indigo-800 border border-indigo-200': u.role === 'org_admin',
                      'bg-blue-100 text-blue-800 border border-blue-200': u.role === 'rep',
                      'bg-amber-100 text-amber-800 border border-amber-200': u.role === 'manager',
                      'bg-emerald-100 text-emerald-800 border border-emerald-200': u.role === 'finance',
                      'bg-purple-100 text-purple-800 border border-purple-200': u.role === 'ops',
                    }"
                  >
                    {{ formatRoleLabel(u.role) }}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    :variant="u.status === 'active' ? 'outline' : 'destructive'"
                    :class="{ 'bg-emerald-50 text-emerald-700 border-emerald-200': u.status === 'active' }"
                  >
                    {{ u.status === 'active' ? 'Active' : 'Suspended' }}
                  </Badge>
                </TableCell>
                <TableCell class="text-xs text-slate-500">
                  {{ new Date(u.createdAt).toLocaleDateString() }}
                </TableCell>
                <TableCell class="text-right">
                  <Button
                    v-if="u.id !== authStore.state.user?.id"
                    variant="ghost"
                    size="sm"
                    :class="u.status === 'active' ? 'text-red-600 hover:text-red-700 hover:bg-red-50' : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'"
                    @click="toggleUserStatus(u)"
                  >
                    <component :is="u.status === 'active' ? UserX : UserCheck" class="w-3.5 h-3.5 mr-1" />
                    {{ u.status === 'active' ? 'Suspend' : 'Reactivate' }}
                  </Button>
                  <span v-else class="text-xs text-slate-400 italic">Current User</span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <!-- Pending Invitations Table -->
      <Card v-if="pendingInvites.length > 0" class="border-slate-200 bg-white shadow-xs">
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <div>
              <CardTitle class="text-lg font-semibold text-slate-900">Pending Invitations</CardTitle>
              <CardDescription>Awaiting account activation by invited colleagues.</CardDescription>
            </div>
            <Badge variant="outline" class="text-amber-700 bg-amber-50 border-amber-200">
              {{ pendingInvites.length }} Pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Assigned Role</TableHead>
                <TableHead>Invited Date</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="inv in pendingInvites" :key="inv.id">
                <TableCell class="font-medium text-slate-900 flex items-center gap-1.5">
                  <Mail class="w-3.5 h-3.5 text-slate-400" />
                  {{ inv.email }}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{{ formatRoleLabel(inv.role) }}</Badge>
                </TableCell>
                <TableCell class="text-xs text-slate-500">
                  {{ new Date(inv.createdAt).toLocaleDateString() }}
                </TableCell>
                <TableCell class="text-xs text-slate-500">
                  {{ new Date(inv.expiresAt).toLocaleDateString() }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  </WorkspaceLayout>
</template>
