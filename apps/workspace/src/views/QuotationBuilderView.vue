<script setup lang="ts">
import { ref, onMounted, onUnmounted, reactive, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import WorkspaceLayout from '../components/layout/WorkspaceLayout.vue';
import UpsellPanel, { type UpsellSuggestionItem } from '../components/quotations/UpsellPanel.vue';
import RiskScoreBadge from '../components/quotations/RiskScoreBadge.vue';
import AuditTrailTimeline from '../components/quotations/AuditTrailTimeline.vue';
import { apiRequest } from '../lib/api';
import { formatCurrency, marginTone } from '../lib/currency';
import { statusLabel, billingLabel, fulfillmentStatusLabel } from '../lib/labels';
import { getSocket } from '../lib/socket';
import { authStore } from '../lib/auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FileText,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Save,
  User,
  DollarSign,
  Layers,
  Sparkles,
  RotateCcw,
  Tag,
  Radio,
  Send,
  ShieldCheck,
  History,
  XCircle,
  MessagesSquare,
  ArrowLeftRight,
  FileEdit,
  Boxes,
  Pencil,
} from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();

const quoteId = computed(() => (route.params.id && route.params.id !== 'new' ? String(route.params.id) : null));
const isEditMode = computed(() => !!quoteId.value);

interface CustomerTier {
  id: string;
  name: string;
  code: string;
  defaultDiscountPercent: number;
}

interface Customer {
  id: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  address?: string;
  tierId: string;
  tier?: CustomerTier;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  categoryId?: string | null;
  price: number;
  costPrice?: number | null;
  billingFrequency: 'one_time' | 'monthly' | 'quarterly' | 'annual';
  category?: { id: string; name: string; code: string } | null;
}

interface QuotationLineState {
  productId: string;
  product?: Product;
  quantity: number;
  unitPrice: number;
  lineDiscountPercent: number;
  subtotal: number;
  total: number;
  marginAmount: number;
  marginPercent: number;
  appliedCeilingPercent?: number;
  riskDeltaPercent?: number;
  isOverCeiling?: boolean;
  billingFrequency: string;
}

interface QuotationTotals {
  orderDiscountPercent: number;
  orderDiscountAmount: number;
  subtotal: number;
  totalDiscount: number;
  totalAmount: number;
  totalCost: number;
  totalMargin: number;
  totalMarginPercent: number;
  oneTimeTotal: number;
  recurringMonthlyTotal: number;
  recurringAnnualTotal: number;
}

interface RiskState {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  approvalRouting: 'none' | 'manager' | 'manager_finance';
  routingReason: string;
  hasLineOverCeiling: boolean;
  overCeilingLineCount: number;
  totalLines: number;
  lines: any[];
}

// State
const isLoading = ref(true);
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const customers = ref<Customer[]>([]);
const customerTiers = ref<CustomerTier[]>([]);
const availableProducts = ref<Product[]>([]);

const selectedCustomerId = ref<string>('');
const selectedCustomer = computed(() => customers.value.find((c) => c.id === selectedCustomerId.value));
const selectedCustomerTier = computed(() => {
  if (!selectedCustomer.value) return null;
  return customerTiers.value.find((t) => t.id === selectedCustomer.value?.tierId) || selectedCustomer.value?.tier;
});

const quotationNumber = ref<string>('QT-NEW');
const quotationStatus = ref<string>('draft');
const notes = ref<string>('');
const orderDiscountPercent = ref<number>(0);
const lines = ref<QuotationLineState[]>([]);

const totals = reactive<QuotationTotals>({
  orderDiscountPercent: 0,
  orderDiscountAmount: 0,
  subtotal: 0,
  totalDiscount: 0,
  totalAmount: 0,
  totalCost: 0,
  totalMargin: 0,
  totalMarginPercent: 0,
  oneTimeTotal: 0,
  recurringMonthlyTotal: 0,
  recurringAnnualTotal: 0,
});

const risk = reactive<RiskState>({
  riskScore: 0,
  riskLevel: 'low',
  approvalRouting: 'none',
  routingReason: 'All lines comply with rulebook ceilings.',
  hasLineOverCeiling: false,
  overCeilingLineCount: 0,
  totalLines: 0,
  lines: [],
});

// Upsell / Cross-Sell State
const suggestions = ref<UpsellSuggestionItem[]>([]);
const isSuggestionsLoading = ref(false);

// Quick Add Customer Dialog
const isCustomerDialogOpen = ref(false);
const newCustomerForm = reactive({
  name: '',
  email: '',
  company: '',
  phone: '',
  tierId: '',
});
const isCreatingCustomer = ref(false);

// Product Picker Dialog
const isProductDialogOpen = ref(false);
const productSearch = ref('');
const selectedCategoryFilter = ref('');

const filteredProducts = computed(() => {
  return availableProducts.value.filter((p) => {
    if (selectedCategoryFilter.value && p.category?.code !== selectedCategoryFilter.value) return false;
    if (productSearch.value) {
      const q = productSearch.value.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    }
    return true;
  });
});

async function loadInitialData() {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const [custRes, tiersRes, prodsRes] = await Promise.all([
      apiRequest<{ customers: Customer[] }>('/api/quotations/customers'),
      apiRequest<{ tiers: CustomerTier[] }>('/api/catalog/tiers'),
      apiRequest<{ products: Product[] }>('/api/catalog/products'),
    ]);

    customers.value = custRes.customers;
    customerTiers.value = tiersRes.tiers;
    availableProducts.value = prodsRes.products;

    if (tiersRes.tiers && tiersRes.tiers.length > 0 && tiersRes.tiers[0] && !newCustomerForm.tierId) {
      newCustomerForm.tierId = tiersRes.tiers[0].id;
    }

    if (isEditMode.value) {
      await loadQuotation(quoteId.value!);
    } else {
      // Customer-first creation: the builder opens for a specific customer
      // request (?customer=<id> from the customer picker). Never preselect an
      // arbitrary customer.
      const requestedCustomerId = typeof route.query.customer === 'string' ? route.query.customer : '';
      if (requestedCustomerId && customers.value.some((c) => c.id === requestedCustomerId)) {
        selectedCustomerId.value = requestedCustomerId;
      }
    }
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to load builder data';
  } finally {
    isLoading.value = false;
  }
}

// Audit Trail & Approval Actions State
const auditLogs = ref<any[]>([]);
const isAuditLoading = ref(false);
const isSubmittingApproval = ref(false);
const submitNotes = ref('');
const isSubmitDialogOpen = ref(false);

const isApproverActionDialogOpen = ref(false);
const approverActionType = ref<'approve' | 'reject'>('approve');
const approverReason = ref('');
const isProcessingApproverAction = ref(false);

// Customer Portal Magic Link State
const isSendingToCustomer = ref(false);
const isSendCustomerDialogOpen = ref(false);
const generatedPortalUrl = ref<string | null>(null);
const dispatchedRecipientEmail = ref<string | null>(null);

async function handleSendToCustomer() {
  if (!quoteId.value) return;
  isSendingToCustomer.value = true;
  errorMessage.value = null;
  generatedPortalUrl.value = null;

  try {
    const res = await apiRequest<{
      success: boolean;
      portalUrl: string;
      customerEmail: string;
      status: string;
    }>(`/api/portal/send/${quoteId.value}`, {
      method: 'POST',
    });

    generatedPortalUrl.value = res.portalUrl;
    dispatchedRecipientEmail.value = res.customerEmail;
    quotationStatus.value = res.status;
    isSendCustomerDialogOpen.value = true;
    successMessage.value = `Quotation magic link dispatched to ${res.customerEmail}`;

    await loadQuotation(quoteId.value);
    await loadAuditTrail(quoteId.value);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to send quotation to customer';
  } finally {
    isSendingToCustomer.value = false;
  }
}

async function loadAuditTrail(quotationId: string) {
  isAuditLoading.value = true;
  try {
    const res = await apiRequest<{ auditTrail: any[] }>(`/api/approvals/quotation/${quotationId}/audit`);
    auditLogs.value = res.auditTrail || [];
  } catch (err) {
    console.warn('Failed to load audit trail:', err);
  } finally {
    isAuditLoading.value = false;
  }
}

async function handleSubmitForApproval() {
  if (!quoteId.value) return;
  isSubmittingApproval.value = true;
  errorMessage.value = null;
  try {
    const res = await apiRequest<any>(`/api/approvals/submit/${quoteId.value}`, {
      method: 'POST',
      body: JSON.stringify({ notes: submitNotes.value.trim() }),
    });
    isSubmitDialogOpen.value = false;
    submitNotes.value = '';
    successMessage.value = res.message || 'Quotation submitted for review.';
    await loadQuotation(quoteId.value);
    await loadAuditTrail(quoteId.value);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to submit quotation for approval';
  } finally {
    isSubmittingApproval.value = false;
  }
}

async function handleDirectApproverAction() {
  if (!quoteId.value || !approverReason.value.trim()) return;
  isProcessingApproverAction.value = true;
  errorMessage.value = null;
  try {
    const res = await apiRequest<any>(`/api/approvals/${approverActionType.value}/${quoteId.value}`, {
      method: 'POST',
      body: JSON.stringify({ reason: approverReason.value.trim() }),
    });
    isApproverActionDialogOpen.value = false;
    approverReason.value = '';
    successMessage.value = res.message || `Quotation ${approverActionType.value}d successfully.`;
    await loadQuotation(quoteId.value);
    await loadAuditTrail(quoteId.value);
  } catch (err: any) {
    errorMessage.value = err.message || `Failed to ${approverActionType.value} quotation`;
  } finally {
    isProcessingApproverAction.value = false;
  }
}

async function loadQuotation(id: string) {
  try {
    const res = await apiRequest<{ quotation: any }>(`/api/quotations/${id}`);
    const q = res.quotation;
    quotationNumber.value = q.quotationNumber;
    quotationStatus.value = q.status;
    selectedCustomerId.value = q.customerId;
    orderDiscountPercent.value = Number(q.orderDiscountPercent || 0);
    notes.value = q.notes || '';

    lines.value = q.lines.map((l: any) => ({
      productId: l.productId,
      product: l.product,
      quantity: l.quantity,
      unitPrice: Number(l.unitPrice),
      lineDiscountPercent: Number(l.lineDiscountPercent),
      subtotal: Number(l.subtotal),
      total: Number(l.total),
      marginAmount: Number(l.marginAmount),
      marginPercent: Number(l.marginPercent),
      appliedCeilingPercent: Number(l.appliedCeilingPercent || 0),
      riskDeltaPercent: Number(l.riskDeltaPercent || 0),
      isOverCeiling: Boolean(l.isOverCeiling),
      billingFrequency: l.billingFrequency,
    }));

    Object.assign(totals, {
      orderDiscountPercent: Number(q.orderDiscountPercent || 0),
      orderDiscountAmount: Number(q.orderDiscountAmount || 0),
      subtotal: Number(q.subtotal || 0),
      totalDiscount: Number(q.totalDiscount || 0),
      totalAmount: Number(q.totalAmount || 0),
      totalCost: Number(q.totalCost || 0),
      totalMargin: Number(q.totalMargin || 0),
      totalMarginPercent: Number(q.totalMarginPercent || 0),
      oneTimeTotal: Number(q.oneTimeTotal || 0),
      recurringMonthlyTotal: Number(q.recurringMonthlyTotal || 0),
      recurringAnnualTotal: Number(q.recurringAnnualTotal || 0),
    });

    if (q.riskDetails) {
      Object.assign(risk, q.riskDetails);
    } else {
      risk.riskScore = Number(q.riskScore || 0);
      risk.riskLevel = q.riskLevel || 'low';
      risk.approvalRouting = q.approvalRouting || 'none';
    }

    // Load Audit Trail
    await loadAuditTrail(id);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to load quotation';
  }
}

let recalculateTimer: any = null;

function debouncedRecalculate() {
  if (recalculateTimer) clearTimeout(recalculateTimer);
  recalculateTimer = setTimeout(() => {
    recalculate();
  }, 150);
}

// Monotonic guard: only the newest /calculate response may write totals/risk,
// so an older in-flight response can never overwrite fresher numbers.
let recalcSequence = 0;
const recalcError = ref<string | null>(null);

async function recalculate() {
  recalcError.value = null;

  if (!selectedCustomerId.value || lines.value.length === 0) {
    Object.assign(totals, {
      orderDiscountPercent: orderDiscountPercent.value,
      orderDiscountAmount: 0,
      subtotal: 0,
      totalDiscount: 0,
      totalAmount: 0,
      totalCost: 0,
      totalMargin: 0,
      totalMarginPercent: 0,
      oneTimeTotal: 0,
      recurringMonthlyTotal: 0,
      recurringAnnualTotal: 0,
    });
    Object.assign(risk, {
      riskScore: 0,
      riskLevel: 'low',
      approvalRouting: 'none',
      routingReason: 'All lines comply with rulebook ceilings.',
      hasLineOverCeiling: false,
      overCeilingLineCount: 0,
      totalLines: 0,
      lines: [],
    });
    suggestions.value = [];
    return;
  }

  const tierId = selectedCustomer.value?.tierId;
  if (!tierId) {
    // Selected customer has no resolvable tier — reset instead of silently
    // keeping stale numbers while inputs visibly change.
    Object.assign(totals, {
      orderDiscountPercent: orderDiscountPercent.value,
      orderDiscountAmount: 0,
      subtotal: 0,
      totalDiscount: 0,
      totalAmount: 0,
      totalCost: 0,
      totalMargin: 0,
      totalMarginPercent: 0,
      oneTimeTotal: 0,
      recurringMonthlyTotal: 0,
      recurringAnnualTotal: 0,
    });
    recalcError.value = 'The selected customer has no pricing tier — summary and margin are unavailable until a tier is assigned.';
    return;
  }

  const seq = ++recalcSequence;

  try {
    const payload = {
      tierId,
      orderDiscountPercent: Number(orderDiscountPercent.value || 0),
      quotationId: quoteId.value || undefined,
      lines: lines.value.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity || 1),
        unitPrice: l.unitPrice !== undefined ? Number(l.unitPrice) : undefined,
        lineDiscountPercent: Number(l.lineDiscountPercent || 0),
      })),
    };

    const res = await apiRequest<{ computedLines: any[]; totals: QuotationTotals; risk: RiskState }>(
      '/api/quotations/calculate',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    // A newer recalculation started while this request was in flight — discard.
    if (seq !== recalcSequence) return;

    res.computedLines.forEach((cl, idx) => {
      if (lines.value[idx]) {
        lines.value[idx].subtotal = cl.subtotal;
        lines.value[idx].total = cl.total;
        lines.value[idx].unitPrice = cl.unitPrice;
        lines.value[idx].marginAmount = cl.marginAmount;
        lines.value[idx].marginPercent = cl.marginPercent;
        lines.value[idx].billingFrequency = cl.billingFrequency;
        lines.value[idx].appliedCeilingPercent = cl.appliedCeilingPercent;
        lines.value[idx].riskDeltaPercent = cl.riskDeltaPercent;
        lines.value[idx].isOverCeiling = cl.isOverCeiling;
      }
    });

    Object.assign(totals, res.totals);
    if (res.risk) {
      Object.assign(risk, res.risk);
    }

    // Refresh suggestions without widening the totals race window.
    fetchUpsellSuggestions();
  } catch (err: any) {
    if (seq !== recalcSequence) return;
    recalcError.value = err.message || 'Live pricing failed — summary may be stale. Adjust an input to retry.';
  }
}

async function fetchUpsellSuggestions() {
  if (!selectedCustomerId.value) {
    suggestions.value = [];
    return;
  }

  isSuggestionsLoading.value = true;
  try {
    const res = await apiRequest<{ suggestions: UpsellSuggestionItem[] }>('/api/recommendations/upsell', {
      method: 'POST',
      body: JSON.stringify({
        productIds: lines.value.map((l) => l.productId),
        tierId: selectedCustomer.value?.tierId,
        subtotal: totals.subtotal,
        totalAmount: totals.totalAmount,
        totalCost: totals.totalCost,
        totalMargin: totals.totalMargin,
      }),
    });
    suggestions.value = res.suggestions || [];
  } catch (err) {
    console.warn('Failed to load upsell suggestions:', err);
  } finally {
    isSuggestionsLoading.value = false;
  }
}

function handleAddSuggestion(suggestion: UpsellSuggestionItem) {
  const matchedProduct = availableProducts.value.find((p) => p.id === suggestion.productId);
  if (matchedProduct) {
    addProductToQuote(matchedProduct);
  } else {
    // Construct line from suggestion if not in initial memory
    lines.value.push({
      productId: suggestion.productId,
      product: {
        id: suggestion.productId,
        name: suggestion.name,
        sku: suggestion.sku,
        categoryId: suggestion.categoryId,
        price: suggestion.unitPrice,
        costPrice: suggestion.costPrice,
        billingFrequency: suggestion.billingFrequency as any,
        category: suggestion.categoryName
          ? { id: suggestion.categoryId || '', name: suggestion.categoryName, code: suggestion.categoryCode || '' }
          : undefined,
      },
      quantity: 1,
      unitPrice: suggestion.unitPrice,
      lineDiscountPercent: suggestion.lineDiscountPercent,
      subtotal: suggestion.lineTotal,
      total: suggestion.lineTotal,
      marginAmount: suggestion.marginAmount,
      marginPercent: suggestion.marginPercent,
      billingFrequency: suggestion.billingFrequency,
    });
    debouncedRecalculate();
  }
}

function addProductToQuote(product: Product) {
  const existing = lines.value.find((l) => l.productId === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    const defaultTierDiscount = Number(selectedCustomerTier.value?.defaultDiscountPercent || 0);
    const basePrice = Number(product.price);
    const discountedPrice =
      defaultTierDiscount > 0
        ? Math.round(basePrice * (1 - defaultTierDiscount / 100) * 100) / 100
        : basePrice;

    lines.value.push({
      productId: product.id,
      product,
      quantity: 1,
      unitPrice: discountedPrice,
      lineDiscountPercent: 0,
      subtotal: discountedPrice,
      total: discountedPrice,
      marginAmount: discountedPrice - Number(product.costPrice || 0),
      marginPercent:
        discountedPrice > 0
          ? Math.round(((discountedPrice - Number(product.costPrice || 0)) / discountedPrice) * 1000) / 10
          : 0,
      billingFrequency: product.billingFrequency,
    });
  }

  isProductDialogOpen.value = false;
  debouncedRecalculate();
}

function removeLine(index: number) {
  lines.value.splice(index, 1);
  debouncedRecalculate();
}

async function handleSaveQuotation() {
  if (!selectedCustomerId.value) {
    errorMessage.value = 'Please select a customer for this quotation';
    return;
  }

  if (lines.value.length === 0) {
    errorMessage.value = 'Please add at least one product line';
    return;
  }

  isSaving.value = true;
  errorMessage.value = null;
  successMessage.value = null;

  const payload = {
    customerId: selectedCustomerId.value,
    orderDiscountPercent: Number(orderDiscountPercent.value || 0),
    notes: notes.value,
    lines: lines.value.map((l) => ({
      productId: l.productId,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      lineDiscountPercent: Number(l.lineDiscountPercent || 0),
    })),
  };

  try {
    if (isEditMode.value) {
      const res = await apiRequest<{ quotation: any }>(`/api/quotations/${quoteId.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      successMessage.value = `Quotation ${res.quotation.quotationNumber} updated successfully`;
      await loadQuotation(res.quotation.id);
    } else {
      const res = await apiRequest<{ quotation: any }>('/api/quotations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      successMessage.value = `Quotation ${res.quotation.quotationNumber} created successfully`;

      // New-customer flow: the portal access link is dispatched automatically —
      // all further communication happens through the customer's portal link.
      if (route.query.newCustomer === '1') {
        try {
          const sendRes = await apiRequest<{ portalUrl: string; customerEmail: string }>(
            `/api/portal/send/${res.quotation.id}`,
            { method: 'POST', body: '{}' }
          );
          sessionStorage.setItem(
            'dealflow_dispatched_portal',
            JSON.stringify({ url: sendRes.portalUrl, email: sendRes.customerEmail })
          );
        } catch (err: any) {
          errorMessage.value = `Quotation saved, but the portal link email failed (${err.message || 'unknown error'}). Use "Send to Customer" to retry.`;
        }
      }

      router.push(`/quotations/${res.quotation.id}`);
    }
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to save quotation';
  } finally {
    isSaving.value = false;
  }
}

async function handleCreateCustomer() {
  if (!newCustomerForm.name || !newCustomerForm.email || !newCustomerForm.tierId) {
    return;
  }
  isCreatingCustomer.value = true;
  errorMessage.value = null;
  try {
    const res = await apiRequest<{ customer: Customer }>('/api/quotations/customers', {
      method: 'POST',
      body: JSON.stringify(newCustomerForm),
    });
    customers.value.push(res.customer);
    selectedCustomerId.value = res.customer.id;
    isCustomerDialogOpen.value = false;
    newCustomerForm.name = '';
    newCustomerForm.email = '';
    newCustomerForm.company = '';
    newCustomerForm.phone = '';
    debouncedRecalculate();
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to create customer';
  } finally {
    isCreatingCustomer.value = false;
  }
}

function getCategoryBadgeClass(code?: string): string {
  switch (code) {
    case 'hardware':
      return 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border-blue-200';
    case 'services':
      return 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border-purple-200';
    case 'subscriptions':
      return 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function getMarginBadgeClass(marginPct: number): string {
  return marginTone(marginPct).bg;
}

watch(selectedCustomerId, () => {
  debouncedRecalculate();
});

// ==================== PHASE 14 — CUSTOMER NEGOTIATION (Stage 6) ====================

const negotiationData = ref<any>(null);
const isNegotiationLoading = ref(false);
const negotiationComment = ref('');
const negotiationBusyId = ref<string | null>(null);
const negotiationError = ref<string | null>(null);
const negotiationNotice = ref<string | null>(null);
const canManageNegotiation = computed(() =>
  ['manager', 'org_admin'].includes(authStore.state.user?.role || '')
);
const openCounters = computed(
  () => negotiationData.value?.counterProposals?.filter((c: any) => c.status === 'open') ?? []
);
const openChangeRequests = computed(
  () => negotiationData.value?.changeRequests?.filter((c: any) => c.status === 'open') ?? []
);

/**
 * Unified chat timeline: comments, counter-proposals and change requests
 * merged chronologically — the rep sees the negotiation exactly as a
 * conversation, with deal actions embedded as cards in the thread.
 */
type NegotiationTimelineItem =
  | {
      kind: 'comment';
      id: string;
      createdAt: string;
      authorType: 'customer' | 'internal';
      authorName: string;
      body: string;
      line: { productId?: string } | null;
    }
  | {
      kind: 'counter';
      id: string;
      createdAt: string;
      proposedDiscountPercent: string;
      note: string | null;
      status: string;
      decisionNote: string | null;
      line: { productId?: string } | null;
    }
  | {
      kind: 'change';
      id: string;
      createdAt: string;
      requestType: string;
      proposedQuantity: number | null;
      proposedDiscountPercent: string | null;
      note: string | null;
      status: string;
      resolutionNote: string | null;
      line: { productId?: string } | null;
    };

const negotiationTimeline = computed<NegotiationTimelineItem[]>(() => {
  const data = negotiationData.value;
  if (!data) return [];
  const items: NegotiationTimelineItem[] = [];

  for (const c of data.comments ?? []) {
    items.push({
      kind: 'comment',
      id: c.id,
      createdAt: c.createdAt,
      authorType: c.authorType,
      authorName: c.authorName,
      body: c.body,
      line: c.line ?? null,
    });
  }
  for (const cp of data.counterProposals ?? []) {
    items.push({
      kind: 'counter',
      id: cp.id,
      createdAt: cp.createdAt,
      proposedDiscountPercent: cp.proposedDiscountPercent,
      note: cp.note,
      status: cp.status,
      decisionNote: cp.decisionNote,
      line: cp.line ?? null,
    });
  }
  for (const cr of data.changeRequests ?? []) {
    items.push({
      kind: 'change',
      id: cr.id,
      createdAt: cr.createdAt,
      requestType: cr.requestType,
      proposedQuantity: cr.proposedQuantity,
      proposedDiscountPercent: cr.proposedDiscountPercent,
      note: cr.note,
      status: cr.status,
      resolutionNote: cr.resolutionNote,
      line: cr.line ?? null,
    });
  }

  return items.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
});

function negotiationLineLabel(line: { productId?: string } | null | undefined): string {
  if (!line?.productId) return 'General';
  const l = lines.value.find((x) => x.productId === line.productId);
  return l?.product?.name ? String(l.product.name) : 'Line item';
}

function isThreadItemFromTeam(item: NegotiationTimelineItem): boolean {
  return item.kind === 'comment' && item.authorType === 'internal';
}

function threadItemAuthor(item: NegotiationTimelineItem): string {
  if (item.kind === 'comment') return item.authorName || 'Team';
  return negotiationData.value?.quotation?.customerName || 'Customer';
}

function threadItemAvatar(item: NegotiationTimelineItem): string {
  if (item.kind === 'comment') return (item.authorName || '?').substring(0, 2).toUpperCase();
  return (negotiationData.value?.quotation?.customerName || 'CU').substring(0, 2).toUpperCase();
}

async function loadNegotiation() {
  if (!quoteId.value) return;
  isNegotiationLoading.value = true;
  try {
    negotiationData.value = await apiRequest<any>(`/api/negotiation/${quoteId.value}`);
  } catch (err: any) {
    // Non-fatal: the panel simply shows empty state
    negotiationData.value = null;
  } finally {
    isNegotiationLoading.value = false;
  }
}

async function postInternalComment() {
  if (!quoteId.value || !negotiationComment.value.trim()) return;
  negotiationBusyId.value = 'internal-comment';
  negotiationError.value = null;
  try {
    await apiRequest(`/api/negotiation/${quoteId.value}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: negotiationComment.value.trim() }),
    });
    negotiationComment.value = '';
    await loadNegotiation();
  } catch (err: any) {
    negotiationError.value = err.message || 'Failed to post reply';
  } finally {
    negotiationBusyId.value = null;
  }
}

async function resolveCounter(counterId: string, action: 'accept' | 'decline') {
  if (!quoteId.value) return;
  negotiationBusyId.value = counterId;
  negotiationError.value = null;
  negotiationNotice.value = null;
  try {
    const res = await apiRequest<any>(
      `/api/negotiation/${quoteId.value}/counters/${counterId}/resolve`,
      { method: 'POST', body: JSON.stringify({ action }) }
    );
    if (action === 'accept') {
      negotiationNotice.value =
        res && typeof res === 'object' && 'reenteredApproval' in res
          ? 'Counter accepted. New terms exceed the approval thresholds — the quotation was routed back to the approval queue.'
          : 'Counter accepted and quotation terms updated.';
    } else {
      negotiationNotice.value = 'Counter declined.';
    }
    await loadNegotiation();
    await loadQuotation(quoteId.value);
  } catch (err: any) {
    negotiationError.value = err.message || 'Failed to resolve counter-proposal';
  } finally {
    negotiationBusyId.value = null;
  }
}

async function resolveChangeRequest(requestId: string, action: 'accept' | 'decline') {
  if (!quoteId.value) return;
  negotiationBusyId.value = requestId;
  negotiationError.value = null;
  negotiationNotice.value = null;
  try {
    const res = await apiRequest<any>(
      `/api/negotiation/${quoteId.value}/change-requests/${requestId}/resolve`,
      { method: 'POST', body: JSON.stringify({ action }) }
    );
    if (action === 'accept') {
      negotiationNotice.value =
        res && typeof res === 'object' && 'reenteredApproval' in res
          ? 'Change request accepted — terms re-validated against the rulebook and the quotation re-entered the approval queue.'
          : 'Change request accepted and quotation terms updated.';
    } else {
      negotiationNotice.value = 'Change request declined.';
    }
    await loadNegotiation();
    await loadQuotation(quoteId.value);
  } catch (err: any) {
    negotiationError.value = err.message || 'Failed to resolve change request';
  } finally {
    negotiationBusyId.value = null;
  }
}

function negotiationRequestBadge(status: string): { label: string; class: string } {
  switch (status) {
    case 'open':
      return { label: 'Open', class: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300' };
    case 'accepted':
      return { label: 'Accepted', class: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-300' };
    case 'applied':
      return { label: 'Applied', class: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-300' };
    case 'declined':
      return { label: 'Declined', class: 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 border-red-300' };
    case 'superseded':
      return { label: 'Superseded', class: 'bg-muted text-muted-foreground border-border' };
    default:
      return { label: status, class: 'bg-muted text-muted-foreground border-border' };
  }
}

/**
 * After the new-customer auto-send, the builder re-routes with ?dispatched=1 —
 * restore the "link dispatched" modal once (the flag is stripped immediately so
 * a refresh never re-triggers it).
 */
function restoreDispatchedPortalModal() {
  if (route.query.dispatched !== '1') return;
  router.replace({ path: route.path });
  const stored = sessionStorage.getItem('dealflow_dispatched_portal');
  sessionStorage.removeItem('dealflow_dispatched_portal');
  if (!stored) return;
  try {
    const dispatched = JSON.parse(stored) as { url: string; email: string };
    generatedPortalUrl.value = dispatched.url;
    dispatchedRecipientEmail.value = dispatched.email;
    isSendCustomerDialogOpen.value = true;
    successMessage.value = `Portal link emailed to ${dispatched.email} — all further communication happens through that link.`;
  } catch {
    // Ignore malformed payloads
  }
}

// ==================== PHASE 16 — ORDER FULFILLMENT (Stage 4) ====================

interface FulfillmentAllocation {
  fulfillmentLineId: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
}

interface FulfillmentLineView {
  quotationLineId: string;
  productId: string;
  productName: string;
  sku: string;
  orderedQuantity: number;
  allocations: FulfillmentAllocation[];
  allocatedTotal: number;
  shortfall: number;
  lineStatus: 'fulfilled' | 'ready' | 'split' | 'partial' | 'shortfall';
}

interface FulfillmentPlanView {
  plan: {
    id: string;
    status: 'proposed' | 'accepted';
    shipmentCount: number;
    deliveryExtendedDays: number;
    extraChargeNote: string | null;
    isOverridden: boolean;
    proposedAt: string;
    acceptedAt: string | null;
  };
  quotation: {
    id: string;
    quotationNumber: string;
    status: string;
    customerName: string;
    totalAmount: number;
    currency: string;
  };
  lines: FulfillmentLineView[];
}

const fulfillmentPlan = ref<FulfillmentPlanView | null>(null);
const isFulfillmentLoading = ref(false);
const isFulfillmentBusy = ref<string | null>(null);
const fulfillmentError = ref<string | null>(null);
const fulfillmentNotice = ref<string | null>(null);
const canManageFulfillment = computed(() =>
  ['org_admin', 'ops'].includes(authStore.state.user?.role || '')
);
const isFulfillable = computed(
  () => isEditMode.value && ['approved', 'confirmed'].includes(quotationStatus.value)
);

// Inline per-line override editor state
const overrideLineId = ref<string | null>(null);
const overrideWarehouseId = ref<string>('');
const overrideQuantity = ref<number | null>(null);
const overrideWarehouseOptions = ref<Array<{ id: string; name: string; available: number }>>([]);

function fulfillmentLineBadge(status: FulfillmentLineView['lineStatus']): { label: string; class: string } {
  return fulfillmentStatusLabel(status);
}

async function loadFulfillment() {
  if (!isFulfillable.value || !quoteId.value) {
    fulfillmentPlan.value = null;
    return;
  }
  isFulfillmentLoading.value = true;
  try {
    fulfillmentPlan.value = await apiRequest<FulfillmentPlanView>(
      `/api/fulfillment/quotation/${quoteId.value}`
    );
    fulfillmentError.value = null;
  } catch (err: any) {
    fulfillmentPlan.value = null;
    fulfillmentError.value = err.message || 'Failed to load the fulfillment plan';
  } finally {
    isFulfillmentLoading.value = false;
  }
}

async function regenerateFulfillment() {
  if (!quoteId.value) return;
  isFulfillmentBusy.value = 'regenerate';
  fulfillmentError.value = null;
  try {
    fulfillmentPlan.value = await apiRequest<FulfillmentPlanView>(
      `/api/fulfillment/quotation/${quoteId.value}/propose`,
      { method: 'POST', body: '{}' }
    );
    fulfillmentNotice.value = 'Split proposal regenerated.';
    setTimeout(() => {
      if (fulfillmentNotice.value === 'Split proposal regenerated.') fulfillmentNotice.value = null;
    }, 2500);
  } catch (err: any) {
    fulfillmentError.value = err.message || 'Failed to regenerate the split proposal';
  } finally {
    isFulfillmentBusy.value = null;
  }
}

async function openOverride(line: FulfillmentLineView) {
  overrideLineId.value = line.quotationLineId;
  overrideQuantity.value = line.orderedQuantity;
  overrideWarehouseId.value = line.allocations[0]?.warehouseId ?? '';
  // Live availability per warehouse for this product (read is open to all roles).
  try {
    const matrix = await apiRequest<any>('/api/warehouses/stock');
    const row = matrix.rows?.find((r: any) => r.productId === line.productId);
    overrideWarehouseOptions.value = (matrix.warehouses || [])
      .filter((w: any) => w.status === 'active')
      .map((w: any) => ({ id: w.id, name: w.name, available: row?.quantities?.[w.id] ?? 0 }));
  } catch {
    overrideWarehouseOptions.value = [];
  }
}

function cancelOverride() {
  overrideLineId.value = null;
  overrideWarehouseId.value = '';
  overrideQuantity.value = null;
}

async function saveOverride(line: FulfillmentLineView) {
  const firstAllocation = line.allocations[0];
  if (!firstAllocation) return; // shortfall-only lines get new stock via inventory first
  if (!overrideWarehouseId.value || !overrideQuantity.value || overrideQuantity.value < 1) {
    fulfillmentError.value = 'Pick a warehouse and a quantity of at least 1.';
    return;
  }
  isFulfillmentBusy.value = line.quotationLineId;
  fulfillmentError.value = null;
  try {
    fulfillmentPlan.value = await apiRequest<FulfillmentPlanView>(
      `/api/fulfillment/lines/${firstAllocation.fulfillmentLineId}/allocations`,
      {
        method: 'PUT',
        body: JSON.stringify({
          allocations: [{ warehouseId: overrideWarehouseId.value, quantity: overrideQuantity.value }],
        }),
      }
    );
    fulfillmentNotice.value = 'Line reassigned — fulfillment updated.';
    cancelOverride();
    setTimeout(() => {
      if (fulfillmentNotice.value === 'Line reassigned — fulfillment updated.') fulfillmentNotice.value = null;
    }, 2500);
  } catch (err: any) {
    fulfillmentError.value = err.message || 'Failed to reassign the line';
  } finally {
    isFulfillmentBusy.value = null;
  }
}

async function acceptFulfillment() {
  if (!quoteId.value) return;
  const plan = fulfillmentPlan.value;
  const totalToDeduct = plan?.lines.reduce((sum, l) => sum + l.allocatedTotal, 0) ?? 0;
  if (!window.confirm(`Accept this fulfillment plan and deduct ${totalToDeduct} unit(s) from warehouse stock?`)) {
    return;
  }
  isFulfillmentBusy.value = 'accept';
  fulfillmentError.value = null;
  try {
    fulfillmentPlan.value = await apiRequest<FulfillmentPlanView>(
      `/api/fulfillment/quotation/${quoteId.value}/accept`,
      { method: 'POST', body: '{}' }
    );
    fulfillmentNotice.value = 'Fulfillment accepted — warehouse stock has been updated.';
    await loadAuditTrail(quoteId.value);
  } catch (err: any) {
    fulfillmentError.value = err.message || 'Failed to accept the fulfillment plan';
    // Stock may have drifted — refresh the plan so the user can regenerate.
    await loadFulfillment();
  } finally {
    isFulfillmentBusy.value = null;
  }
}

onMounted(() => {
  loadInitialData();

  if (isEditMode.value) {
    loadNegotiation();
    loadFulfillment();
    restoreDispatchedPortalModal();
  }

  // Socket.IO realtime connection & listener
  try {
    const socket = getSocket();
    if (quoteId.value) {
      socket.emit('quote:join', quoteId.value);
    }

    socket.on('pricing:updated', (data: any) => {
      if (data && data.quotationId === quoteId.value && data.totals) {
        Object.assign(totals, data.totals);
      }
    });

    socket.on('quote:updated', (data: any) => {
      if (data && data.quotation && data.quotation.id === quoteId.value) {
        quotationStatus.value = data.quotation.status;
      }
    });

    // Phase 14: live negotiation activity from the customer portal
    socket.on('negotiation:updated', (data: any) => {
      if (data && data.quotationId === quoteId.value) {
        loadNegotiation();
      }
    });

    // Phase 16: live fulfillment updates (proposals, overrides, acceptance)
    socket.on('fulfillment:updated', (data: any) => {
      if (data && data.quotationId === quoteId.value) {
        loadFulfillment();
      }
    });
  } catch (err) {
    console.warn('Socket connection setup error:', err);
  }
});

onUnmounted(() => {
  if (recalculateTimer) clearTimeout(recalculateTimer);
  try {
    const socket = getSocket();
    if (quoteId.value) {
      socket.emit('quote:leave', quoteId.value);
    }
    socket.off('pricing:updated');
    socket.off('quote:updated');
    socket.off('negotiation:updated');
    socket.off('fulfillment:updated');
  } catch {
    // Non-fatal
  }
});
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-6">
      <!-- Breadcrumb & Top bar -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              class="h-8 px-2 text-muted-foreground hover:text-foreground"
              @click="router.push('/quotations')"
            >
              <ArrowLeft class="w-4 h-4 mr-1" />
              Back to Quotes
            </Button>
            <span class="text-muted-foreground">/</span>
            <span class="font-mono text-sm font-semibold text-primary">
              {{ isEditMode ? quotationNumber : 'New Quotation' }}
            </span>
            <Badge v-if="isEditMode" variant="outline" class="text-xs uppercase">
              {{ statusLabel(quotationStatus) }}
            </Badge>
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FileText class="w-6 h-6 text-primary" />
            {{ isEditMode ? `Edit Quote — ${quotationNumber}` : 'Quotation Builder (Stage 2)' }}
          </h1>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            @click="recalculate"
            class="h-9"
          >
            <RotateCcw class="w-4 h-4 mr-1.5" />
            Recalculate
          </Button>

          <!-- Submit for Approval button (visible if draft or rejected and quote is saved) -->
          <Button
            v-if="isEditMode && ['draft', 'rejected'].includes(quotationStatus)"
            variant="outline"
            size="sm"
            class="h-9 border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 hover:bg-amber-100"
            @click="isSubmitDialogOpen = true"
          >
            <Send class="w-4 h-4 mr-1.5" />
            Submit for Approval
          </Button>

          <!-- Approver Action buttons (visible if pending_approval and user has manager/finance/admin role) -->
          <template v-if="isEditMode && quotationStatus === 'pending_approval' && ['manager', 'finance', 'org_admin'].includes(authStore.state.user?.role || '')">
            <Button
              variant="destructive"
              size="sm"
              class="h-9 text-xs font-semibold"
              @click="approverActionType = 'reject'; isApproverActionDialogOpen = true;"
            >
              <XCircle class="w-4 h-4 mr-1.5" />
              Reject
            </Button>
            <Button
              variant="default"
              size="sm"
              class="h-9 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
              @click="approverActionType = 'approve'; isApproverActionDialogOpen = true;"
            >
              <CheckCircle2 class="w-4 h-4 mr-1.5" />
              Approve
            </Button>
          </template>

          <!-- Send to Customer Button (Rep / Manager) -->
          <Button
            v-if="isEditMode && ['approved', 'sent', 'draft'].includes(quotationStatus)"
            variant="outline"
            size="sm"
            class="h-9 border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 hover:bg-blue-100"
            :disabled="isSendingToCustomer"
            @click="handleSendToCustomer"
            title="Email the customer their portal link"
          >
            <Send v-if="!isSendingToCustomer" class="w-4 h-4 mr-1.5 text-blue-600" />
            <RotateCcw v-else class="w-4 h-4 mr-1.5 animate-spin text-blue-600" />
            {{ isSendingToCustomer ? 'Sending...' : 'Send to Customer' }}
          </Button>

          <Button
            size="sm"
            @click="handleSaveQuotation"
            :disabled="isSaving"
            class="h-9 shadow-xs font-semibold"
          >
            <Save class="w-4 h-4 mr-1.5" />
            {{ isSaving ? 'Saving...' : (isEditMode ? 'Update Quotation' : 'Save Draft') }}
          </Button>
        </div>
      </div>

      <!-- Error and Success Alerts -->
      <div
        v-if="errorMessage"
        class="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-3 text-sm"
      >
        <AlertTriangle class="w-5 h-5 shrink-0" />
        <span>{{ errorMessage }}</span>
      </div>

      <div
        v-if="successMessage"
        class="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 flex items-center gap-3 text-sm"
      >
        <CheckCircle2 class="w-5 h-5 shrink-0" />
        <span>{{ successMessage }}</span>
      </div>

      <!-- Main Layout: 2 Columns (Builder Table on Left / Customer & Totals Summary on Right) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        <!-- LEFT COLUMN: Product Lines & Category Builder (8 cols) -->
        <div class="lg:col-span-8 space-y-6">
          <!-- Create mode: quotations start from a customer request -->
          <div
            v-if="!isEditMode && !selectedCustomerId"
            class="p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-start gap-3"
          >
            <User class="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div class="space-y-1 text-xs">
              <p class="font-semibold text-foreground">Select a customer request to start building</p>
              <p class="text-muted-foreground">
                Quotations are always created for a customer. Choose the customer in the
                "Customer Request" panel on the right — their requirement details will
                guide the quotation you build here.
              </p>
            </div>
          </div>

          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle class="text-base font-semibold text-foreground flex items-center gap-2">
                    <Layers class="w-4 h-4 text-primary" />
                    Quotation Line Items
                  </CardTitle>
                  <CardDescription class="text-xs">
                    Mixed lines across Hardware, Services, and Subscriptions.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-8 font-semibold text-xs border-primary/30 text-primary hover:bg-primary/10"
                  :disabled="!selectedCustomerId"
                  :title="!selectedCustomerId ? 'Select a customer request first' : ''"
                  @click="isProductDialogOpen = true"
                >
                  <Plus class="w-3.5 h-3.5 mr-1" />
                  Add Product / Service
                </Button>
              </div>
            </CardHeader>

            <CardContent class="p-0">
              <div v-if="lines.length === 0" class="py-16 text-center space-y-3">
                <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto text-primary">
                  <Layers class="w-6 h-6" />
                </div>
                <h4 class="text-sm font-semibold text-foreground">
                  {{ selectedCustomerId ? 'No line items in this quotation' : 'Waiting for a customer selection' }}
                </h4>
                <p class="text-xs text-muted-foreground max-w-sm mx-auto">
                  {{ selectedCustomerId
                    ? 'Click "Add Product / Service" to build a mixed quotation with hardware, consulting services, or recurring licenses.'
                    : 'Pick the customer on the right (or open Quotations → New Quotation) to begin building their quotation.' }}
                </p>
                <Button
                  v-if="selectedCustomerId"
                  size="sm"
                  @click="isProductDialogOpen = true"
                  class="mt-2 text-xs"
                >
                  <Plus class="w-3.5 h-3.5 mr-1" />
                  Add First Item
                </Button>
              </div>

              <div v-else class="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow class="bg-muted/40 text-xs">
                      <TableHead class="font-semibold w-[35%]">Product / Description</TableHead>
                      <TableHead class="font-semibold text-center w-[12%]">Qty</TableHead>
                      <TableHead class="font-semibold text-right w-[15%]">Unit Price</TableHead>
                      <TableHead class="font-semibold text-center w-[15%]">Line Disc %</TableHead>
                      <TableHead class="font-semibold text-right w-[15%]">Line Total</TableHead>
                      <TableHead class="w-[8%]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow
                      v-for="(line, idx) in lines"
                      :key="idx"
                      :class="[
                        'text-xs transition-colors',
                        line.isOverCeiling ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/20'
                      ]"
                    >
                      <!-- Product Info -->
                      <TableCell class="py-3">
                        <div class="font-semibold text-foreground text-xs">
                          {{ line.product?.name || 'Product ' + line.productId }}
                        </div>
                        <div class="flex items-center gap-2 mt-1">
                          <span class="font-mono text-2xs text-muted-foreground">
                            {{ line.product?.sku }}
                          </span>
                          <Badge
                            variant="outline"
                            :class="['text-2xs px-1.5 py-0', getCategoryBadgeClass(line.product?.category?.code)]"
                          >
                            {{ line.product?.category?.name || 'Item' }}
                          </Badge>
                          <span
                            v-if="line.billingFrequency !== 'one_time'"
                            class="text-2xs text-primary font-medium"
                          >
                            {{ billingLabel(line.billingFrequency) }}
                          </span>
                        </div>
                        <!-- Line-Level Risk & Ceiling Indicator -->
                        <div v-if="line.appliedCeilingPercent !== undefined" class="flex items-center gap-1.5 mt-1.5 text-3xs">
                          <span class="text-muted-foreground">Ceiling: <strong>{{ line.appliedCeilingPercent }}%</strong></span>
                          <Badge
                            v-if="line.isOverCeiling"
                            variant="outline"
                            class="text-3xs py-0 px-1 bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-300"
                          >
                            +{{ Number(line.riskDeltaPercent).toFixed(1) }}% Over Ceiling
                          </Badge>
                          <span v-else class="text-emerald-600 dark:text-emerald-400 font-medium">✓ In Policy</span>
                        </div>
                      </TableCell>

                      <!-- Quantity Input -->
                      <TableCell class="text-center py-3">
                        <Input
                          type="number"
                          min="1"
                          v-model.number="line.quantity"
                          @input="debouncedRecalculate"
                          @change="debouncedRecalculate"
                          class="h-8 w-16 text-center mx-auto text-xs"
                        />
                      </TableCell>

                      <!-- Unit Price Input -->
                      <TableCell class="text-right py-3">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          v-model.number="line.unitPrice"
                          @input="debouncedRecalculate"
                          @change="debouncedRecalculate"
                          class="h-8 w-24 text-right text-xs ml-auto"
                        />
                        <div class="text-2xs text-muted-foreground mt-0.5">
                          Cost: {{ formatCurrency(line.product?.costPrice || 0) }}
                        </div>
                      </TableCell>

                      <!-- Line Discount % Input -->
                      <TableCell class="text-center py-3">
                        <div class="relative flex items-center justify-center">
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            max="100"
                            v-model.number="line.lineDiscountPercent"
                            @input="debouncedRecalculate"
                            @change="debouncedRecalculate"
                            class="h-8 w-16 text-center text-xs"
                          />
                          <span class="text-2xs text-muted-foreground ml-1">%</span>
                        </div>
                        <div v-if="line.lineDiscountPercent > 0" class="text-2xs text-destructive mt-0.5">
                          -{{ formatCurrency(line.subtotal - line.total) }}
                        </div>
                      </TableCell>

                      <!-- Line Total & Margin -->
                      <TableCell class="text-right py-3">
                        <div class="font-bold text-foreground text-xs">
                          {{ formatCurrency(line.total) }}
                        </div>
                        <div
                          class="text-2xs font-semibold mt-0.5"
                          :class="marginTone(line.marginPercent).text"
                        >
                          Margin: {{ Number(line.marginPercent).toFixed(1) }}%
                        </div>
                      </TableCell>

                      <!-- Actions -->
                      <TableCell class="text-center py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          @click="removeLine(idx)"
                        >
                          <Trash2 class="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>

            <CardFooter class="bg-muted/20 border-t border-border/70 p-3 flex items-center justify-between text-xs">
              <span class="text-muted-foreground">
                Total Items: <strong>{{ lines.length }}</strong>
              </span>
              <Button
                variant="ghost"
                size="sm"
                class="text-xs h-7 text-primary"
                :disabled="!selectedCustomerId"
                @click="isProductDialogOpen = true"
              >
                <Plus class="w-3.5 h-3.5 mr-1" />
                Add Another Item
              </Button>
            </CardFooter>
          </Card>

          <!-- Upsell & Cross-Sell Recommendations Panel -->
          <UpsellPanel
            :suggestions="suggestions"
            :is-loading="isSuggestionsLoading"
            @add-suggestion="handleAddSuggestion"
          />

          <!-- Customer Requirement & Terms -->
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-semibold text-foreground">Customer Requirement & Notes</CardTitle>
              <CardDescription class="text-xs">
                Capture the customer's request, agreed terms, and any conditions — visible to the customer on their portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <textarea
                v-model="notes"
                placeholder="What did the customer ask for? Add agreed terms, payment conditions, or fulfillment instructions..."
                rows="3"
                class="w-full rounded-md border border-input bg-background p-2.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
              ></textarea>
            </CardContent>
          </Card>

          <!-- Stage 3 Audit Trail Timeline (Immutable Lifecycle History) -->
          <Card v-if="isEditMode" class="border-border bg-card shadow-xs">
            <CardHeader class="pb-2 border-b border-border/70">
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                    <History class="w-4 h-4 text-primary" />
                    Governance Audit Trail & Lifecycle
                  </CardTitle>
                  <CardDescription class="text-xs">
                    Immutable history of submissions, discount threshold approvals, and escalations.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs text-muted-foreground"
                  @click="loadAuditTrail(quoteId!)"
                >
                  <RotateCcw class="w-3.5 h-3.5 mr-1" :class="{ 'animate-spin': isAuditLoading }" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent class="pt-4">
              <AuditTrailTimeline :audit-logs="auditLogs" />
            </CardContent>
          </Card>

          <!-- Stage 6: Customer Negotiation Panel (Phase 14) -->
          <Card v-if="isEditMode" class="border-border bg-card shadow-xs">
            <CardHeader class="pb-2 border-b border-border/70">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                    <MessagesSquare class="w-4 h-4 text-primary" />
                    Customer Negotiation
                    <Badge
                      v-if="openCounters.length + openChangeRequests.length > 0"
                      class="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300 text-[10px]"
                    >
                      {{ openCounters.length + openChangeRequests.length }} awaiting your review
                    </Badge>
                  </CardTitle>
                  <CardDescription class="text-xs">
                    Chat with the customer from their portal — refine the quote over as many
                    review rounds as needed, then let them close the deal.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs text-muted-foreground"
                  @click="loadNegotiation"
                >
                  <RotateCcw class="w-3.5 h-3.5 mr-1" :class="{ 'animate-spin': isNegotiationLoading }" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent class="pt-4 space-y-4">
              <!-- Feedback -->
              <div v-if="negotiationError" class="p-2 rounded-md bg-destructive/10 text-destructive text-xs">{{ negotiationError }}</div>
              <div v-if="negotiationNotice" class="p-2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs">{{ negotiationNotice }}</div>

              <!-- Merged negotiation chat: comments + counters + change requests in one thread -->
              <div class="space-y-3 max-h-96 overflow-y-auto pr-1">
                <div v-if="negotiationTimeline.length === 0" class="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-md">
                  <MessagesSquare class="w-5 h-5 mx-auto text-muted-foreground/60 mb-1.5" />
                  The negotiation thread is empty — customer messages, counters and change requests appear here.
                </div>

                <div
                  v-for="item in negotiationTimeline"
                  :key="item.kind + '-' + item.id"
                  class="flex gap-2"
                  :class="isThreadItemFromTeam(item) ? 'flex-row-reverse' : ''"
                >
                  <div
                    class="size-6 rounded-md grid place-items-center text-[9px] font-bold shrink-0"
                    :class="isThreadItemFromTeam(item) ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                  >
                    {{ threadItemAvatar(item) }}
                  </div>

                  <div class="max-w-[88%] space-y-0.5">
                    <!-- Meta line -->
                    <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span class="font-semibold text-foreground">{{ threadItemAuthor(item) }}</span>
                      <span>{{ isThreadItemFromTeam(item) ? 'Team' : 'Customer' }}</span>
                      <span v-if="item.line" class="px-1.5 py-0.5 rounded bg-muted border border-border">{{ negotiationLineLabel(item.line) }}</span>
                      <span class="ml-auto">{{ new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
                    </div>

                    <!-- Comment bubble -->
                    <div
                      v-if="item.kind === 'comment'"
                      class="px-2.5 py-1.5 rounded-lg text-xs mt-0.5"
                      :class="isThreadItemFromTeam(item) ? 'bg-primary/10 text-foreground rounded-tr-sm' : 'bg-muted text-foreground rounded-tl-sm'"
                    >
                      {{ item.body }}
                    </div>

                    <!-- Counter-proposal card -->
                    <div
                      v-else-if="item.kind === 'counter'"
                      class="p-2.5 rounded-lg border text-xs mt-0.5 space-y-2"
                      :class="item.status === 'open'
                        ? 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/40'
                        : 'border-border bg-muted/30 opacity-80'"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="font-semibold text-foreground">
                          <ArrowLeftRight class="w-3.5 h-3.5 inline mr-1 text-primary" />
                          Counter-discount: <span class="text-primary font-bold">{{ Number(item.proposedDiscountPercent) }}%</span>
                          {{ item.line ? `on ${negotiationLineLabel(item.line)}` : 'on the whole order' }}
                        </div>
                        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0" :class="negotiationRequestBadge(item.status).class">
                          {{ negotiationRequestBadge(item.status).label }}
                        </span>
                      </div>
                      <p v-if="item.note" class="text-muted-foreground italic">"{{ item.note }}"</p>
                      <p v-if="item.decisionNote" class="text-[10px] text-muted-foreground">Response: "{{ item.decisionNote }}"</p>
                      <div v-if="item.status === 'open' && canManageNegotiation" class="flex gap-2">
                        <Button
                          size="sm"
                          class="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          :disabled="negotiationBusyId === item.id"
                          @click="resolveCounter(item.id, 'accept')"
                        >
                          <CheckCircle2 class="w-3.5 h-3.5 mr-1" />
                          Accept (updates terms)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          class="h-7 text-xs"
                          :disabled="negotiationBusyId === item.id"
                          @click="resolveCounter(item.id, 'decline')"
                        >
                          <XCircle class="w-3.5 h-3.5 mr-1" />
                          Decline
                        </Button>
                      </div>
                      <p v-else-if="item.status === 'open'" class="text-[10px] text-muted-foreground">Waiting for a manager or org admin to decide.</p>
                    </div>

                    <!-- Change-request card -->
                    <div
                      v-else
                      class="p-2.5 rounded-lg border text-xs mt-0.5 space-y-2"
                      :class="item.status === 'open'
                        ? 'border-sky-300/60 bg-sky-50 dark:bg-sky-950/40'
                        : 'border-border bg-muted/30 opacity-80'"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="font-semibold text-foreground capitalize">
                          <FileEdit class="w-3.5 h-3.5 inline mr-1 text-primary" />
                          {{ item.requestType.replace('_', ' ') }}
                          <template v-if="item.proposedQuantity"> → qty {{ item.proposedQuantity }}</template>
                          <template v-if="item.proposedDiscountPercent"> → {{ Number(item.proposedDiscountPercent) }}%</template>
                        </div>
                        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0" :class="negotiationRequestBadge(item.status).class">
                          {{ negotiationRequestBadge(item.status).label }}
                        </span>
                      </div>
                      <p v-if="item.note" class="text-muted-foreground italic">"{{ item.note }}"</p>
                      <p v-if="item.resolutionNote" class="text-[10px] text-muted-foreground">Response: "{{ item.resolutionNote }}"</p>
                      <div v-if="item.status === 'open' && canManageNegotiation" class="flex gap-2">
                        <Button
                          size="sm"
                          class="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          :disabled="negotiationBusyId === item.id"
                          @click="resolveChangeRequest(item.id, 'accept')"
                        >
                          <CheckCircle2 class="w-3.5 h-3.5 mr-1" />
                          Accept (updates terms)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          class="h-7 text-xs"
                          :disabled="negotiationBusyId === item.id"
                          @click="resolveChangeRequest(item.id, 'decline')"
                        >
                          <XCircle class="w-3.5 h-3.5 mr-1" />
                          Decline
                        </Button>
                      </div>
                      <p v-else-if="item.status === 'open'" class="text-[10px] text-muted-foreground">Waiting for a manager or org admin to decide.</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Internal reply -->
              <div class="flex gap-2 pt-1 border-t border-border/70">
                <Input
                  v-model="negotiationComment"
                  placeholder="Reply to the customer..."
                  class="h-8 text-xs"
                  @keydown.enter="postInternalComment"
                />
                <Button
                  size="sm"
                  class="h-8 text-xs"
                  :disabled="!negotiationComment.trim() || negotiationBusyId === 'internal-comment'"
                  @click="postInternalComment"
                >
                  Reply
                </Button>
              </div>
            </CardContent>
          </Card>

          <!-- Order Fulfillment (Phase 16): proposed split, Ops override, accept -->
          <Card v-if="isEditMode && isFulfillable" class="border-border bg-card shadow-xs">
            <CardHeader class="pb-2 border-b border-border/70">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Boxes class="w-4 h-4 text-primary" />
                    Order Fulfillment
                    <Badge
                      v-if="fulfillmentPlan"
                      variant="outline"
                      class="text-2xs uppercase"
                      :class="fulfillmentPlan.plan.status === 'accepted'
                        ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300'
                        : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300'"
                    >
                      {{ fulfillmentPlan.plan.status === 'accepted' ? 'Fulfilled' : 'Proposed' }}
                    </Badge>
                  </CardTitle>
                  <CardDescription class="text-xs">
                    <template v-if="fulfillmentPlan">
                      {{ fulfillmentPlan.plan.shipmentCount }}
                      {{ fulfillmentPlan.plan.shipmentCount === 1 ? 'shipment' : 'shipments' }} ·
                      {{ fulfillmentPlan.plan.deliveryExtendedDays > 0
                        ? `Delivery extended by ${fulfillmentPlan.plan.deliveryExtendedDays} days — no extra charge.`
                        : 'Single-warehouse delivery — no extra charge.' }}
                    </template>
                    <template v-else>Live stock split proposal for this order.</template>
                  </CardDescription>
                </div>
                <div v-if="canManageFulfillment && fulfillmentPlan?.plan.status === 'proposed'" class="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-7 text-xs"
                    :disabled="isFulfillmentBusy !== null"
                    @click="regenerateFulfillment"
                  >
                    <RotateCcw class="w-3 h-3 mr-1" :class="{ 'animate-spin': isFulfillmentBusy === 'regenerate' }" />
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    class="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    :disabled="isFulfillmentBusy !== null"
                    @click="acceptFulfillment"
                  >
                    <CheckCircle2 class="w-3 h-3 mr-1" :class="{ 'animate-spin': isFulfillmentBusy === 'accept' }" />
                    Accept Fulfillment
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent class="pt-4 space-y-4">
              <!-- Feedback -->
              <div v-if="fulfillmentError" class="p-2 rounded-md bg-destructive/10 text-destructive text-xs">{{ fulfillmentError }}</div>
              <div v-if="fulfillmentNotice" class="p-2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs">{{ fulfillmentNotice }}</div>

              <div v-if="isFulfillmentLoading" class="py-8 text-center text-xs text-muted-foreground">
                <RefreshCw class="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                Preparing the stock split proposal...
              </div>

              <template v-else-if="fulfillmentPlan">
                <!-- Per-line table -->
                <div class="rounded-md border border-border overflow-x-auto">
                  <Table class="min-w-[560px]">
                    <TableHeader>
                      <TableRow class="bg-muted/50">
                        <TableHead class="font-semibold text-xs">Product</TableHead>
                        <TableHead class="text-center font-semibold text-xs">Ordered</TableHead>
                        <TableHead class="font-semibold text-xs">Ships From</TableHead>
                        <TableHead class="text-center font-semibold text-xs">Status</TableHead>
                        <TableHead v-if="canManageFulfillment && fulfillmentPlan.plan.status === 'proposed'" class="text-right font-semibold text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow v-for="line in fulfillmentPlan.lines" :key="line.quotationLineId" class="hover:bg-muted/20">
                        <TableCell>
                          <div class="text-xs font-semibold text-foreground">{{ line.productName }}</div>
                          <div class="text-2xs text-muted-foreground">{{ line.sku }}</div>
                        </TableCell>
                        <TableCell class="text-center text-xs font-bold text-foreground">
                          {{ line.orderedQuantity }}
                        </TableCell>
                        <TableCell>
                          <!-- Inline override editor -->
                          <div v-if="overrideLineId === line.quotationLineId" class="flex flex-wrap items-center gap-1.5 py-1">
                            <select
                              v-model="overrideWarehouseId"
                              class="h-7 px-2 rounded-md border border-input bg-background text-2xs text-foreground"
                            >
                              <option :value="''" disabled>Pick warehouse...</option>
                              <option v-for="w in overrideWarehouseOptions" :key="w.id" :value="w.id">
                                {{ w.name }} (stock {{ w.available }})
                              </option>
                            </select>
                            <Input
                              :model-value="overrideQuantity ?? undefined"
                              @update:model-value="(v: any) => (overrideQuantity = v === null || v === '' ? null : Number(v))"
                              type="number"
                              min="1"
                              class="h-7 w-16 text-center text-2xs"
                            />
                            <Button size="sm" class="h-7 text-xs" :disabled="isFulfillmentBusy === line.quotationLineId" @click="saveOverride(line)">
                              Save
                            </Button>
                            <Button variant="outline" size="sm" class="h-7 text-xs" @click="cancelOverride">Cancel</Button>
                          </div>
                          <div v-else-if="line.allocations.length > 0" class="flex flex-wrap gap-1.5">
                            <Badge
                              v-for="alloc in line.allocations"
                              :key="alloc.fulfillmentLineId"
                              variant="outline"
                              class="text-2xs font-medium bg-muted/40"
                            >
                              {{ alloc.quantity }} × {{ alloc.warehouseName }}
                            </Badge>
                          </div>
                          <span v-else class="text-2xs text-muted-foreground">No stock allocated</span>
                        </TableCell>
                        <TableCell class="text-center">
                          <Badge
                            variant="outline"
                            class="text-2xs"
                            :class="fulfillmentLineBadge(line.lineStatus).class"
                          >
                            {{ fulfillmentLineBadge(line.lineStatus).label }}
                          </Badge>
                        </TableCell>
                        <TableCell v-if="canManageFulfillment && fulfillmentPlan.plan.status === 'proposed'" class="text-right">
                          <Button
                            v-if="line.allocations.length > 0 && overrideLineId !== line.quotationLineId"
                            variant="ghost"
                            size="sm"
                            class="h-7 text-xs"
                            @click="openOverride(line)"
                          >
                            <Pencil class="w-3 h-3 mr-1" />
                            Reassign
                          </Button>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <!-- Accepted summary -->
                <div v-if="fulfillmentPlan.plan.status === 'accepted'" class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-300/50 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
                  <CheckCircle2 class="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Fulfilled{{ fulfillmentPlan.plan.acceptedAt ? ` on ${new Date(fulfillmentPlan.plan.acceptedAt).toLocaleString()}` : '' }} —
                    stock was deducted from the assigned warehouses.
                    <template v-if="fulfillmentPlan.plan.deliveryExtendedDays > 0">
                      Customer delivery was extended by {{ fulfillmentPlan.plan.deliveryExtendedDays }} days at no extra charge.
                    </template>
                  </span>
                </div>
              </template>

              <div v-else class="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-md">
                No fulfillment plan yet — it is generated automatically the first time this page is opened.
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- RIGHT COLUMN: Customer Request, Tier & Pricing Breakdown Card (4 cols) -->
        <div class="lg:col-span-4 space-y-6">
          <!-- Customer Request Card -->
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <div class="flex items-center justify-between">
                <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                  <User class="w-4 h-4 text-primary" />
                  Customer Request
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs text-primary hover:bg-primary/10 p-1"
                  @click="isCustomerDialogOpen = true"
                >
                  <Plus class="w-3.5 h-3.5 mr-1" />
                  New Customer
                </Button>
              </div>
            </CardHeader>

            <CardContent class="space-y-4 pt-4">
              <div class="space-y-1.5">
                <Label class="text-xs font-semibold">
                  {{ isEditMode ? 'Customer' : 'Whose request are you quoting?' }}
                </Label>
                <select
                  v-model="selectedCustomerId"
                  class="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
                >
                  <option value="" disabled>-- Choose a customer --</option>
                  <option
                    v-for="c in customers"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.name }} ({{ c.company || c.email }})
                  </option>
                </select>
              </div>

              <!-- Selected Customer Requirement Details & Tier -->
              <div
                v-if="selectedCustomer"
                class="p-3 rounded-lg bg-muted/40 border border-border/70 space-y-2 text-xs"
              >
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Assigned Tier:</span>
                  <Badge variant="outline" class="text-xs uppercase font-bold text-primary">
                    {{ selectedCustomerTier?.name || 'Standard' }}
                  </Badge>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Default Discount:</span>
                  <span class="font-semibold text-foreground">
                    {{ Number(selectedCustomerTier?.defaultDiscountPercent || 0) }}%
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Email:</span>
                  <span class="text-foreground truncate max-w-[150px]">{{ selectedCustomer.email }}</span>
                </div>
                <div v-if="selectedCustomer.company" class="flex items-center justify-between">
                  <span class="text-muted-foreground">Company:</span>
                  <span class="text-foreground truncate max-w-[150px]">{{ selectedCustomer.company }}</span>
                </div>
                <div v-if="selectedCustomer.phone" class="flex items-center justify-between">
                  <span class="text-muted-foreground">Phone:</span>
                  <span class="text-foreground">{{ selectedCustomer.phone }}</span>
                </div>
                <div v-if="selectedCustomer.address" class="flex items-start justify-between gap-3">
                  <span class="text-muted-foreground shrink-0">Address:</span>
                  <span class="text-foreground text-right">{{ selectedCustomer.address }}</span>
                </div>
              </div>
              <div
                v-else-if="!isEditMode"
                class="p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground text-center"
              >
                No customer selected yet — quotations are always built for a customer request.
              </div>
            </CardContent>
          </Card>

          <!-- Governance Core (Stage 3): Live Discount Risk Score Card -->
          <RiskScoreBadge
            :risk-score="risk.riskScore"
            :risk-level="risk.riskLevel"
            :approval-routing="risk.approvalRouting"
            :routing-reason="risk.routingReason"
            :has-line-over-ceiling="risk.hasLineOverCeiling"
            :over-ceiling-line-count="risk.overCeilingLineCount"
            :total-lines="risk.totalLines"
            :lines="risk.lines"
          />

          <!-- Pricing & Financial Margin Summary Card -->
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                <DollarSign class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Quotation Summary & Margin
              </CardTitle>
            </CardHeader>

            <CardContent class="space-y-4 pt-4 text-xs">
              <!-- Live pricing failure / tier warning -->
              <div v-if="recalcError" class="p-2.5 rounded-md bg-amber-100 dark:bg-amber-950/60 border border-amber-300 text-amber-800 dark:text-amber-200 text-2xs flex items-start gap-1.5">
                <AlertTriangle class="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{{ recalcError }}</span>
              </div>

              <!-- Subtotal before order discount -->
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Gross Subtotal:</span>
                <span class="font-semibold text-foreground">{{ formatCurrency(totals.subtotal) }}</span>
              </div>

              <div class="flex items-center justify-between text-muted-foreground">
                <span>Line Discounts:</span>
                <span class="text-destructive font-medium">
                  -{{ formatCurrency(totals.totalDiscount - totals.orderDiscountAmount) }}
                </span>
              </div>

              <!-- Order Level Discount Input -->
              <div class="pt-2 border-t border-border/50 space-y-1.5">
                <div class="flex items-center justify-between">
                  <Label class="text-xs font-semibold flex items-center gap-1">
                    <Tag class="w-3.5 h-3.5 text-primary" />
                    Order-Level Discount:
                  </Label>
                  <div class="flex items-center gap-1">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      v-model.number="orderDiscountPercent"
                      @input="debouncedRecalculate"
                      @change="debouncedRecalculate"
                      class="h-7 w-16 text-right text-xs"
                    />
                    <span class="text-2xs text-muted-foreground">%</span>
                  </div>
                </div>
                <div v-if="totals.orderDiscountAmount > 0" class="flex justify-between text-2xs text-destructive">
                  <span>Order discount applied:</span>
                  <span>-{{ formatCurrency(totals.orderDiscountAmount) }}</span>
                </div>
              </div>

              <!-- Grand Total -->
              <div class="pt-3 border-t border-border/70 flex items-baseline justify-between">
                <span class="text-sm font-bold text-foreground">Net Total Amount:</span>
                <span class="text-lg font-extrabold text-primary">
                  {{ formatCurrency(totals.totalAmount) }}
                </span>
              </div>

              <!-- Revenue Breakdown (One-Time vs Recurring) -->
              <div class="p-3 rounded-lg bg-muted/40 border border-border/70 space-y-1.5 text-2xs">
                <div class="font-semibold text-foreground uppercase tracking-wider text-3xs">
                  Revenue Breakdown
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">One-time Products:</span>
                  <span class="font-medium text-foreground">{{ formatCurrency(totals.oneTimeTotal) }}</span>
                </div>
                <div v-if="totals.recurringMonthlyTotal > 0" class="flex justify-between text-primary">
                  <span>Monthly Recurring (MRR):</span>
                  <span class="font-bold">{{ formatCurrency(totals.recurringMonthlyTotal) }}/mo</span>
                </div>
                <div v-if="totals.recurringAnnualTotal > 0" class="flex justify-between text-primary">
                  <span>Annual Recurring (ARR):</span>
                  <span class="font-bold">{{ formatCurrency(totals.recurringAnnualTotal) }}/yr</span>
                </div>
              </div>

              <!-- Margin Indicator: green on profit, red on loss -->
              <div
                class="p-3 rounded-lg border space-y-2 transition-colors"
                :class="marginTone(totals.totalMarginPercent).bg"
              >
                <div class="flex items-center justify-between">
                  <span
                    class="font-semibold flex items-center gap-1"
                    :class="marginTone(totals.totalMarginPercent).text"
                  >
                    <Sparkles class="w-3.5 h-3.5" />
                    Total Deal Margin
                  </span>
                  <Badge
                    variant="outline"
                    :class="['font-bold text-xs', getMarginBadgeClass(totals.totalMarginPercent)]"
                  >
                    {{ Number(totals.totalMarginPercent).toFixed(1) }}%
                  </Badge>
                </div>
                <div
                  class="flex justify-between text-2xs"
                  :class="marginTone(totals.totalMarginPercent).text"
                >
                  <span>Gross Profit:</span>
                  <span class="font-bold">{{ formatCurrency(totals.totalMargin) }}</span>
                </div>
                <div class="flex justify-between text-3xs text-muted-foreground">
                  <span>Estimated Total Cost:</span>
                  <span>{{ formatCurrency(totals.totalCost) }}</span>
                </div>
              </div>
            </CardContent>

            <CardFooter class="pt-2">
              <Button
                @click="handleSaveQuotation"
                :disabled="isSaving"
                class="w-full font-semibold shadow-xs"
              >
                <Save class="w-4 h-4 mr-1.5" />
                {{ isSaving ? 'Saving...' : (isEditMode ? 'Update Quotation' : 'Create Quotation') }}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      <!-- PRODUCT PICKER MODAL -->
      <Dialog :open="isProductDialogOpen" @update:open="isProductDialogOpen = $event">
        <DialogContent class="max-w-2xl">
          <DialogHeader>
            <DialogTitle class="text-base flex items-center gap-2">
              <Layers class="w-4 h-4 text-primary" />
              Select Product or Service
            </DialogTitle>
            <DialogDescription class="text-xs">
              Add catalog items to this quotation. Tier pricing will be applied automatically.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-3 py-2">
            <div class="flex flex-col sm:flex-row gap-2">
              <div class="relative flex-1">
                <Input
                  v-model="productSearch"
                  placeholder="Search catalog by name or SKU..."
                  class="h-9 text-xs"
                />
              </div>
              <select
                v-model="selectedCategoryFilter"
                class="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden"
              >
                <option value="">All Categories</option>
                <option value="hardware">Hardware</option>
                <option value="services">Services</option>
                <option value="subscriptions">Subscriptions</option>
              </select>
            </div>

            <div class="max-h-80 overflow-y-auto rounded-md border border-border divide-y divide-border">
              <div
                v-for="p in filteredProducts"
                :key="p.id"
                class="p-3 hover:bg-muted/40 transition-colors flex items-center justify-between cursor-pointer"
                @click="addProductToQuote(p)"
              >
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-xs text-foreground">{{ p.name }}</span>
                    <Badge
                      variant="outline"
                      :class="['text-3xs px-1 py-0', getCategoryBadgeClass(p.category?.code)]"
                    >
                      {{ p.category?.name || 'General' }}
                    </Badge>
                  </div>
                  <div class="flex items-center gap-3 text-2xs text-muted-foreground">
                    <span>SKU: {{ p.sku }}</span>
                    <span>•</span>
                    <span class="capitalize">{{ p.billingFrequency.replace('_', ' ') }}</span>
                  </div>
                </div>

                <div class="text-right">
                  <div class="font-bold text-xs text-foreground">{{ formatCurrency(p.price) }}</div>
                  <Button size="sm" variant="ghost" class="h-7 text-xs text-primary p-1">
                    <Plus class="w-3.5 h-3.5 mr-1" />
                    Add
                  </Button>
                </div>
              </div>

              <div v-if="filteredProducts.length === 0" class="py-8 text-center text-xs text-muted-foreground">
                No catalog items match your filter.
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" @click="isProductDialogOpen = false">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- QUICK ADD CUSTOMER MODAL -->
      <Dialog :open="isCustomerDialogOpen" @update:open="isCustomerDialogOpen = $event">
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle class="text-base flex items-center gap-2">
              <User class="w-4 h-4 text-primary" />
              Quick Add Customer
            </DialogTitle>
            <DialogDescription class="text-xs">
              Create a new customer profile and assign a pricing tier.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-3 py-2">
            <div class="space-y-1">
              <Label class="text-xs font-semibold">Customer Full Name *</Label>
              <Input
                v-model="newCustomerForm.name"
                placeholder="e.g. Acme Corporation / Alice Smith"
                class="h-8 text-xs"
              />
            </div>

            <div class="space-y-1">
              <Label class="text-xs font-semibold">Email Address *</Label>
              <Input
                type="email"
                v-model="newCustomerForm.email"
                placeholder="customer@example.com"
                class="h-8 text-xs"
              />
            </div>

            <div class="space-y-1">
              <Label class="text-xs font-semibold">Company Name</Label>
              <Input
                v-model="newCustomerForm.company"
                placeholder="Company or Organization Inc."
                class="h-8 text-xs"
              />
            </div>

            <div class="space-y-1">
              <Label class="text-xs font-semibold">Pricing Tier *</Label>
              <select
                v-model="newCustomerForm.tierId"
                class="w-full h-8 px-2 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden"
              >
                <option
                  v-for="t in customerTiers"
                  :key="t.id"
                  :value="t.id"
                >
                  {{ t.name }} ({{ Number(t.defaultDiscountPercent) }}% default discount)
                </option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" @click="isCustomerDialogOpen = false">
              Cancel
            </Button>
            <Button
              size="sm"
              @click="handleCreateCustomer"
              :disabled="isCreatingCustomer || !newCustomerForm.name || !newCustomerForm.email"
            >
              {{ isCreatingCustomer ? 'Creating...' : 'Create & Select' }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- SUBMIT FOR APPROVAL MODAL -->
      <Dialog :open="isSubmitDialogOpen" @update:open="isSubmitDialogOpen = $event">
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle class="text-base flex items-center gap-2">
              <Send class="w-4 h-4 text-primary" />
              Submit Quotation for Review
            </DialogTitle>
            <DialogDescription class="text-xs">
              This quotation will be evaluated against rulebook ceilings and routed to approvers per policy.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-3 py-2 text-xs">
            <div class="p-3 rounded-lg bg-muted border space-y-1">
              <div class="flex justify-between font-semibold text-foreground">
                <span>Quotation Number:</span>
                <span>{{ quotationNumber }}</span>
              </div>
              <div class="flex justify-between text-muted-foreground">
                <span>Risk Level:</span>
                <span class="uppercase font-bold text-foreground">{{ risk.riskLevel }}</span>
              </div>
              <div class="flex justify-between text-muted-foreground">
                <span>Routing Action:</span>
                <span class="capitalize font-semibold text-foreground">{{ risk.approvalRouting.replace('_', ' → ') }}</span>
              </div>
            </div>

            <div class="space-y-1">
              <Label class="text-xs font-semibold">Submission Remarks (Optional)</Label>
              <Textarea
                v-model="submitNotes"
                placeholder="Include deal background or strategic justifications for reviewers..."
                rows="3"
                class="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" @click="isSubmitDialogOpen = false" :disabled="isSubmittingApproval">
              Cancel
            </Button>
            <Button size="sm" @click="handleSubmitForApproval" :disabled="isSubmittingApproval">
              <RotateCcw v-if="isSubmittingApproval" class="w-4 h-4 mr-1.5 animate-spin" />
              Submit Quotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- DIRECT APPROVER ACTION MODAL (Manager / Finance) -->
      <Dialog :open="isApproverActionDialogOpen" @update:open="isApproverActionDialogOpen = $event">
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle class="text-base flex items-center gap-2">
              <component
                :is="approverActionType === 'approve' ? CheckCircle2 : XCircle"
                class="w-4 h-4"
                :class="approverActionType === 'approve' ? 'text-emerald-600' : 'text-destructive'"
              />
              {{ approverActionType === 'approve' ? 'Approve Quotation Terms' : 'Reject Quotation' }}
            </DialogTitle>
            <DialogDescription class="text-xs">
              Provide mandatory governance reason. An immutable audit record will be logged.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-3 py-2 text-xs">
            <div class="space-y-1">
              <Label class="text-xs font-semibold">
                Mandatory Explanation <span class="text-destructive">*</span>
              </Label>
              <Textarea
                v-model="approverReason"
                rows="3"
                placeholder="Mandatory rationale for this approval or rejection decision..."
                class="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" @click="isApproverActionDialogOpen = false" :disabled="isProcessingApproverAction">
              Cancel
            </Button>
            <Button
              :variant="approverActionType === 'approve' ? 'default' : 'destructive'"
              size="sm"
              :class="approverActionType === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''"
              :disabled="isProcessingApproverAction || !approverReason.trim()"
              @click="handleDirectApproverAction"
            >
              <RotateCcw v-if="isProcessingApproverAction" class="w-4 h-4 mr-1.5 animate-spin" />
              Confirm {{ approverActionType === 'approve' ? 'Approval' : 'Rejection' }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- CUSTOMER MAGIC LINK DISPATCHED MODAL -->
      <Dialog :open="isSendCustomerDialogOpen" @update:open="isSendCustomerDialogOpen = $event">
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle class="text-base flex items-center gap-2 text-emerald-600">
              <CheckCircle2 class="w-5 h-5 text-emerald-600" />
              Customer Magic Link Dispatched!
            </DialogTitle>
            <DialogDescription class="text-xs">
              The quotation review invitation has been sent via email to <strong>{{ dispatchedRecipientEmail }}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div class="space-y-4 py-2 text-xs">
            <div class="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-900 p-3 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
              <span class="font-semibold block">One Link, One Channel:</span>
              <p>
                The customer reviews, comments, counters discounts, and confirms the
                deal — all through the link we just emailed them. You'll see every
                message live in the Customer Negotiation panel below.
              </p>
            </div>
          </div>

          <DialogFooter class="flex sm:justify-between items-center gap-2">
            <a
              :href="generatedPortalUrl || '#'"
              target="_blank"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-semibold text-primary hover:bg-muted"
            >
              <ExternalLink class="w-3.5 h-3.5" />
              Open Customer Portal
            </a>
            <Button size="sm" @click="isSendCustomerDialogOpen = false">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </WorkspaceLayout>
</template>