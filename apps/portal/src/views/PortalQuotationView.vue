<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customerAuth } from '@/lib/auth';
import { portalApiRequest } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  Printer,
  ShieldCheck,
  User,
  Layers,
  MessageCircle,
  Send,
  RefreshCw,
  ArrowLeftRight,
  FileEdit,
  Hourglass,
} from 'lucide-vue-next';

// Customers only see the issuing org's identity (name + logo) — internal
// contact details, address, and timezone are never exposed on the portal.
interface OrgBranding {
  id: string;
  name: string;
  logoUrl?: string | null;
  currency: string;
}

interface QuotationLine {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  lineDiscountPercent: number;
  lineTotal: number;
  product: {
    name: string;
    sku: string;
    description?: string | null;
    category?: {
      name: string;
    } | null;
  };
}

interface QuotationDetail {
  id: string;
  quotationNumber: string;
  title: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'sent' | 'negotiating' | 'confirmed' | 'rejected';
  orderDiscountPercent: number;
  subtotal: number;
  totalDiscount: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  validUntil?: string | null;
  createdAt: string;
  customer: {
    name: string;
    email: string;
    company?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  lines: QuotationLine[];
}

interface NegotiationComment {
  id: string;
  lineId: string | null;
  authorType: 'customer' | 'internal';
  authorName: string;
  body: string;
  createdAt: string;
  line?: { id: string; productId: string } | null;
}

interface ChangeRequest {
  id: string;
  lineId: string | null;
  requestType: 'quantity_change' | 'remove_line' | 'discount_change' | 'other';
  proposedQuantity: number | null;
  proposedDiscountPercent: string | null;
  note: string | null;
  status: 'open' | 'accepted' | 'declined' | 'applied';
  requestedByName: string;
  resolutionNote: string | null;
  createdAt: string;
  line?: { id: string; productId: string } | null;
}

interface CounterProposal {
  id: string;
  lineId: string | null;
  proposedDiscountPercent: string;
  note: string | null;
  status: 'open' | 'accepted' | 'declined' | 'superseded';
  proposedByName: string;
  decisionNote: string | null;
  createdAt: string;
  line?: { id: string; productId: string } | null;
}

interface NegotiationData {
  quotation: {
    id: string;
    quotationNumber: string;
    status: string;
    riskLevel: string;
    approvalRouting: string;
    customerName: string;
  };
  comments: NegotiationComment[];
  changeRequests: ChangeRequest[];
  counterProposals: CounterProposal[];
}

const route = useRoute();
const router = useRouter();

const isLoading = ref(true);
const errorMessage = ref<string | null>(null);
const branding = ref<OrgBranding | null>(null);
const quotation = ref<QuotationDetail | null>(null);
const negotiation = ref<NegotiationData | null>(null);
const logoSrc = ref<string | null>(null);

/**
 * The logo endpoint requires the Bearer token, which an <img src> cannot
 * send — fetch it as a blob and render via an object URL instead.
 */
async function loadLogo() {
  if (!branding.value?.logoUrl || !customerAuth.state.token) return;
  try {
    const res = await fetch(branding.value.logoUrl, {
      headers: { Authorization: `Bearer ${customerAuth.state.token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    logoSrc.value = URL.createObjectURL(blob);
  } catch {
    // Non-fatal: header falls back to the initials tile
  }
}

// ---- Negotiation form state ----
const currentQuoteId = ref<string | null>(null);
const commentBody = ref('');
const commentLineId = ref<string | null>(null);
const counterScope = ref<'order' | 'line'>('order');
const counterLineId = ref<string | null>(null);
const counterDiscount = ref<number | null>(null);
const counterNote = ref('');
const changeType = ref<'quantity_change' | 'remove_line' | 'discount_change' | 'other'>('quantity_change');
const changeLineId = ref<string | null>(null);
const changeQuantity = ref<number | null>(null);
const changeDiscount = ref<number | null>(null);
const changeNote = ref('');

const isCounterFormOpen = ref(false);
const isChangeFormOpen = ref(false);
const submitting = ref<string | null>(null);
const negotiationError = ref<string | null>(null);
const negotiationNotice = ref<string | null>(null);
const chatFeedEl = ref<HTMLElement | null>(null);

const canNegotiate = computed(() =>
  quotation.value !== null && ['sent', 'negotiating', 'approved'].includes(quotation.value.status)
);

const canConfirm = computed(() =>
  quotation.value !== null && ['sent', 'negotiating', 'approved'].includes(quotation.value.status)
);

/**
 * Unified chat timeline — comments, counter-proposals and change requests
 * merged chronologically so the whole negotiation reads as one conversation
 * with the deal actions embedded as cards.
 */
type TimelineItem =
  | {
      kind: 'comment';
      id: string;
      createdAt: string;
      authorType: 'customer' | 'internal';
      authorName: string;
      body: string;
      lineId: string | null;
    }
  | {
      kind: 'counter';
      id: string;
      createdAt: string;
      proposedDiscountPercent: string;
      note: string | null;
      status: string;
      decisionNote: string | null;
      lineId: string | null;
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
      lineId: string | null;
    };

const negotiationTimeline = computed<TimelineItem[]>(() => {
  const data = negotiation.value;
  if (!data) return [];
  const items: TimelineItem[] = [];

  for (const c of data.comments ?? []) {
    items.push({
      kind: 'comment',
      id: c.id,
      createdAt: c.createdAt,
      authorType: c.authorType,
      authorName: c.authorName,
      body: c.body,
      lineId: c.lineId,
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
      lineId: cp.lineId,
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
      lineId: cr.lineId,
    });
  }

  return items.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
});

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    chatFeedEl.value?.scrollTo({ top: chatFeedEl.value.scrollHeight, behavior: 'smooth' });
  });
}

// Keep the chat pinned to the newest message as the thread grows.
watch(
  () => negotiationTimeline.value.length,
  async () => {
    await nextTick();
    scrollChatToBottom();
  }
);

function lineLabel(lineId: string | null | undefined): string {
  if (!lineId || !quotation.value) return 'General';
  const line = quotation.value.lines.find((l) => l.id === lineId);
  return line ? line.product.name : 'Line item';
}

function setCommentTarget(lineId: string | null) {
  commentLineId.value = lineId;
  document.getElementById('negotiation-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Focus the composer after the scroll settles
  setTimeout(() => {
    (document.getElementById('chat-composer-input') as HTMLInputElement | null)?.focus();
  }, 350);
}

function toggleCounterForm() {
  isCounterFormOpen.value = !isCounterFormOpen.value;
  if (isCounterFormOpen.value) isChangeFormOpen.value = false;
}

function toggleChangeForm() {
  isChangeFormOpen.value = !isChangeFormOpen.value;
  if (isChangeFormOpen.value) isCounterFormOpen.value = false;
}

// Chat thread helpers — customer bubbles sit right, sales team left.
function isTeamItem(item: TimelineItem): boolean {
  return item.kind === 'comment' && item.authorType === 'internal';
}

function itemAuthor(item: TimelineItem): string {
  if (item.kind === 'comment') return item.authorType === 'customer' ? 'You' : item.authorName || 'Sales Team';
  return 'You';
}

function itemAvatar(item: TimelineItem): string {
  if (item.kind === 'comment' && item.authorType === 'internal') {
    return (item.authorName || 'ST').substring(0, 2).toUpperCase();
  }
  return (negotiation.value?.quotation.customerName || 'CU').substring(0, 2).toUpperCase();
}

function formatTimeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

async function loadNegotiation() {
  if (!currentQuoteId.value) return;
  try {
    negotiation.value = await portalApiRequest<NegotiationData>(
      `/api/portal/quotation/${currentQuoteId.value}/negotiation`
    );
  } catch {
    // Non-fatal — the discussion panel simply stays empty.
    negotiation.value = null;
  }
}

async function submitComment() {
  if (!commentBody.value.trim() || !currentQuoteId.value) return;
  submitting.value = 'comment';
  negotiationError.value = null;
  try {
    await portalApiRequest(`/api/portal/quotation/${currentQuoteId.value}/comments`, {
      method: 'POST',
      data: { lineId: commentLineId.value, body: commentBody.value.trim() },
    });
    commentBody.value = '';
    commentLineId.value = null;
    negotiationNotice.value = null;
    await refreshAfterAction();
  } catch (err: any) {
    negotiationError.value = err?.data?.error || err.message || 'Failed to send comment.';
  } finally {
    submitting.value = null;
  }
}

async function submitCounter() {
  if (!currentQuoteId.value) return;
  if (counterDiscount.value === null || counterDiscount.value < 0 || counterDiscount.value > 100) {
    negotiationError.value = 'Enter a discount between 0 and 100.';
    return;
  }
  submitting.value = 'counter';
  negotiationError.value = null;
  try {
    await portalApiRequest(`/api/portal/quotation/${currentQuoteId.value}/counters`, {
      method: 'POST',
      data: {
        lineId: counterScope.value === 'line' ? counterLineId.value : null,
        proposedDiscountPercent: counterDiscount.value,
        note: counterNote.value.trim() || undefined,
      },
    });
    counterDiscount.value = null;
    counterNote.value = '';
    isCounterFormOpen.value = false;
    negotiationNotice.value = null;
    await refreshAfterAction();
  } catch (err: any) {
    negotiationError.value = err?.data?.error || err.message || 'Failed to submit counter-proposal.';
  } finally {
    submitting.value = null;
  }
}

async function submitChangeRequest() {
  if (!currentQuoteId.value) return;
  submitting.value = 'change';
  negotiationError.value = null;
  try {
    await portalApiRequest(`/api/portal/quotation/${currentQuoteId.value}/change-requests`, {
      method: 'POST',
      data: {
        lineId: changeType.value === 'other' ? undefined : changeLineId.value,
        requestType: changeType.value,
        proposedQuantity: changeType.value === 'quantity_change' ? changeQuantity.value || undefined : undefined,
        proposedDiscountPercent: changeType.value === 'discount_change' ? changeDiscount.value ?? undefined : undefined,
        note: changeNote.value.trim() || undefined,
      },
    });
    changeQuantity.value = null;
    changeDiscount.value = null;
    changeNote.value = '';
    isChangeFormOpen.value = false;
    negotiationNotice.value = null;
    await refreshAfterAction();
  } catch (err: any) {
    negotiationError.value = err?.data?.error || err.message || 'Failed to submit change request.';
  } finally {
    submitting.value = null;
  }
}

async function confirmQuote() {
  if (!currentQuoteId.value) return;
  submitting.value = 'confirm';
  negotiationError.value = null;
  negotiationNotice.value = null;
  try {
    const result = await portalApiRequest<{ status: string; reenteredApproval: boolean }>(
      `/api/portal/quotation/${currentQuoteId.value}/confirm`,
      { method: 'POST', data: {} }
    );
    if (result.reenteredApproval) {
      negotiationNotice.value =
        'Thank you! Your confirmed terms exceed the standard approval thresholds, so the quotation has been routed to the approval team for a final sign-off. We will notify you once it is approved.';
    } else {
      negotiationNotice.value =
        'Deal closed — thank you for your business! Need another round? Send a message here and the quotation re-opens for review.';
    }
    await refreshAfterAction();
  } catch (err: any) {
    if (err?.status === 429) {
      negotiationError.value = 'Too many confirmation attempts. Please wait a minute and try again.';
    } else {
      negotiationError.value = err?.data?.error || err.message || 'Failed to confirm the quotation.';
    }
  } finally {
    submitting.value = null;
  }
}

async function refreshAfterAction() {
  await loadNegotiation();
  try {
    const quoteId = currentQuoteId.value;
    if (quoteId) {
      quotation.value = await portalApiRequest<QuotationDetail>(`/api/portal/quotation/${quoteId}`);
    }
  } catch {
    // keep the previous snapshot on refresh failure
  }
}

async function loadPortalData() {
  isLoading.value = true;
  errorMessage.value = null;

  try {
    if (!customerAuth.state.token) {
      // Check if URL has token
      const token = route.query.token as string;
      if (token) {
        customerAuth.setToken(token);
      } else {
        throw new Error('Access token missing. Please use the link provided in your email.');
      }
    }

    const quoteId = (route.params.id as string) || customerAuth.state.quotationIds[0];
    currentQuoteId.value = quoteId || null;

    const [brandingData, quoteData] = await Promise.all([
      portalApiRequest<OrgBranding>('/api/portal/organization'),
      portalApiRequest<QuotationDetail>(`/api/portal/quotation${quoteId ? `/${quoteId}` : ''}`),
    ]);

    branding.value = brandingData;
    quotation.value = quoteData;
    await loadNegotiation();
    loadLogo();
  } catch (err: any) {
    errorMessage.value = err.message || 'Unable to load quotation details.';
    if (err.status === 401 || err.status === 403) {
      customerAuth.clearToken();
    }
  } finally {
    isLoading.value = false;
  }
}

function handlePrint() {
  window.print();
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'sent':
      return { label: 'Active Quotation', class: 'bg-blue-500/10 text-blue-600 border-blue-300' };
    case 'negotiating':
      return { label: 'Under Negotiation', class: 'bg-indigo-500/10 text-indigo-600 border-indigo-300' };
    case 'approved':
      return { label: 'Verified & Ready', class: 'bg-emerald-500/10 text-emerald-600 border-emerald-300' };
    case 'confirmed':
      return { label: 'Order Confirmed', class: 'bg-purple-500/10 text-purple-600 border-purple-300' };
    case 'pending_approval':
      return { label: 'Pending Internal Review', class: 'bg-amber-500/10 text-amber-600 border-amber-300' };
    case 'rejected':
      return { label: 'Not Accepted', class: 'bg-red-500/10 text-red-600 border-red-300' };
    default:
      return { label: status.toUpperCase(), class: 'bg-muted text-muted-foreground border-border' };
  }
}

function requestStatusBadge(status: string) {
  switch (status) {
    case 'open':
      return { label: 'Awaiting review', class: 'bg-amber-500/10 text-amber-600 border-amber-300' };
    case 'accepted':
    case 'applied':
      return { label: status === 'applied' ? 'Applied to quote' : 'Accepted', class: 'bg-emerald-500/10 text-emerald-600 border-emerald-300' };
    case 'declined':
      return { label: 'Declined', class: 'bg-red-500/10 text-red-600 border-red-300' };
    case 'superseded':
      return { label: 'Superseded', class: 'bg-muted text-muted-foreground border-border' };
    default:
      return { label: status, class: 'bg-muted text-muted-foreground border-border' };
  }
}

onMounted(() => {
  loadPortalData();
});
</script>

<template>
  <div class="min-h-screen bg-muted/20 flex flex-col font-sans pb-16">
    <!-- Top Org Branding Header -->
    <header class="bg-card border-b border-border sticky top-0 z-30 shadow-xs">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            v-if="logoSrc"
            class="h-9 max-w-[140px] flex items-center overflow-hidden"
          >
            <img :src="logoSrc" :alt="branding?.name" class="h-full object-contain" />
          </div>
          <div v-else class="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center font-bold text-sm">
            {{ branding?.name ? branding.name.substring(0, 2).toUpperCase() : 'DF' }}
          </div>
          <div>
            <h1 class="font-bold text-base text-foreground leading-none">
              {{ branding?.name || 'Customer Portal' }}
            </h1>
            <p class="text-[11px] text-muted-foreground mt-0.5">Official Quotation & Proposal Review</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            @click="handlePrint"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-2xs"
          >
            <Printer class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">Print / Save PDF</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Container -->
    <main class="max-w-5xl w-full mx-auto px-4 sm:px-6 pt-8 flex-1">
      <!-- Loading State -->
      <div v-if="isLoading" class="text-center py-24 space-y-4">
        <div class="size-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto"></div>
        <p class="text-sm text-muted-foreground">Loading quotation and pricing details...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="errorMessage" class="max-w-lg mx-auto bg-card border border-destructive/30 rounded-2xl p-8 text-center space-y-4 shadow-xl">
        <div class="size-12 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <AlertCircle class="w-6 h-6" />
        </div>
        <div class="space-y-1">
          <h2 class="text-base font-bold text-destructive">Quotation Access Error</h2>
          <p class="text-xs text-muted-foreground">{{ errorMessage }}</p>
        </div>
        <div class="pt-4 border-t border-border">
          <p class="text-xs text-muted-foreground">
            If you received a magic link via email, please verify that it hasn't expired.
          </p>
        </div>
      </div>

      <!-- Quotation Content -->
      <div v-else-if="quotation" class="space-y-6">
        <!-- Quotation Hero Banner -->
        <div class="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
            <div class="space-y-1">
              <div class="flex items-center gap-2.5 flex-wrap">
                <h2 class="text-2xl font-bold tracking-tight text-foreground font-mono">
                  {{ quotation.quotationNumber }}
                </h2>
                <span
                  class="text-xs font-semibold px-2.5 py-0.5 rounded-full border"
                  :class="getStatusBadge(quotation.status).class"
                >
                  {{ getStatusBadge(quotation.status).label }}
                </span>
              </div>
              <p class="text-sm text-muted-foreground font-medium">{{ quotation.title }}</p>
            </div>

            <div class="sm:text-right space-y-1 text-xs text-muted-foreground">
              <div class="flex sm:justify-end items-center gap-1.5">
                <Calendar class="w-3.5 h-3.5" />
                <span>Issued: <strong>{{ formatDate(quotation.createdAt) }}</strong></span>
              </div>
              <div v-if="quotation.validUntil" class="flex sm:justify-end items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Clock class="w-3.5 h-3.5" />
                <span>Valid Until: <strong>{{ formatDate(quotation.validUntil) }}</strong></span>
              </div>
            </div>
          </div>

          <!-- Prepared For (Customer) -->
          <div class="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-2 text-xs">
            <div class="flex items-center gap-2 font-semibold text-foreground">
              <User class="w-4 h-4 text-primary" />
              <span>Prepared For:</span>
            </div>
            <div class="text-muted-foreground space-y-0.5">
              <p class="font-medium text-foreground text-sm">{{ quotation.customer.name }}</p>
              <p v-if="quotation.customer.company" class="font-medium">{{ quotation.customer.company }}</p>
              <p>{{ quotation.customer.email }}</p>
              <p v-if="quotation.customer.phone">{{ quotation.customer.phone }}</p>
            </div>
          </div>

          <!-- Notes Callout if present -->
          <div v-if="quotation.notes" class="rounded-xl bg-primary/5 border border-primary/20 p-4 text-xs text-foreground space-y-1">
            <span class="font-semibold text-primary block">Quotation Terms & Notes:</span>
            <p class="text-muted-foreground whitespace-pre-line">{{ quotation.notes }}</p>
          </div>
        </div>

        <!-- Line Items Table Card -->
        <div class="bg-card border border-border rounded-2xl shadow-xs overflow-hidden">
          <div class="px-6 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
            <div class="flex items-center gap-2 font-bold text-sm">
              <Layers class="w-4 h-4 text-primary" />
              <span>Items & Services</span>
            </div>
            <span class="text-xs text-muted-foreground">
              {{ quotation.lines.length }} {{ quotation.lines.length === 1 ? 'item' : 'items' }} listed
            </span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-muted/40 text-muted-foreground border-b border-border font-medium">
                <tr>
                  <th class="p-4">Item & Description</th>
                  <th class="p-4 text-center">Qty</th>
                  <th class="p-4 text-right">Unit Price</th>
                  <th class="p-4 text-right">Discount</th>
                  <th class="p-4 text-right">Total</th>
                  <th v-if="canNegotiate" class="p-4 text-center">Discuss</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <tr v-for="line in quotation.lines" :key="line.id" class="hover:bg-muted/20">
                  <td class="p-4 space-y-1">
                    <div class="font-semibold text-foreground text-sm flex items-center gap-2">
                      {{ line.product.name }}
                      <span v-if="line.product.category" class="text-[10px] font-normal px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                        {{ line.product.category.name }}
                      </span>
                    </div>
                    <div class="text-[11px] text-muted-foreground font-mono">
                      SKU: {{ line.product.sku }}
                    </div>
                    <div v-if="line.product.description" class="text-[11px] text-muted-foreground pt-0.5">
                      {{ line.product.description }}
                    </div>
                  </td>
                  <td class="p-4 text-center font-medium text-foreground">
                    {{ line.quantity }}
                  </td>
                  <td class="p-4 text-right font-mono text-muted-foreground">
                    {{ formatCurrency(line.unitPrice, branding?.currency) }}
                  </td>
                  <td class="p-4 text-right">
                    <span v-if="line.lineDiscountPercent > 0" class="text-emerald-600 font-semibold font-mono">
                      -{{ line.lineDiscountPercent }}%
                    </span>
                    <span v-else class="text-muted-foreground">-</span>
                  </td>
                  <td class="p-4 text-right font-bold text-foreground font-mono">
                    {{ formatCurrency(line.lineTotal, branding?.currency) }}
                  </td>
                  <td v-if="canNegotiate" class="p-4 text-center">
                    <button
                      @click="setCommentTarget(line.id)"
                      title="Comment on this line"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-background text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                    >
                      <MessageCircle class="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pricing Breakdown Footer -->
          <div class="p-6 bg-muted/10 border-t border-border flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div class="text-xs text-muted-foreground space-y-1 max-w-sm">
              <div class="flex items-center gap-1.5 text-foreground font-semibold">
                <ShieldCheck class="w-4 h-4 text-emerald-600" />
                <span>Price & Discount Lock Guarantee</span>
              </div>
              <p>
                All pricing and approved discount terms are guaranteed until the expiration date. Taxes are calculated based on registered company location.
              </p>
            </div>

            <div class="w-full sm:w-72 space-y-2 text-xs">
              <div class="flex justify-between text-muted-foreground">
                <span>Subtotal (Gross):</span>
                <span class="font-mono text-foreground">{{ formatCurrency(quotation.subtotal, branding?.currency) }}</span>
              </div>

              <div v-if="quotation.totalDiscount > 0" class="flex justify-between text-emerald-600">
                <span>Total Discounts Applied:</span>
                <span class="font-mono font-semibold">-{{ formatCurrency(quotation.totalDiscount, branding?.currency) }}</span>
              </div>

              <div v-if="quotation.orderDiscountPercent > 0" class="flex justify-between text-emerald-600 text-[11px]">
                <span>(Includes {{ quotation.orderDiscountPercent }}% Order Discount)</span>
              </div>

              <div class="flex justify-between text-muted-foreground">
                <span>Estimated Tax:</span>
                <span class="font-mono text-foreground">{{ formatCurrency(quotation.taxTotal, branding?.currency) }}</span>
              </div>

              <div class="pt-2 border-t border-border flex justify-between items-baseline font-bold text-base text-foreground">
                <span>Grand Total:</span>
                <span class="font-mono text-xl text-primary">{{ formatCurrency(quotation.grandTotal, branding?.currency) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Negotiation & Deal Chat (Phase 14) -->
        <div id="negotiation-card" class="rounded-2xl border border-primary/30 bg-card shadow-xs overflow-hidden">
          <div class="p-6 border-b border-border bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2 font-bold text-sm text-foreground">
                <MessageCircle class="w-4 h-4 text-primary" />
                <span>Deal Chat — Review, Refine & Close</span>
              </div>
              <p class="text-xs text-muted-foreground">
                Chat with your sales team, propose discounts, request changes — as many review
                rounds as you need. When the terms are right, close the deal with one click.
              </p>
            </div>

            <button
              v-if="canConfirm"
              :disabled="submitting === 'confirm'"
              @click="confirmQuote"
              class="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-60"
            >
              <RefreshCw v-if="submitting === 'confirm'" class="w-4 h-4 animate-spin" />
              <CheckCircle2 v-else class="w-4 h-4" />
              Confirm & Close Deal
            </button>
            <div v-else class="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-xs font-semibold">
              <CheckCircle2 class="w-4 h-4" />
              {{ quotation.status === 'confirmed' ? 'Deal Closed' : quotation.status === 'pending_approval' ? 'Awaiting Internal Approval' : 'Not Available' }}
            </div>
          </div>

          <!-- Action feedback -->
          <div v-if="negotiationNotice" class="mx-6 mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-300/50 text-emerald-700 text-xs flex items-start gap-2">
            <CheckCircle2 class="w-4 h-4 shrink-0 mt-0.5" />
            <span>{{ negotiationNotice }}</span>
          </div>
          <div v-if="negotiationError" class="mx-6 mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-start gap-2">
            <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
            <span>{{ negotiationError }}</span>
          </div>

          <div class="p-6" v-if="canNegotiate">
            <!-- Chat feed -->
            <div ref="chatFeedEl" class="h-80 overflow-y-auto rounded-xl bg-muted/20 border border-border/60 p-3 space-y-3 scroll-smooth">
              <div
                v-if="negotiationTimeline.length === 0"
                class="h-full grid place-items-center text-xs text-muted-foreground text-center"
              >
                <div class="space-y-1">
                  <MessageCircle class="w-6 h-6 mx-auto text-muted-foreground/50" />
                  <p>No messages yet — say hello or ask anything about your quotation.</p>
                  <p class="text-[11px]">Tip: click the chat icon on any line item above to discuss it specifically.</p>
                </div>
              </div>

              <div
                v-for="item in negotiationTimeline"
                :key="item.kind + '-' + item.id"
                class="flex gap-2.5"
                :class="isTeamItem(item) ? '' : 'flex-row-reverse'"
              >
                <div
                  class="size-7 rounded-lg grid place-items-center text-[10px] font-bold shrink-0"
                  :class="isTeamItem(item) ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'"
                >
                  {{ itemAvatar(item) }}
                </div>
                <div class="max-w-[82%] space-y-0.5">
                  <div class="flex items-center gap-2 text-[11px] text-muted-foreground" :class="isTeamItem(item) ? '' : 'sm:flex-row-reverse'">
                    <span class="font-semibold text-foreground">{{ itemAuthor(item) }}</span>
                    <span v-if="item.lineId" class="px-1.5 py-0.5 rounded bg-muted border border-border">{{ lineLabel(item.lineId) }}</span>
                    <span class="text-[10px]">{{ formatTimeShort(item.createdAt) }}</span>
                  </div>

                  <!-- Comment bubble -->
                  <div
                    v-if="item.kind === 'comment'"
                    class="px-3 py-2 rounded-xl text-xs"
                    :class="isTeamItem(item) ? 'bg-muted text-foreground rounded-tl-sm' : 'bg-primary text-primary-foreground rounded-tr-sm'"
                  >
                    {{ item.body }}
                  </div>

                  <!-- Counter-proposal card -->
                  <div
                    v-else-if="item.kind === 'counter'"
                    class="p-3 rounded-xl border text-xs space-y-1.5"
                    :class="item.status === 'open'
                      ? 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 rounded-tr-sm'
                      : 'border-border bg-muted/30 rounded-tr-sm'"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="font-semibold text-foreground">
                        <ArrowLeftRight class="w-3.5 h-3.5 inline mr-1 text-primary" />
                        Counter-discount: <span class="text-primary font-bold">{{ Number(item.proposedDiscountPercent) }}%</span>
                        {{ item.lineId ? `on ${lineLabel(item.lineId)}` : 'on the whole order' }}
                      </div>
                      <span class="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border" :class="requestStatusBadge(item.status).class">
                        {{ requestStatusBadge(item.status).label }}
                      </span>
                    </div>
                    <p v-if="item.note" class="text-muted-foreground italic">"{{ item.note }}"</p>
                    <p v-if="item.decisionNote" class="text-[11px] text-muted-foreground">Sales response: "{{ item.decisionNote }}"</p>
                  </div>

                  <!-- Change-request card -->
                  <div
                    v-else
                    class="p-3 rounded-xl border text-xs space-y-1.5"
                    :class="item.status === 'open'
                      ? 'border-sky-300/60 bg-sky-50 dark:bg-sky-950/40 rounded-tr-sm'
                      : 'border-border bg-muted/30 rounded-tr-sm'"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="font-semibold text-foreground capitalize">
                        <FileEdit class="w-3.5 h-3.5 inline mr-1 text-primary" />
                        {{ item.requestType.replace('_', ' ') }}
                        <template v-if="item.proposedQuantity"> → qty {{ item.proposedQuantity }}</template>
                        <template v-if="item.proposedDiscountPercent"> → {{ Number(item.proposedDiscountPercent) }}%</template>
                      </div>
                      <span class="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border" :class="requestStatusBadge(item.status).class">
                        {{ requestStatusBadge(item.status).label }}
                      </span>
                    </div>
                    <p v-if="item.note" class="text-muted-foreground italic">"{{ item.note }}"</p>
                    <p v-if="item.resolutionNote" class="text-[11px] text-muted-foreground">Sales response: "{{ item.resolutionNote }}"</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Quick actions -->
            <div class="pt-3 flex items-center gap-2 flex-wrap">
              <button
                @click="toggleCounterForm"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                :class="isCounterFormOpen ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'"
              >
                <ArrowLeftRight class="w-3.5 h-3.5" />
                Propose Discount
              </button>
              <button
                @click="toggleChangeForm"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                :class="isChangeFormOpen ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'"
              >
                <FileEdit class="w-3.5 h-3.5" />
                Request Change
              </button>
              <span
                v-if="commentLineId"
                class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-primary/10 text-primary text-[11px]"
              >
                Discussing: <strong>{{ lineLabel(commentLineId) }}</strong>
                <button @click="commentLineId = null" class="underline hover:no-underline">clear</button>
              </span>
            </div>

            <!-- Inline counter form -->
            <div v-if="isCounterFormOpen" class="mt-3 p-3.5 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 space-y-3">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Scope</label>
                  <div class="flex gap-1.5">
                    <button
                      @click="counterScope = 'order'"
                      class="flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors"
                      :class="counterScope === 'order' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'"
                    >
                      Whole Order
                    </button>
                    <button
                      @click="counterScope = 'line'"
                      class="flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors"
                      :class="counterScope === 'line' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'"
                    >
                      Single Line
                    </button>
                  </div>
                </div>
                <div v-if="counterScope === 'line'" class="space-y-1.5">
                  <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Line Item</label>
                  <select
                    v-model="counterLineId"
                    class="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option :value="null" disabled>Select a line item...</option>
                    <option v-for="line in quotation.lines" :key="line.id" :value="line.id">
                      {{ line.product.name }} (qty {{ line.quantity }})
                    </option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Proposed Discount %</label>
                  <input
                    v-model.number="counterDiscount"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 12"
                    class="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <div class="space-y-1.5">
                <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Note (optional)</label>
                <textarea
                  v-model="counterNote"
                  rows="2"
                  placeholder="Explain why this discount would work for you..."
                  class="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                ></textarea>
              </div>
              <div class="flex justify-end gap-2">
                <button
                  @click="isCounterFormOpen = false"
                  class="px-3 py-2 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  :disabled="submitting === 'counter' || (counterScope === 'line' && !counterLineId) || counterDiscount === null"
                  @click="submitCounter"
                  class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <RefreshCw v-if="submitting === 'counter'" class="w-3.5 h-3.5 animate-spin" />
                  <ArrowLeftRight v-else class="w-3.5 h-3.5" />
                  Submit Counter-Proposal
                </button>
              </div>
            </div>

            <!-- Inline change form -->
            <div v-if="isChangeFormOpen" class="mt-3 p-3.5 rounded-xl border border-sky-300/60 bg-sky-50 dark:bg-sky-950/40 space-y-3">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Request Type</label>
                  <select
                    v-model="changeType"
                    class="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="quantity_change">Change Quantity</option>
                    <option value="discount_change">Change Line Discount</option>
                    <option value="remove_line">Remove a Line</option>
                    <option value="other">Other (describe below)</option>
                  </select>
                </div>
                <div v-if="changeType !== 'other'" class="space-y-1.5">
                  <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Line Item</label>
                  <select
                    v-model="changeLineId"
                    class="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option :value="null" disabled>Select a line item...</option>
                    <option v-for="line in quotation.lines" :key="line.id" :value="line.id">
                      {{ line.product.name }} (qty {{ line.quantity }}, -{{ line.lineDiscountPercent }}%)
                    </option>
                  </select>
                </div>
                <div v-if="changeType === 'quantity_change'" class="space-y-1.5">
                  <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Proposed Quantity</label>
                  <input
                    v-model.number="changeQuantity"
                    type="number"
                    min="1"
                    placeholder="e.g. 10"
                    class="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div v-if="changeType === 'discount_change'" class="space-y-1.5">
                  <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Proposed Discount %</label>
                  <input
                    v-model.number="changeDiscount"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 8"
                    class="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <div class="space-y-1.5">
                <label class="text-[11px] font-semibold text-foreground uppercase tracking-wide">Note (optional)</label>
                <textarea
                  v-model="changeNote"
                  rows="2"
                  placeholder="Describe the change you need..."
                  class="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                ></textarea>
              </div>
              <div class="flex justify-end gap-2">
                <button
                  @click="isChangeFormOpen = false"
                  class="px-3 py-2 rounded-lg border border-border bg-background text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  :disabled="submitting === 'change' || (changeType !== 'other' && !changeLineId) || (changeType === 'quantity_change' && !changeQuantity)"
                  @click="submitChangeRequest"
                  class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <RefreshCw v-if="submitting === 'change'" class="w-3.5 h-3.5 animate-spin" />
                  <FileEdit v-else class="w-3.5 h-3.5" />
                  Submit Change Request
                </button>
              </div>
            </div>

            <!-- Composer -->
            <div class="mt-3 pt-3 border-t border-border flex gap-2">
              <input
                id="chat-composer-input"
                v-model="commentBody"
                type="text"
                placeholder="Type a message about your quotation..."
                class="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                @keydown.enter="submitComment"
              />
              <button
                :disabled="!commentBody.trim() || submitting === 'comment'"
                @click="submitComment"
                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Send class="w-3.5 h-3.5" />
                Send
              </button>
            </div>
          </div>

          <div v-else class="p-6 text-xs text-muted-foreground flex items-center gap-2 border-t border-border">
            <Hourglass class="w-4 h-4 shrink-0" />
            <span>
              Negotiation opens once the quotation is sent to you — currently
              <strong class="text-foreground">{{ getStatusBadge(quotation.status).label }}</strong>.
              <template v-if="quotation.status === 'confirmed'">
                Need another round? Reply from your email link — a new message re-opens the deal for review.
              </template>
            </span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
