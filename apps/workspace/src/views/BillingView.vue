<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { getSocket } from '@/lib/socket';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout.vue';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Receipt,
  CreditCard,
  Calendar,
  Layers,
  ArrowUpRight,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  Percent,
  DollarSign,
  FileText,
  RefreshCw,
  Sliders,
  Plus,
  Download,
  FileSpreadsheet,
} from 'lucide-vue-next';
import { invoiceStatusLabel, invoiceTypeLabel, billingLabel } from '@/lib/labels';

const route = useRoute();
const router = useRouter();

interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  subtotal: number;
  totalAmount: number;
  periodStart?: string | null;
  periodEnd?: string | null;
}

interface InvoiceSurcharge {
  id: string;
  label: string;
  kind: 'amount' | 'percent';
  value: number;
  computedAmount: number;
}

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  type: 'one_time' | 'subscription_cycle' | 'proration_adjustment';
  status: 'draft' | 'issued' | 'paid' | 'partially_refunded' | 'refunded' | 'void';
  currency: string;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  amountPaid: number;
  amountRefunded: number;
  dueDate: string;
  issuedAt: string;
  paidAt?: string | null;
  notes?: string | null;
  quotation?: { quotationNumber: string; customer?: { name: string; email: string } };
  subscription?: { subscriptionNumber: string; name: string };
  lines?: InvoiceLine[];
  surcharges?: InvoiceSurcharge[];
}

interface BillingScheduleRecord {
  id: string;
  periodNumber: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  expectedAmount: number;
  currency: string;
  status: 'pending' | 'invoiced' | 'paid' | 'skipped';
  invoiceId?: string | null;
  invoice?: { id: string; invoiceNumber: string; status: string; totalAmount: number };
}

interface SubscriptionRecord {
  id: string;
  subscriptionNumber: string;
  name: string;
  billingFrequency: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  recurringAmount: number;
  currency: string;
  status: string;
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingDate: string;
  customer?: { id: string; name: string; email: string };
  quotation?: { id: string; quotationNumber: string };
  schedules?: BillingScheduleRecord[];
}

interface CreditNoteRecord {
  id: string;
  creditNoteNumber: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  createdAt: string;
  invoice?: { invoiceNumber: string };
}

const activeTab = ref('invoices');
const isLoading = ref(true);
const invoices = ref<InvoiceRecord[]>([]);
const subscriptions = ref<SubscriptionRecord[]>([]);
const creditNotes = ref<CreditNoteRecord[]>([]);
const filterInvoiceStatus = ref<string>('all');
const filterInvoiceType = ref<string>('all');

// Invoice Details Modal
const selectedInvoice = ref<InvoiceRecord | null>(null);
const isInvoiceDetailOpen = ref(false);

// Additional charges (surcharges) — rep/manager/finance/org admin
const canManageSurcharges = computed(() =>
  ['org_admin', 'manager', 'finance', 'rep'].includes(authStore.state.user?.role || '')
);
const surchargeForm = ref({ label: '', kind: 'amount' as 'amount' | 'percent', value: 0 });
const isSurchargeBusy = ref(false);

async function openInvoiceDetails(inv: InvoiceRecord) {
  selectedInvoice.value = inv;
  isInvoiceDetailOpen.value = true;
  // Refresh surcharges from the detailed record
  try {
    const fresh = await apiRequest<{ data: InvoiceRecord }>(`/api/billing/invoices/${inv.id}`);
    if (selectedInvoice.value?.id === inv.id) {
      selectedInvoice.value = { ...inv, ...fresh.data };
    }
  } catch {
    // Fall back to the list record
  }
}

async function addSurcharge() {
  if (!selectedInvoice.value) return;
  if (!surchargeForm.value.label.trim() || !(surchargeForm.value.value > 0)) {
    alert('Enter a label and a value greater than zero.');
    return;
  }
  isSurchargeBusy.value = true;
  try {
    await apiRequest(`/api/billing/invoices/${selectedInvoice.value.id}/surcharges`, {
      method: 'POST',
      data: {
        label: surchargeForm.value.label.trim(),
        kind: surchargeForm.value.kind,
        value: Number(surchargeForm.value.value),
      },
    });
    surchargeForm.value = { label: '', kind: 'amount', value: 0 };
    const fresh = await apiRequest<{ data: InvoiceRecord }>(`/api/billing/invoices/${selectedInvoice.value.id}`);
    selectedInvoice.value = fresh.data;
    await loadBillingData();
  } catch (err: any) {
    alert(err?.message || 'Failed to add the charge');
  } finally {
    isSurchargeBusy.value = false;
  }
}

async function removeSurcharge(surchargeId: string) {
  if (!selectedInvoice.value) return;
  try {
    await apiRequest(`/api/billing/invoices/${selectedInvoice.value.id}/surcharges/${surchargeId}`, {
      method: 'DELETE',
    });
    const fresh = await apiRequest<{ data: InvoiceRecord }>(`/api/billing/invoices/${selectedInvoice.value.id}`);
    selectedInvoice.value = fresh.data;
    await loadBillingData();
  } catch (err: any) {
    alert(err?.message || 'Failed to remove the charge');
  }
}

async function downloadInvoicePdf(inv: InvoiceRecord) {
  try {
    const res = await fetch(`/api/files/invoices/${inv.id}/pdf?download=true`, {
      headers: {
        Authorization: `Bearer ${authStore.state.token}`,
      },
    });
    if (!res.ok) throw new Error(`PDF request failed (${res.status})`);
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition');
    let fileName = `invoice-${inv.invoiceNumber}.pdf`;
    if (disposition && disposition.includes('filename=')) {
      fileName = disposition.split('filename=')[1]?.replace(/["']/g, '') || fileName;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: any) {
    alert(err?.message || 'Failed to download the invoice PDF');
  }
}

// Export Sales Activities CSV Modal
const isExportCsvDialogOpen = ref(false);
const exportStartDate = ref('');
const exportEndDate = ref('');
const exportActivityType = ref('all');
const isExportingCsv = ref(false);

function setExportDatePreset(preset: '7days' | '30days' | 'thisMonth' | 'all') {
  const now = new Date();
  if (preset === '7days') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    exportStartDate.value = d.toISOString().split('T')[0]!;
    exportEndDate.value = now.toISOString().split('T')[0]!;
  } else if (preset === '30days') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    exportStartDate.value = d.toISOString().split('T')[0]!;
    exportEndDate.value = now.toISOString().split('T')[0]!;
  } else if (preset === 'thisMonth') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    exportStartDate.value = start.toISOString().split('T')[0]!;
    exportEndDate.value = now.toISOString().split('T')[0]!;
  } else {
    exportStartDate.value = '';
    exportEndDate.value = '';
  }
}

async function triggerSalesCsvExport() {
  try {
    isExportingCsv.value = true;
    const params = new URLSearchParams();
    if (exportStartDate.value) params.set('startDate', exportStartDate.value);
    if (exportEndDate.value) params.set('endDate', exportEndDate.value);
    if (exportActivityType.value && exportActivityType.value !== 'all') {
      params.set('type', exportActivityType.value);
    }
    params.set('download', 'true');

    const res = await fetch(`/api/billing/export/sales-activities/csv?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${authStore.state.token}`,
      },
    });
    if (!res.ok) throw new Error(`Export failed with status ${res.status}`);
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition');
    let fileName = 'sales-activities-export.csv';
    if (disposition && disposition.includes('filename=')) {
      fileName = disposition.split('filename=')[1]?.replace(/["']/g, '') || fileName;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    isExportCsvDialogOpen.value = false;
  } catch (err: any) {
    alert(err?.message || 'Failed to export sales activities');
  } finally {
    isExportingCsv.value = false;
  }
}

// Proration Modal (Phase 19)
const isProrateDialogOpen = ref(false);
const selectedSubscriptionForProrate = ref<SubscriptionRecord | null>(null);
const newQtyInput = ref(1);
const prorationReason = ref('');
const isProrateCalculating = ref(false);
const prorationPreviewData = ref<any>(null);
const isProrateSubmitting = ref(false);

// Payment Modal (Phase 20)
const isPaymentDialogOpen = ref(false);
const invoiceToPay = ref<InvoiceRecord | null>(null);
const isPaymentBusy = ref(false);

// Gateway Config (Phase 20)
const isGatewayDialogOpen = ref(false);
const gatewayApiKey = ref('');
const gatewayWebhookSecret = ref('');
const isGatewaySaving = ref(false);

const currencySymbol = computed(() => authStore.state.organization?.currency || 'USD');

function formatMoney(amount: number | string | undefined, curr?: string) {
  const num = Number(amount || 0);
  const code = curr || currencySymbol.value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code.length === 3 ? code : 'USD',
  }).format(num);
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const totalInvoicedAmount = computed(() =>
  invoices.value.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)
);

const totalPaidAmount = computed(() =>
  invoices.value
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)
);

const totalOutstandingAmount = computed(() =>
  invoices.value
    .filter((inv) => inv.status === 'issued')
    .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)
);

const filteredInvoices = computed(() => {
  return invoices.value.filter((inv) => {
    if (filterInvoiceStatus.value !== 'all' && inv.status !== filterInvoiceStatus.value) {
      return false;
    }
    if (filterInvoiceType.value !== 'all' && inv.type !== filterInvoiceType.value) {
      return false;
    }
    return true;
  });
});

async function loadBillingData() {
  isLoading.value = true;
  try {
    const [invList, subList, cnList] = await Promise.all([
      apiRequest<InvoiceRecord[]>('/api/billing/invoices'),
      apiRequest<SubscriptionRecord[]>('/api/billing/subscriptions'),
      apiRequest<CreditNoteRecord[]>('/api/billing/credit-notes').catch(() => []),
    ]);
    invoices.value = invList || [];
    subscriptions.value = subList || [];
    creditNotes.value = cnList || [];
  } catch (err: any) {
    console.error('Failed to load billing data:', err);
  } finally {
    isLoading.value = false;
  }
}


// Phase 19: Proration Preview & Action
async function openProrateDialog(sub: SubscriptionRecord) {
  selectedSubscriptionForProrate.value = sub;
  newQtyInput.value = sub.quantity;
  prorationReason.value = '';
  prorationPreviewData.value = null;
  isProrateDialogOpen.value = true;
  await calculateProrationPreview();
}

async function calculateProrationPreview() {
  if (!selectedSubscriptionForProrate.value) return;
  isProrateCalculating.value = true;
  try {
    const res = await apiRequest<any>(
      `/api/billing/subscriptions/${selectedSubscriptionForProrate.value.id}/proration-preview?newQuantity=${newQtyInput.value}`
    );
    prorationPreviewData.value = res;
  } catch (err) {
    prorationPreviewData.value = null;
  } finally {
    isProrateCalculating.value = false;
  }
}

watch(newQtyInput, () => {
  calculateProrationPreview();
});

async function submitProration() {
  if (!selectedSubscriptionForProrate.value) return;
  isProrateSubmitting.value = true;
  try {
    await apiRequest(
      `/api/billing/subscriptions/${selectedSubscriptionForProrate.value.id}/modify-quantity`,
      {
        method: 'POST',
        data: {
          newQuantity: Number(newQtyInput.value),
          reason: prorationReason.value || 'Mid-cycle seat adjustment',
        },
      }
    );
    isProrateDialogOpen.value = false;
    await loadBillingData();
  } catch (err: any) {
    alert(err.message || 'Failed to apply proration');
  } finally {
    isProrateSubmitting.value = false;
  }
}

// Phase 20: Payment dialog
function openPayDialog(inv: InvoiceRecord) {
  invoiceToPay.value = inv;
  isPaymentDialogOpen.value = true;
}

async function submitPayment() {
  if (!invoiceToPay.value) return;
  isPaymentBusy.value = true;
  try {
    await apiRequest(`/api/billing/invoices/${invoiceToPay.value.id}/pay`, {
      method: 'POST',
      data: {
        paymentMethod: 'credit_card',
      },
    });
    isPaymentDialogOpen.value = false;
    await loadBillingData();
  } catch (err: any) {
    alert(err.message || 'Payment processing failed');
  } finally {
    isPaymentBusy.value = false;
  }
}

async function submitRefund(cn: CreditNoteRecord) {
  if (!confirm(`Process refund of ${formatMoney(cn.amount, cn.currency)} for credit note ${cn.creditNoteNumber}?`)) {
    return;
  }
  try {
    await apiRequest(`/api/billing/credit-notes/${cn.id}/refund`, {
      method: 'POST',
      data: { paymentMethod: 'credit_card' },
    });
    await loadBillingData();
  } catch (err: any) {
    alert(err.message || 'Refund failed');
  }
}

// Real-time socket listener
let socket: any = null;
onMounted(async () => {
  await loadBillingData();

  socket = getSocket();
  if (socket) {
    socket.on('billing:updated', () => loadBillingData());
    socket.on('billing:prorated', () => loadBillingData());
  }
});

onUnmounted(() => {
  if (socket) {
    socket.off('billing:updated');
    socket.off('billing:prorated');
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
            <Receipt class="w-6 h-6 text-primary" />
            Billing & Invoicing
          </h1>
          <p class="text-sm text-muted-foreground mt-1">
            Manage invoices, subscription schedules, payments, and credit notes.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="h-9 gap-1.5" @click="isExportCsvDialogOpen = true">
            <FileSpreadsheet class="w-3.5 h-3.5 text-emerald-600" />
            Export Sales Activity (.csv)
          </Button>
          <Button variant="outline" size="sm" class="h-9 gap-1.5" @click="loadBillingData">
            <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': isLoading }" />
            Refresh
          </Button>
        </div>
      </div>

      <!-- KPI Summary Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card class="border-border bg-card shadow-xs">
          <CardContent class="p-4 flex items-center justify-between">
            <div>
              <p class="text-xs font-medium text-muted-foreground">Total Invoiced</p>
              <p class="text-xl font-bold text-foreground mt-0.5">
                {{ formatMoney(totalInvoicedAmount) }}
              </p>
            </div>
            <div class="p-2.5 rounded-lg bg-primary/10 text-primary">
              <Receipt class="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card class="border-border bg-card shadow-xs">
          <CardContent class="p-4 flex items-center justify-between">
            <div>
              <p class="text-xs font-medium text-muted-foreground">Collected / Paid</p>
              <p class="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {{ formatMoney(totalPaidAmount) }}
              </p>
            </div>
            <div class="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 class="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card class="border-border bg-card shadow-xs">
          <CardContent class="p-4 flex items-center justify-between">
            <div>
              <p class="text-xs font-medium text-muted-foreground">Outstanding Due</p>
              <p class="text-xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                {{ formatMoney(totalOutstandingAmount) }}
              </p>
            </div>
            <div class="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock class="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card class="border-border bg-card shadow-xs">
          <CardContent class="p-4 flex items-center justify-between">
            <div>
              <p class="text-xs font-medium text-muted-foreground">Active Subscriptions</p>
              <p class="text-xl font-bold text-foreground mt-0.5">
                {{ subscriptions.filter((s) => s.status === 'active').length }}
              </p>
            </div>
            <div class="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Layers class="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Main Tabs -->
      <Tabs v-model="activeTab" class="space-y-4">
        <TabsList class="bg-muted/70 p-1 border border-border">
          <TabsTrigger value="invoices" class="gap-1.5 text-xs sm:text-sm">
            <Receipt class="w-4 h-4" />
            Invoices
            <Badge variant="secondary" class="ml-1 px-1.5 py-0 text-2xs">
              {{ invoices.length }}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="subscriptions" class="gap-1.5 text-xs sm:text-sm">
            <Layers class="w-4 h-4" />
            Subscriptions
            <Badge variant="secondary" class="ml-1 px-1.5 py-0 text-2xs">
              {{ subscriptions.length }}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="schedules" class="gap-1.5 text-xs sm:text-sm">
            <Calendar class="w-4 h-4" />
            Billing Schedules
          </TabsTrigger>
          <TabsTrigger value="credit_notes" class="gap-1.5 text-xs sm:text-sm">
            <FileText class="w-4 h-4" />
            Credit Notes
            <Badge variant="secondary" class="ml-1 px-1.5 py-0 text-2xs">
              {{ creditNotes.length }}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <!-- Tab 1: Invoices -->
        <TabsContent value="invoices" class="space-y-4">
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle class="text-base font-semibold">Tenant Invoices</CardTitle>
                  <CardDescription class="text-xs">
                    One-time invoices, recurring cycle invoices, and proration credit adjustments.
                  </CardDescription>
                </div>
                <div class="flex items-center gap-2">
                  <select
                    v-model="filterInvoiceStatus"
                    class="h-8 text-xs bg-background border border-border rounded-md px-2 text-foreground focus:outline-hidden"
                  >
                    <option value="all">All Statuses</option>
                    <option value="issued">Issued / Due</option>
                    <option value="paid">Paid</option>
                    <option value="partially_refunded">Partially Refunded</option>
                    <option value="refunded">Refunded</option>
                  </select>
                  <select
                    v-model="filterInvoiceType"
                    class="h-8 text-xs bg-background border border-border rounded-md px-2 text-foreground focus:outline-hidden"
                  >
                    <option value="all">All Types</option>
                    <option value="one_time">One-Time Products</option>
                    <option value="subscription_cycle">Subscription Cycle</option>
                    <option value="proration_adjustment">Proration Adjustment</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent class="p-0">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/40 text-2xs uppercase">
                    <TableHead class="font-semibold">Invoice #</TableHead>
                    <TableHead class="font-semibold">Type</TableHead>
                    <TableHead class="font-semibold">Quotation / Customer</TableHead>
                    <TableHead class="font-semibold">Issued Date</TableHead>
                    <TableHead class="font-semibold">Due Date</TableHead>
                    <TableHead class="font-semibold text-right">Total Amount</TableHead>
                    <TableHead class="font-semibold text-center">Status</TableHead>
                    <TableHead class="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <template v-if="filteredInvoices.length > 0">
                    <TableRow
                      v-for="inv in filteredInvoices"
                      :key="inv.id"
                      class="hover:bg-muted/30 transition-colors"
                    >
                      <TableCell class="font-mono font-medium text-xs text-foreground">
                        {{ inv.invoiceNumber }}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" class="text-2xs font-normal">
                          {{ invoiceTypeLabel(inv.type) }}
                        </Badge>
                      </TableCell>
                      <TableCell class="text-xs">
                        <div class="font-medium text-foreground">
                          {{ inv.quotation?.customer?.name || 'Customer' }}
                        </div>
                        <div class="text-2xs text-muted-foreground font-mono">
                          {{ inv.quotation?.quotationNumber }}
                        </div>
                      </TableCell>
                      <TableCell class="text-xs text-muted-foreground">
                        {{ formatDate(inv.issuedAt) }}
                      </TableCell>
                      <TableCell class="text-xs text-muted-foreground">
                        {{ formatDate(inv.dueDate) }}
                      </TableCell>
                      <TableCell class="text-xs font-semibold text-right text-foreground">
                        {{ formatMoney(inv.totalAmount, inv.currency) }}
                      </TableCell>
                      <TableCell class="text-center">
                        <Badge
                          variant="outline"
                          class="text-2xs"
                          :class="invoiceStatusLabel(inv.status).class"
                        >
                          {{ invoiceStatusLabel(inv.status).label }}
                        </Badge>
                      </TableCell>
                      <TableCell class="text-right">
                        <div class="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            class="h-7 px-2 text-xs"
                            @click="openInvoiceDetails(inv)"
                          >
                            Details
                          </Button>
                          <Button
                            v-if="inv.status === 'issued'"
                            variant="outline"
                            size="sm"
                            class="h-7 px-2 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                            @click="openPayDialog(inv)"
                          >
                            <CreditCard class="w-3 h-3 mr-1" />
                            Record Payment
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  </template>
                  <TableRow v-else>
                    <TableCell colspan="8" class="text-center py-8 text-muted-foreground text-xs">
                      No invoices found matching current filters.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Tab 2: Subscriptions -->
        <TabsContent value="subscriptions" class="space-y-4">
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <CardTitle class="text-base font-semibold">Recurring Subscriptions</CardTitle>
              <CardDescription class="text-xs">
                Active recurring items with schedule tracking and mid-cycle seat proration.
              </CardDescription>
            </CardHeader>
            <CardContent class="p-0">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/40 text-2xs uppercase">
                    <TableHead class="font-semibold">Subscription #</TableHead>
                    <TableHead class="font-semibold">Product / Plan</TableHead>
                    <TableHead class="font-semibold">Customer</TableHead>
                    <TableHead class="font-semibold">Cadence</TableHead>
                    <TableHead class="font-semibold text-center">Quantity</TableHead>
                    <TableHead class="font-semibold text-right">Recurring Rate</TableHead>
                    <TableHead class="font-semibold">Current Cycle End</TableHead>
                    <TableHead class="font-semibold text-center">Status</TableHead>
                    <TableHead class="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <template v-if="subscriptions.length > 0">
                    <TableRow
                      v-for="sub in subscriptions"
                      :key="sub.id"
                      class="hover:bg-muted/30 transition-colors"
                    >
                      <TableCell class="font-mono font-medium text-xs text-foreground">
                        {{ sub.subscriptionNumber }}
                      </TableCell>
                      <TableCell class="text-xs font-medium text-foreground">
                        {{ sub.name }}
                      </TableCell>
                      <TableCell class="text-xs text-muted-foreground">
                        {{ sub.customer?.name || 'Customer' }}
                      </TableCell>
                      <TableCell class="text-xs">
                        <Badge variant="outline" class="text-2xs">
                          {{ billingLabel(sub.billingFrequency) }}
                        </Badge>
                      </TableCell>
                      <TableCell class="text-xs text-center font-bold text-foreground">
                        {{ sub.quantity }}
                      </TableCell>
                      <TableCell class="text-xs font-semibold text-right text-foreground">
                        {{ formatMoney(sub.recurringAmount, sub.currency) }}
                      </TableCell>
                      <TableCell class="text-xs text-muted-foreground">
                        {{ formatDate(sub.currentPeriodEnd) }}
                      </TableCell>
                      <TableCell class="text-center">
                        <Badge
                          variant="outline"
                          class="text-2xs bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300 uppercase"
                        >
                          {{ sub.status }}
                        </Badge>
                      </TableCell>
                      <TableCell class="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-7 px-2 text-xs"
                          @click="openProrateDialog(sub)"
                        >
                          <Sliders class="w-3 h-3 mr-1 text-primary" />
                          Modify Qty
                        </Button>
                      </TableCell>
                    </TableRow>
                  </template>
                  <TableRow v-else>
                    <TableCell colspan="9" class="text-center py-8 text-muted-foreground text-xs">
                      No active recurring subscriptions found. Confirm a quotation with subscription lines to generate subscriptions.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Tab 3: Billing Schedules -->
        <TabsContent value="schedules" class="space-y-4">
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <CardTitle class="text-base font-semibold">Multi-Period Billing Schedules</CardTitle>
              <CardDescription class="text-xs">
                Generated schedules per subscription plan and cadence.
              </CardDescription>
            </CardHeader>
            <CardContent class="p-0">
              <div v-if="subscriptions.length === 0" class="text-center py-8 text-muted-foreground text-xs">
                No billing schedules available.
              </div>
              <div v-else class="divide-y divide-border">
                <div
                  v-for="sub in subscriptions"
                  :key="sub.id"
                  class="p-4 space-y-3"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <span class="font-semibold text-sm text-foreground">{{ sub.name }}</span>
                      <span class="font-mono text-2xs text-muted-foreground ml-2">({{ sub.subscriptionNumber }})</span>
                    </div>
                    <Badge variant="outline" class="text-2xs">
                      {{ billingLabel(sub.billingFrequency) }} · {{ sub.schedules?.length || 0 }} periods
                    </Badge>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <div
                      v-for="sched in sub.schedules"
                      :key="sched.id"
                      class="p-2.5 rounded-lg border text-xs flex flex-col justify-between gap-1"
                      :class="sched.status === 'invoiced'
                        ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900'
                        : 'bg-muted/20 border-border'"
                    >
                      <div class="flex items-center justify-between">
                        <span class="font-semibold text-2xs text-muted-foreground">Period {{ sched.periodNumber }}</span>
                        <Badge
                          variant="outline"
                          class="text-3xs uppercase"
                          :class="sched.status === 'invoiced' ? 'border-blue-300 text-blue-600' : 'text-muted-foreground'"
                        >
                          {{ sched.status }}
                        </Badge>
                      </div>
                      <div class="font-medium text-foreground">
                        {{ formatDate(sched.periodStart) }} – {{ formatDate(sched.periodEnd) }}
                      </div>
                      <div class="flex items-center justify-between text-2xs pt-1 border-t border-border/50">
                        <span class="text-muted-foreground">Due: {{ formatDate(sched.dueDate) }}</span>
                        <span class="font-bold text-foreground">{{ formatMoney(sched.expectedAmount, sched.currency) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Tab 4: Credit Notes (Phase 19) -->
        <TabsContent value="credit_notes" class="space-y-4">
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <CardTitle class="text-base font-semibold">Credit Notes & Adjustments</CardTitle>
              <CardDescription class="text-xs">
                Generated from mid-cycle subscription downgrades, order cancellations, or partial refunds.
              </CardDescription>
            </CardHeader>
            <CardContent class="p-0">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/40 text-2xs uppercase">
                    <TableHead class="font-semibold">Credit Note #</TableHead>
                    <TableHead class="font-semibold">Related Invoice</TableHead>
                    <TableHead class="font-semibold">Created Date</TableHead>
                    <TableHead class="font-semibold">Reason</TableHead>
                    <TableHead class="font-semibold text-right">Amount</TableHead>
                    <TableHead class="font-semibold text-center">Status</TableHead>
                    <TableHead class="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <template v-if="creditNotes.length > 0">
                    <TableRow v-for="cn in creditNotes" :key="cn.id" class="text-xs">
                      <TableCell class="font-mono font-bold text-foreground">
                        {{ cn.creditNoteNumber }}
                      </TableCell>
                      <TableCell class="font-mono text-muted-foreground text-2xs">
                        {{ cn.invoice?.invoiceNumber || '—' }}
                      </TableCell>
                      <TableCell class="text-muted-foreground text-2xs">
                        {{ formatDate(cn.createdAt) }}
                      </TableCell>
                      <TableCell class="text-muted-foreground text-xs max-w-xs truncate">
                        {{ cn.reason }}
                      </TableCell>
                      <TableCell class="font-mono font-bold text-right text-emerald-600 dark:text-emerald-400">
                        {{ formatMoney(cn.amount, cn.currency) }}
                      </TableCell>
                      <TableCell class="text-center">
                        <Badge
                          variant="outline"
                          class="text-3xs uppercase font-semibold"
                          :class="cn.status === 'refunded'
                            ? 'bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-300'
                            : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300'"
                        >
                          {{ cn.status }}
                        </Badge>
                      </TableCell>
                      <TableCell class="text-right">
                        <Button
                          v-if="cn.status === 'issued'"
                          size="sm"
                          variant="outline"
                          class="h-7 text-2xs font-medium text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                          @click="submitRefund(cn)"
                        >
                          <RotateCcw class="w-3 h-3 mr-1" />
                          Issue Refund
                        </Button>
                        <span v-else class="text-2xs text-muted-foreground font-mono">
                          {{ cn.status }}
                        </span>
                      </TableCell>
                    </TableRow>
                  </template>
                  <TableRow v-else>
                    <TableCell colspan="7" class="text-center py-8 text-muted-foreground text-xs">
                      No credit notes found. Mid-cycle subscription seat reductions automatically generate credit notes.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      <!-- Invoice Details Dialog -->
      <Dialog v-model:open="isInvoiceDetailOpen">
        <DialogContent class="sm:max-w-4xl max-w-4xl">
          <DialogHeader>
            <DialogTitle class="flex items-center justify-between text-base">
              <span>Invoice {{ selectedInvoice?.invoiceNumber }}</span>
              <Badge
                v-if="selectedInvoice"
                variant="outline"
                :class="invoiceStatusLabel(selectedInvoice.status).class"
              >
                {{ invoiceStatusLabel(selectedInvoice.status).label }}
              </Badge>
            </DialogTitle>
            <DialogDescription class="text-xs">
              {{ selectedInvoice?.notes || 'Invoice itemization' }}
            </DialogDescription>
          </DialogHeader>

          <div v-if="selectedInvoice" class="space-y-4 py-2">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/40 text-xs">
              <div>
                <span class="text-2xs text-muted-foreground block">Customer</span>
                <span class="font-semibold text-foreground">{{ selectedInvoice.quotation?.customer?.name }}</span>
              </div>
              <div>
                <span class="text-2xs text-muted-foreground block">Quotation</span>
                <span class="font-mono text-foreground">{{ selectedInvoice.quotation?.quotationNumber }}</span>
              </div>
              <div>
                <span class="text-2xs text-muted-foreground block">Issued Date</span>
                <span class="text-foreground">{{ formatDate(selectedInvoice.issuedAt) }}</span>
              </div>
              <div>
                <span class="text-2xs text-muted-foreground block">Due Date</span>
                <span class="text-foreground">{{ formatDate(selectedInvoice.dueDate) }}</span>
              </div>
            </div>

            <!-- Line Items Table -->
            <Table>
              <TableHeader>
                <TableRow class="text-2xs uppercase bg-muted/30">
                  <TableHead>Description</TableHead>
                  <TableHead class="text-center">Qty</TableHead>
                  <TableHead class="text-right">Unit Price</TableHead>
                  <TableHead class="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="l in selectedInvoice.lines" :key="l.id" class="text-xs">
                  <TableCell class="font-medium text-foreground">{{ l.description }}</TableCell>
                  <TableCell class="text-center">{{ l.quantity }}</TableCell>
                  <TableCell class="text-right text-muted-foreground">{{ formatMoney(l.unitPrice, selectedInvoice.currency) }}</TableCell>
                  <TableCell class="text-right font-semibold text-foreground">{{ formatMoney(l.totalAmount, selectedInvoice.currency) }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <!-- Additional Charges -->
            <div v-if="selectedInvoice.surcharges && selectedInvoice.surcharges.length > 0" class="space-y-1.5">
              <p class="text-2xs uppercase font-semibold text-muted-foreground">Additional Charges</p>
              <div
                v-for="s in selectedInvoice.surcharges"
                :key="s.id"
                class="flex items-center justify-between text-xs rounded-md border border-border bg-muted/20 px-2.5 py-1.5"
              >
                <span class="text-foreground">
                  {{ s.label }}
                  <span class="text-muted-foreground">({{ s.kind === 'percent' ? `${s.value}%` : formatMoney(s.value, selectedInvoice.currency) }})</span>
                </span>
                <span class="flex items-center gap-2">
                  <span class="font-semibold text-foreground font-mono">{{ formatMoney(s.computedAmount, selectedInvoice.currency) }}</span>
                  <button
                    v-if="canManageSurcharges && selectedInvoice.status !== 'paid' && selectedInvoice.status !== 'void'"
                    class="text-muted-foreground hover:text-destructive"
                    title="Remove charge"
                    @click="removeSurcharge(s.id)"
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>

            <!-- Add charge form -->
            <div v-if="canManageSurcharges && selectedInvoice.status !== 'paid' && selectedInvoice.status !== 'void' && selectedInvoice.status !== 'refunded'" class="rounded-md border border-dashed border-border p-3 space-y-2">
              <p class="text-2xs uppercase font-semibold text-muted-foreground">Add Additional Charge</p>
              <div class="flex flex-col sm:flex-row gap-2">
                <Input v-model="surchargeForm.label" placeholder="e.g. Handling fee, Fuel surcharge" class="h-8 flex-1 text-xs" />
                <select
                  v-model="surchargeForm.kind"
                  class="h-8 text-xs bg-background border border-border rounded-md px-2 text-foreground"
                >
                  <option value="amount">Currency Amount</option>
                  <option value="percent">% of Subtotal</option>
                </select>
                <Input v-model.number="surchargeForm.value" type="number" min="0" step="0.01" placeholder="Value" class="h-8 w-24 text-xs" />
                <Button size="sm" class="h-8" :disabled="isSurchargeBusy" @click="addSurcharge">
                  <Plus class="w-3.5 h-3.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            <div class="flex justify-end pt-2 border-t border-border text-sm font-bold gap-6">
              <span>Total Amount:</span>
              <span class="text-primary font-mono text-base">{{ formatMoney(selectedInvoice.totalAmount, selectedInvoice.currency) }}</span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              :disabled="!selectedInvoice"
              @click="selectedInvoice && downloadInvoicePdf(selectedInvoice)"
            >
              <FileText class="w-3.5 h-3.5 mr-1.5" />
              Download PDF
            </Button>
            <Button variant="outline" size="sm" @click="isInvoiceDetailOpen = false">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Mid-Cycle Proration Dialog (Phase 19) -->
      <Dialog v-model:open="isProrateDialogOpen">
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle class="text-base font-semibold flex items-center gap-2">
              <Sliders class="w-4 h-4 text-primary" />
              Modify Subscription Quantity (Mid-Cycle Proration)
            </DialogTitle>
            <DialogDescription class="text-xs">
              Change seat count mid-cycle. Unused charges are automatically credited via Credit Note, or supplemental adjustment invoiced.
            </DialogDescription>
          </DialogHeader>

          <div v-if="selectedSubscriptionForProrate" class="space-y-4 py-2 text-xs">
            <div class="p-3 rounded-lg bg-muted/40 space-y-1.5">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Subscription:</span>
                <span class="font-semibold text-foreground">{{ selectedSubscriptionForProrate.name }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Current Quantity:</span>
                <span class="font-bold text-foreground">{{ selectedSubscriptionForProrate.quantity }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Current Rate:</span>
                <span class="text-foreground">{{ formatMoney(selectedSubscriptionForProrate.recurringAmount, selectedSubscriptionForProrate.currency) }} / {{ selectedSubscriptionForProrate.billingFrequency }}</span>
              </div>
            </div>

            <div class="space-y-2">
              <Label class="text-xs font-medium">New Quantity</Label>
              <div class="flex items-center gap-3">
                <Input
                  v-model.number="newQtyInput"
                  type="number"
                  min="1"
                  max="1000"
                  class="h-9 w-32 text-center text-sm font-bold"
                />
                <span class="text-2xs text-muted-foreground">
                  (Old: {{ selectedSubscriptionForProrate.quantity }} seats)
                </span>
              </div>
            </div>

            <div class="space-y-2">
              <Label class="text-xs font-medium">Reason for Adjustment</Label>
              <Input
                v-model="prorationReason"
                placeholder="e.g. Downsized team / Added new members"
                class="h-9 text-xs"
              />
            </div>

            <!-- Live Proration Math Preview Card -->
            <div v-if="prorationPreviewData" class="p-3 rounded-lg border text-xs space-y-2" :class="prorationPreviewData.proratedDelta < 0 ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-300' : 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-300'">
              <div class="flex justify-between font-semibold">
                <span>Cycle Math ({{ prorationPreviewData.remainingDays }}/{{ prorationPreviewData.totalCycleDays }} days remaining)</span>
                <Badge :variant="prorationPreviewData.proratedDelta < 0 ? 'default' : 'secondary'" class="text-2xs">
                  {{ prorationPreviewData.proratedDelta < 0 ? 'Credit Note' : 'Adjustment Due' }}
                </Badge>
              </div>

              <div class="flex justify-between text-muted-foreground">
                <span>Proration Delta:</span>
                <span class="font-bold text-sm" :class="prorationPreviewData.proratedDelta < 0 ? 'text-emerald-600' : 'text-primary'">
                  {{ prorationPreviewData.proratedDelta < 0 ? '-' : '+' }}{{ formatMoney(Math.abs(prorationPreviewData.proratedDelta), prorationPreviewData.currency) }}
                </span>
              </div>

              <div class="flex justify-between text-muted-foreground pt-1 border-t border-border/50">
                <span>New Ongoing Recurring:</span>
                <span class="font-semibold text-foreground">
                  {{ formatMoney(prorationPreviewData.newRecurringAmount, prorationPreviewData.currency) }}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" @click="isProrateDialogOpen = false">
              Cancel
            </Button>
            <Button
              size="sm"
              class="bg-primary text-primary-foreground font-semibold"
              :disabled="isProrateSubmitting || newQtyInput === selectedSubscriptionForProrate?.quantity"
              @click="submitProration"
            >
              <RotateCcw v-if="isProrateSubmitting" class="w-3.5 h-3.5 mr-1 animate-spin" />
              Apply Proration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Pay Invoice Modal (Phase 20) -->
      <Dialog v-model:open="isPaymentDialogOpen">
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle class="text-base font-semibold flex items-center gap-2">
              <CreditCard class="w-4 h-4 text-emerald-600" />
              Record Payment
            </DialogTitle>
            <DialogDescription class="text-xs">
              Process payment for invoice {{ invoiceToPay?.invoiceNumber }} via sandbox payment gateway.
            </DialogDescription>
          </DialogHeader>

            <div v-if="invoiceToPay" class="space-y-4 py-2 text-xs">
              <div class="p-3 rounded-lg bg-muted/40 flex justify-between items-center">
                <div>
                  <span class="text-2xs text-muted-foreground block">Amount Due</span>
                  <span class="text-lg font-bold text-foreground">{{ formatMoney(invoiceToPay.totalAmount, invoiceToPay.currency) }}</span>
                </div>
                <Badge variant="outline" :class="invoiceStatusLabel(invoiceToPay.status).class">
                  {{ invoiceStatusLabel(invoiceToPay.status).label }}
                </Badge>
              </div>
            </div>

          <DialogFooter>
            <Button variant="outline" size="sm" @click="isPaymentDialogOpen = false">
              Cancel
            </Button>
            <Button
              size="sm"
              class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              :disabled="isPaymentBusy"
              @click="submitPayment"
            >
              <RotateCcw v-if="isPaymentBusy" class="w-3.5 h-3.5 mr-1 animate-spin" />
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Export Sales Activities Modal -->
      <Dialog v-model:open="isExportCsvDialogOpen">
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle class="text-base font-semibold flex items-center gap-2">
              <FileSpreadsheet class="w-4 h-4 text-emerald-600" />
              Export Sales & Billing Activities
            </DialogTitle>
            <DialogDescription class="text-xs">
              Export sales transactions, invoices, subscriptions, and payments in CSV format.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-4 py-2 text-xs">
            <!-- Quick Date Presets -->
            <div>
              <Label class="text-xs text-muted-foreground block mb-1.5">Quick Presets</Label>
              <div class="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" class="h-7 text-2xs" @click="setExportDatePreset('7days')">Last 7 Days</Button>
                <Button variant="outline" size="sm" class="h-7 text-2xs" @click="setExportDatePreset('30days')">Last 30 Days</Button>
                <Button variant="outline" size="sm" class="h-7 text-2xs" @click="setExportDatePreset('thisMonth')">This Month</Button>
                <Button variant="outline" size="sm" class="h-7 text-2xs" @click="setExportDatePreset('all')">All Time</Button>
              </div>
            </div>

            <!-- Date Range Inputs -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <Label for="export-start-date" class="text-xs">Start Date</Label>
                <Input
                  id="export-start-date"
                  v-model="exportStartDate"
                  type="date"
                  class="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label for="export-end-date" class="text-xs">End Date</Label>
                <Input
                  id="export-end-date"
                  v-model="exportEndDate"
                  type="date"
                  class="mt-1 h-8 text-xs"
                />
              </div>
            </div>

            <!-- Filter Type -->
            <div>
              <Label for="export-activity-type" class="text-xs">Activity Category</Label>
              <select
                id="export-activity-type"
                v-model="exportActivityType"
                class="w-full mt-1 h-8 text-xs bg-background border border-border rounded-md px-2 text-foreground focus:outline-hidden"
              >
                <option value="all">All Sales Activities (Invoices, Subscriptions, Payments, Credit Notes)</option>
                <option value="invoices">Invoices Only</option>
                <option value="subscriptions">Subscriptions Only</option>
                <option value="payments">Payments Only</option>
                <option value="credit_notes">Credit Notes Only</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" @click="isExportCsvDialogOpen = false">
              Cancel
            </Button>
            <Button
              size="sm"
              class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
              :disabled="isExportingCsv"
              @click="triggerSalesCsvExport"
            >
              <RotateCcw v-if="isExportingCsv" class="w-3.5 h-3.5 animate-spin" />
              <Download v-else class="w-3.5 h-3.5" />
              Download CSV Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </WorkspaceLayout>
</template>
