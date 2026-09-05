<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { getSocket } from '@/lib/socket';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout.vue';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  PackageSearch,
  Percent,
  RefreshCw,
  ShieldAlert,
} from 'lucide-vue-next';

const router = useRouter();

interface AlertRecord {
  id: string;
  alertType: 'stalled_quote' | 'discount_anomaly' | 'delivery_slippage';
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  status: 'open' | 'nudged' | 'escalated' | 'resolved';
  createdAt: string;
  nudgedAt?: string | null;
  escalatedAt?: string | null;
  resolvedAt?: string | null;
  quotation?: { id: string; quotationNumber: string; status: string } | null;
  rep?: { id: string; name: string; email: string } | null;
}

const alerts = ref<AlertRecord[]>([]);
const isLoading = ref(true);
const isRefreshing = ref(false);
const filterStatus = ref<string>('open');
const filterType = ref<string>('all');

const canAct = computed(() =>
  ['org_admin', 'manager', 'finance'].includes(authStore.state.user?.role || '')
);

const TYPE_META: Record<string, { label: string; icon: any }> = {
  stalled_quote: { label: 'Stalled Quote', icon: Clock },
  discount_anomaly: { label: 'Discount Anomaly', icon: Percent },
  delivery_slippage: { label: 'Delivery Slippage', icon: PackageSearch },
};

const SEVERITY_CLASS: Record<string, string> = {
  low: 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300',
  medium: 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300',
  high: 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-300',
};

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-300',
  nudged: 'bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-300',
  escalated: 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-300',
  resolved: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300',
};

const openCount = computed(() => alerts.value.filter((a) => ['open', 'nudged', 'escalated'].includes(a.status)).length);
const highCount = computed(() => alerts.value.filter((a) => a.severity === 'high' && a.status !== 'resolved').length);

const filteredAlerts = computed(() =>
  alerts.value.filter((a) => {
    if (filterStatus.value === 'open' && !['open', 'nudged', 'escalated'].includes(a.status)) return false;
    if (filterStatus.value !== 'open' && filterStatus.value !== 'all' && a.status !== filterStatus.value) return false;
    if (filterType.value !== 'all' && a.alertType !== filterType.value) return false;
    return true;
  })
);

function typeLabel(t: string) {
  return TYPE_META[t]?.label || t;
}
function typeIcon(t: string) {
  return TYPE_META[t]?.icon || AlertTriangle;
}

function formatDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadAlerts() {
  isLoading.value = true;
  try {
    const res = await apiRequest<AlertRecord[]>('/api/dealhealth/alerts');
    alerts.value = res || [];
  } catch (err: any) {
    console.error('Failed to load deal health alerts:', err);
  } finally {
    isLoading.value = false;
  }
}

/** Refresh clears any cached deal-health data server-side and re-fetches fresh alerts. */
async function refreshAlerts() {
  isRefreshing.value = true;
  try {
    const res = await apiRequest<AlertRecord[]>('/api/dealhealth/alerts?refresh=1');
    alerts.value = res || [];
  } catch (err: any) {
    console.error('Failed to refresh deal health alerts:', err);
  } finally {
    isRefreshing.value = false;
  }
}

async function nudge(a: AlertRecord, escalate: boolean) {
  try {
    await apiRequest(`/api/dealhealth/alerts/${a.id}/nudge`, {
      method: 'POST',
      data: { escalate },
    });
    await loadAlerts();
  } catch (err: any) {
    alert(err.message || 'Nudge failed');
  }
}

async function resolve(a: AlertRecord) {
  try {
    await apiRequest(`/api/dealhealth/alerts/${a.id}/resolve`, { method: 'POST', data: {} });
    await loadAlerts();
  } catch (err: any) {
    alert(err.message || 'Resolve failed');
  }
}

function openQuotation(a: AlertRecord) {
  if (a.quotation?.id) {
    router.push(`/quotations/${a.quotation.id}`);
  }
}

let socket: any = null;
onMounted(async () => {
  await loadAlerts();
  socket = getSocket();
  if (socket) {
    socket.on('dealhealth:alerts', () => loadAlerts());
    socket.on('dealhealth:updated', () => loadAlerts());
  }
});
onUnmounted(() => {
  if (socket) {
    socket.off('dealhealth:alerts');
    socket.off('dealhealth:updated');
  }
});
</script>

<template>
  <WorkspaceLayout>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Activity class="w-6 h-6 text-primary" />
            Deal Health Monitoring
          </h1>
          <p class="text-sm text-muted-foreground mt-1">
            Always-on observer: stalled quotes, discount anomalies, and delivery slippage across your organization.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="h-9 gap-1.5" :disabled="isRefreshing" @click="refreshAlerts">
            <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': isRefreshing }" />
            Refresh
          </Button>
        </div>
      </div>

      <!-- KPI cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card class="border-border bg-card shadow-xs">
          <CardContent class="p-4 flex items-center justify-between">
            <div>
              <p class="text-xs font-medium text-muted-foreground">Open Alerts</p>
              <p class="text-xl font-bold text-foreground mt-0.5">{{ openCount }}</p>
            </div>
            <div class="p-2.5 rounded-lg bg-amber-500/10 text-amber-600">
              <AlertTriangle class="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
        <Card class="border-border bg-card shadow-xs">
          <CardContent class="p-4 flex items-center justify-between">
            <div>
              <p class="text-xs font-medium text-muted-foreground">High Severity</p>
              <p class="text-xl font-bold text-red-600 dark:text-red-400 mt-0.5">{{ highCount }}</p>
            </div>
            <div class="p-2.5 rounded-lg bg-red-500/10 text-red-600">
              <ShieldAlert class="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
        <Card class="border-border bg-card shadow-xs">
          <CardContent class="p-4 flex items-center justify-between">
            <div>
              <p class="text-xs font-medium text-muted-foreground">Resolved</p>
              <p class="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {{ alerts.filter((a) => a.status === 'resolved').length }}
              </p>
            </div>
            <div class="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 class="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Filters + Table -->
      <Card class="border-border bg-card shadow-xs">
        <CardHeader class="pb-3 border-b border-border/70">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle class="text-base font-semibold">Alerts</CardTitle>
              <CardDescription class="text-xs">
                Scans run automatically every 6 hours; clicking an alert jumps straight to the quotation.
              </CardDescription>
            </div>
            <div class="flex items-center gap-2">
              <select
                v-model="filterStatus"
                class="h-8 text-xs bg-background border border-border rounded-md px-2 text-foreground focus:outline-hidden"
              >
                <option value="open">Open Only</option>
                <option value="all">All Statuses</option>
                <option value="nudged">Nudged</option>
                <option value="escalated">Escalated</option>
                <option value="resolved">Resolved</option>
              </select>
              <select
                v-model="filterType"
                class="h-8 text-xs bg-background border border-border rounded-md px-2 text-foreground focus:outline-hidden"
              >
                <option value="all">All Types</option>
                <option value="stalled_quote">Stalled Quotes</option>
                <option value="discount_anomaly">Discount Anomalies</option>
                <option value="delivery_slippage">Delivery Slippage</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/40 text-2xs uppercase">
                <TableHead class="font-semibold">Alert</TableHead>
                <TableHead class="font-semibold">Type</TableHead>
                <TableHead class="font-semibold">Quotation</TableHead>
                <TableHead class="font-semibold">Rep</TableHead>
                <TableHead class="font-semibold text-center">Severity</TableHead>
                <TableHead class="font-semibold text-center">Status</TableHead>
                <TableHead class="font-semibold">Detected</TableHead>
                <TableHead class="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-if="filteredAlerts.length > 0">
                <TableRow
                  v-for="a in filteredAlerts"
                  :key="a.id"
                  class="hover:bg-muted/30 transition-colors cursor-pointer align-top"
                  @click="openQuotation(a)"
                >
                  <TableCell class="text-xs max-w-sm">
                    <div class="font-semibold text-foreground">{{ a.title }}</div>
                    <div class="text-2xs text-muted-foreground mt-0.5 line-clamp-2">{{ a.detail }}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" class="text-2xs gap-1">
                      <component :is="typeIcon(a.alertType)" class="w-3 h-3" />
                      {{ typeLabel(a.alertType) }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-xs font-mono text-muted-foreground">
                    {{ a.quotation?.quotationNumber || '—' }}
                  </TableCell>
                  <TableCell class="text-xs text-muted-foreground">
                    {{ a.rep?.name || '—' }}
                  </TableCell>
                  <TableCell class="text-center">
                    <Badge variant="outline" class="text-2xs uppercase font-semibold" :class="SEVERITY_CLASS[a.severity]">
                      {{ a.severity }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-center">
                    <Badge variant="outline" class="text-2xs uppercase font-semibold" :class="STATUS_CLASS[a.status]">
                      {{ a.status }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-xs text-muted-foreground">
                    {{ formatDate(a.createdAt) }}
                  </TableCell>
                  <TableCell class="text-right" @click.stop>
                    <div class="flex items-center justify-end gap-1.5">
                      <Button
                        v-if="canAct && a.status === 'open'"
                        variant="outline"
                        size="sm"
                        class="h-7 px-2 text-xs"
                        @click="nudge(a, false)"
                      >
                        <BellRing class="w-3 h-3 mr-1" />
                        Nudge
                      </Button>
                      <Button
                        v-if="canAct && a.status !== 'escalated' && a.status !== 'resolved'"
                        variant="outline"
                        size="sm"
                        class="h-7 px-2 text-xs text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                        @click="nudge(a, true)"
                      >
                        Escalate
                      </Button>
                      <Button
                        v-if="canAct && a.status !== 'resolved'"
                        variant="ghost"
                        size="sm"
                        class="h-7 px-2 text-xs"
                        @click="resolve(a)"
                      >
                        Resolve
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </template>
              <TableRow v-else>
                <TableCell colspan="8" class="text-center py-10 text-muted-foreground text-xs">
                  <CheckCircle2 class="w-7 h-7 text-emerald-600 mx-auto mb-2 opacity-70" />
                  <template v-if="isLoading">Loading alerts…</template>
                  <template v-else>No alerts match the current filters — all deals look healthy.</template>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  </WorkspaceLayout>
</template>
