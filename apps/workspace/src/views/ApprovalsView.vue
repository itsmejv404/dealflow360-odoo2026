<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout.vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiRequest } from '@/lib/api';
import { formatCurrency, marginTone } from '@/lib/currency';
import { getSocket } from '@/lib/socket';
import RiskScoreBadge from '@/components/quotations/RiskScoreBadge.vue';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  MessageSquareQuote,
  RefreshCw,
} from 'lucide-vue-next';

const router = useRouter();

const loading = ref(true);
const loadError = ref<string | null>(null);
const pendingRequests = ref<any[]>([]);
const currentTab = ref<'all' | 'manager' | 'finance'>('all');

const actionModalOpen = ref(false);
const actionType = ref<'approve' | 'reject'>('approve');
const selectedRequest = ref<any>(null);
const actionReason = ref('');
const submittingAction = ref(false);
const actionError = ref('');

async function fetchPendingApprovals() {
  loading.value = true;
  loadError.value = null;
  try {
    const data = await apiRequest<{ requests: any[] }>('/api/approvals/pending');
    pendingRequests.value = data?.requests || [];
  } catch (err: any) {
    loadError.value = err.message || 'Failed to load pending approvals';
  } finally {
    loading.value = false;
  }
}

function openActionModal(request: any, type: 'approve' | 'reject') {
  selectedRequest.value = request;
  actionType.value = type;
  actionReason.value = '';
  actionError.value = '';
  actionModalOpen.value = true;
}

async function handleActionSubmit() {
  if (!actionReason.value.trim()) {
    actionError.value = 'A mandatory explanation reason is required.';
    return;
  }

  submittingAction.value = true;
  actionError.value = '';

  try {
    const endpoint = `/api/approvals/${actionType.value}/${selectedRequest.value.quotationId}`;
    await apiRequest(endpoint, {
      method: 'POST',
      data: { reason: actionReason.value.trim() },
    });

    actionModalOpen.value = false;
    await fetchPendingApprovals();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to process request';
  } finally {
    submittingAction.value = false;
  }
}

const filteredRequests = computed(() => {
  if (currentTab.value === 'all') return pendingRequests.value;
  return pendingRequests.value.filter((r) => r.stage === currentTab.value);
});

onMounted(async () => {
  await fetchPendingApprovals();

  const socket = getSocket();
  socket.on('approvals:updated', () => {
    fetchPendingApprovals();
  });
  socket.on('quote:status_changed', () => {
    fetchPendingApprovals();
  });
});

onUnmounted(() => {
  const socket = getSocket();
  socket.off('approvals:updated');
  socket.off('quote:status_changed');
});
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <ShieldAlert class="w-6 h-6 text-primary" />
            Approval Management & Inbox
          </h1>
          <p class="text-sm text-muted-foreground mt-1">
            Review and action quotations that need a discount review before approval.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="fetchPendingApprovals" :disabled="loading">
            <RefreshCw class="w-4 h-4 mr-1.5" :class="{ 'animate-spin': loading }" />
            Refresh
          </Button>
        </div>
      </div>

      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-1.5 bg-muted p-1 rounded-lg border border-border">
          <Button
            size="sm"
            variant="ghost"
            class="h-8 text-xs font-medium"
            :class="{ '!bg-background !text-foreground shadow-xs font-semibold': currentTab === 'all' }"
            @click="currentTab = 'all'"
          >
            All Pending ({{ pendingRequests.length }})
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-8 text-xs font-medium"
            :class="{ '!bg-background !text-foreground shadow-xs font-semibold': currentTab === 'manager' }"
            @click="currentTab = 'manager'"
          >
            Manager Stage ({{ pendingRequests.filter((r) => r.stage === 'manager').length }})
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-8 text-xs font-medium"
            :class="{ '!bg-background !text-foreground shadow-xs font-semibold': currentTab === 'finance' }"
            @click="currentTab = 'finance'"
          >
            Finance Stage ({{ pendingRequests.filter((r) => r.stage === 'finance').length }})
          </Button>
        </div>
      </div>

      <div v-if="loadError" class="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-start gap-2">
        <XCircle class="w-4 h-4 shrink-0 mt-0.5" />
        <span>{{ loadError }}</span>
        <Button variant="ghost" size="sm" class="h-5 ml-auto text-xs" @click="fetchPendingApprovals">
          Retry
        </Button>
      </div>

      <div v-if="loading" class="text-center py-16">
        <RefreshCw class="w-8 h-8 animate-spin mx-auto text-muted-foreground mb-3" />
        <p class="text-sm text-muted-foreground">Loading approval requests...</p>
      </div>

      <div v-else-if="filteredRequests.length === 0" class="text-center py-16 border rounded-xl bg-card border-dashed">
        <CheckCircle2 class="w-12 h-12 text-emerald-500 mx-auto mb-3" />
        <h3 class="text-base font-semibold text-foreground">Inbox is all clear!</h3>
        <p class="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          No quotations are currently awaiting review at this stage.
        </p>
      </div>

      <div v-else class="grid grid-cols-1 gap-4">
        <Card
          v-for="req in filteredRequests"
          :key="req.id"
          class="border-border hover:border-primary/40 transition-colors shadow-xs"
        >
          <CardHeader class="pb-3">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div class="flex items-center gap-3 flex-wrap">
                <span class="font-bold text-base text-foreground font-mono">
                  {{ req.quotation?.quotationNumber }}
                </span>
                <Badge
                  :variant="req.stage === 'finance' ? 'destructive' : 'outline'"
                  class="text-xs uppercase font-semibold"
                  :class="req.stage === 'finance' ? 'bg-purple-600 text-white border-purple-700' : 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300'"
                >
                  {{ req.stage === 'finance' ? 'Finance Escalation' : 'Manager Review' }}
                </Badge>
                <RiskScoreBadge
                  v-if="req.quotation?.riskScore !== undefined"
                  :risk-score="Number(req.quotation.riskScore)"
                  :risk-level="req.quotation.riskLevel"
                  :approval-routing="req.quotation.approvalRouting"
                />
              </div>

              <div class="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                <Clock class="w-3.5 h-3.5" />
                {{ new Date(req.createdAt).toLocaleString() }}
              </div>
            </div>

            <CardDescription class="text-xs text-muted-foreground mt-1">
              Customer: <strong class="text-foreground">{{ req.quotation?.customer?.name }}</strong> ({{ req.quotation?.tier?.name }} Tier) · Rep: <strong class="text-foreground">{{ req.requestedBy?.name || req.requestedBy?.email }}</strong>
            </CardDescription>
          </CardHeader>

          <CardContent class="space-y-4 pt-0">
            <div class="p-3 rounded-lg bg-muted/60 border border-border text-xs">
              <div class="flex items-start gap-2">
                <MessageSquareQuote class="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <span class="font-semibold text-foreground">Submission Context & Reason:</span>
                  <p class="text-muted-foreground mt-0.5">{{ req.reason || 'Discount rules require a review before approval.' }}</p>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-card border text-center text-xs">
              <div>
                <span class="text-muted-foreground block text-2xs uppercase">Gross Subtotal</span>
                <span class="font-semibold text-foreground font-mono text-sm">
                  {{ formatCurrency(req.quotation?.subtotal) }}
                </span>
              </div>
              <div>
                <span class="text-muted-foreground block text-2xs uppercase">Order Discount</span>
                <span class="font-semibold text-destructive font-mono text-sm">
                  -{{ Number(req.quotation?.orderDiscountPercent || 0) }}%
                </span>
              </div>
              <div>
                <span class="text-muted-foreground block text-2xs uppercase">Total Quoted</span>
                <span class="font-bold text-foreground font-mono text-sm">
                  {{ formatCurrency(req.quotation?.totalAmount) }}
                </span>
              </div>
              <div>
                <span class="text-muted-foreground block text-2xs uppercase">Profit Margin</span>
                <span
                  class="font-bold font-mono text-sm"
                  :class="marginTone(Number(req.quotation?.totalMarginPercent || 0)).text"
                >
                  {{ Number(req.quotation?.totalMarginPercent || 0) }}%
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between pt-2 border-t border-border flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                class="text-xs"
                @click="router.push(`/quotations/${req.quotationId}`)"
              >
                <ExternalLink class="w-3.5 h-3.5 mr-1" />
                View Full Quotation
              </Button>

              <div class="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  class="text-xs font-semibold"
                  @click="openActionModal(req, 'reject')"
                >
                  <XCircle class="w-4 h-4 mr-1.5" />
                  Reject Quote
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  class="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                  @click="openActionModal(req, 'approve')"
                >
                  <CheckCircle2 class="w-4 h-4 mr-1.5" />
                  {{ req.stage === 'manager' && req.quotation?.approvalRouting === 'manager_finance' ? 'Approve & Escalate to Finance' : 'Approve Quotation' }}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog :open="actionModalOpen" @update:open="actionModalOpen = $event">
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <component
                :is="actionType === 'approve' ? CheckCircle2 : XCircle"
                class="w-5 h-5"
                :class="actionType === 'approve' ? 'text-emerald-600' : 'text-destructive'"
              />
              {{ actionType === 'approve' ? 'Approve Quotation Terms' : 'Reject Quotation' }}
            </DialogTitle>
            <DialogDescription class="text-xs text-muted-foreground">
              Quotation <strong class="text-foreground">{{ selectedRequest?.quotation?.quotationNumber }}</strong> ({{ selectedRequest?.quotation?.customer?.name }}).
              An immutable audit log and notification email will be dispatched.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-4 py-2">
            <div class="space-y-2">
              <Label class="text-xs font-semibold">
                Reason (required) <span class="text-destructive">*</span>
              </Label>
              <Textarea
                v-model="actionReason"
                rows="3"
                placeholder="Provide mandatory business context or reason for this decision..."
                class="text-xs"
              />
            </div>

            <div v-if="actionError" class="p-2 rounded bg-destructive/10 text-destructive text-xs">
              {{ actionError }}
            </div>
          </div>

          <DialogFooter class="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" @click="actionModalOpen = false" :disabled="submittingAction">
              Cancel
            </Button>
            <Button
              :variant="actionType === 'approve' ? 'default' : 'destructive'"
              size="sm"
              :class="actionType === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''"
              :disabled="submittingAction || !actionReason.trim()"
              @click="handleActionSubmit"
            >
              <RefreshCw v-if="submittingAction" class="w-4 h-4 mr-1.5 animate-spin" />
              Confirm {{ actionType === 'approve' ? 'Approval' : 'Rejection' }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </WorkspaceLayout>
</template>

