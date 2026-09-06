<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import WorkspaceLayout from '../components/layout/WorkspaceLayout.vue';
import { apiRequest } from '../lib/api';
import { formatCurrency, marginTone } from '../lib/currency';
import { statusLabel } from '../lib/labels';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  Search,
  CheckCircle2,
  Clock,
  Send,
  XCircle,
  FileCheck2,
  Layers,
  ArrowRight,
  User,
  Calendar,
  DollarSign,
  TrendingUp,
  AlertCircle,
  Users,
} from 'lucide-vue-next';

const router = useRouter();

interface Customer {
  id: string;
  name: string;
  email: string;
  company?: string;
  tier?: { id: string; name: string; code: string };
}

interface QuotationListItem {
  id: string;
  quotationNumber: string;
  status: string;
  subtotal: number;
  totalDiscount: number;
  totalAmount: number;
  totalMargin: number;
  totalMarginPercent: number;
  oneTimeTotal: number;
  recurringMonthlyTotal: number;
  recurringAnnualTotal: number;
  createdAt: string;
  customer: {
    id: string;
    name: string;
    email: string;
    company?: string;
  };
  tier: {
    id: string;
    name: string;
    code: string;
  };
  rep?: {
    id: string;
    name?: string;
    email: string;
  };
  _count: {
    lines: number;
  };
}

const quotations = ref<QuotationListItem[]>([]);
const isLoading = ref(true);
const errorMessage = ref<string | null>(null);
const searchQuery = ref('');
const statusFilter = ref('');

// ---- Customer-first quotation creation ----
// A quotation is always built FOR a customer request — the flow starts by
// picking the customer, never from an empty builder. New customers can be
// created right inside the picker; their portal link is emailed automatically
// once the quotation is saved.
const isCustomerPickerOpen = ref(false);
const isLoadingCustomers = ref(false);
const customers = ref<Customer[]>([]);
const customerSearch = ref('');
const pickerMode = ref<'pick' | 'create'>('pick');
const customerTiers = ref<Array<{ id: string; name: string; code: string }>>([]);
const newCustomerForm = reactive({
  name: '',
  email: '',
  company: '',
  phone: '',
  tierId: '',
});
const isCreatingCustomer = ref(false);

const filteredCustomers = computed(() => {
  const q = customerSearch.value.trim().toLowerCase();
  if (!q) return customers.value;
  return customers.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company && c.company.toLowerCase().includes(q))
  );
});

async function openCustomerPicker() {
  isCustomerPickerOpen.value = true;
  customerSearch.value = '';
  pickerMode.value = 'pick';
  errorMessage.value = null;

  const loads: Promise<void>[] = [];
  if (customers.value.length === 0) {
    loads.push(
      (async () => {
        isLoadingCustomers.value = true;
        try {
          const res = await apiRequest<{ customers: Customer[] }>('/api/quotations/customers');
          customers.value = res.customers || [];
        } catch (err: any) {
          errorMessage.value = err.message || 'Failed to load customers';
        } finally {
          isLoadingCustomers.value = false;
        }
      })()
    );
  }
  if (customerTiers.value.length === 0) {
    loads.push(
      (async () => {
        try {
          const res = await apiRequest<{ tiers: Array<{ id: string; name: string; code: string }> }>('/api/catalog/tiers');
          customerTiers.value = res.tiers || [];
          if (customerTiers.value.length > 0 && customerTiers.value[0] && !newCustomerForm.tierId) {
            newCustomerForm.tierId = customerTiers.value[0]!.id;
          }
        } catch {
          // Non-fatal: tier select just stays empty with a hint
        }
      })()
    );
  }
  await Promise.all(loads);
}

function startQuoteForCustomer(customer: Customer, isNew = false) {
  isCustomerPickerOpen.value = false;
  const flag = isNew ? '&newCustomer=1' : '';
  router.push(`/quotations/new?customer=${customer.id}${flag}`);
}

async function submitNewCustomer() {
  errorMessage.value = null;
  if (!newCustomerForm.name.trim() || !newCustomerForm.email.trim() || !newCustomerForm.tierId) {
    errorMessage.value = 'Name, email and pricing tier are required to create a customer.';
    return;
  }
  isCreatingCustomer.value = true;
  try {
    const res = await apiRequest<{ customer: Customer }>('/api/quotations/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: newCustomerForm.name.trim(),
        email: newCustomerForm.email.trim().toLowerCase(),
        company: newCustomerForm.company.trim() || undefined,
        phone: newCustomerForm.phone.trim() || undefined,
        tierId: newCustomerForm.tierId,
      }),
    });
    customers.value.push(res.customer);
    startQuoteForCustomer(res.customer, true);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to create the customer';
  } finally {
    isCreatingCustomer.value = false;
  }
}

const filteredQuotations = computed(() => {
  return quotations.value.filter((q) => {
    if (statusFilter.value && q.status !== statusFilter.value) return false;
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase();
      const numMatch = q.quotationNumber.toLowerCase().includes(query);
      const custMatch = q.customer.name.toLowerCase().includes(query) || (q.customer.company && q.customer.company.toLowerCase().includes(query));
      return numMatch || custMatch;
    }
    return true;
  });
});

const totalPipelineValue = computed(() => {
  return quotations.value.reduce((acc, q) => acc + Number(q.totalAmount || 0), 0);
});

const draftCount = computed(() => {
  return quotations.value.filter((q) => q.status === 'draft').length;
});

async function loadQuotations() {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const res = await apiRequest<{ quotations: QuotationListItem[] }>('/api/quotations');
    quotations.value = res.quotations;
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to load quotations';
  } finally {
    isLoading.value = false;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return { variant: 'outline', label: 'Draft', class: 'bg-muted text-muted-foreground border-border' };
    case 'pending_approval':
      return { variant: 'secondary', label: 'Pending Approval', class: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300' };
    case 'approved':
      return { variant: 'outline', label: 'Approved', class: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300' };
    case 'sent':
      return { variant: 'outline', label: 'Sent to Customer', class: 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-300' };
    case 'negotiating':
      return { variant: 'outline', label: 'Under Negotiation', class: 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-300' };
    case 'confirmed':
      return { variant: 'default', label: 'Confirmed', class: 'bg-primary text-primary-foreground' };
    case 'rejected':
      return { variant: 'destructive', label: 'Rejected', class: '' };
    default:
      return { variant: 'outline', label: statusLabel(status), class: '' };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

onMounted(() => {
  loadQuotations();
});
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-6">
      <!-- Top header bar -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <FileText class="w-6 h-6 text-primary" />
              Quotations & Deals
            </h1>
            <Badge variant="outline" class="text-xs">Builder</Badge>
          </div>
          <p class="text-sm text-muted-foreground mt-1">
            Build, discount, and manage your organization's quotations.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button @click="openCustomerPicker" class="shadow-xs font-semibold">
            <Plus class="w-4 h-4 mr-1.5" />
            New Quotation
          </Button>
        </div>
      </div>

      <!-- Load error banner -->
      <div
        v-if="errorMessage"
        class="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs"
      >
        <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
        <span>{{ errorMessage }}</span>
        <Button variant="ghost" size="sm" class="h-5 ml-auto text-xs" @click="loadQuotations">
          Retry
        </Button>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardDescription class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Quotations
              </CardDescription>
              <FileCheck2 class="w-4 h-4 text-primary" />
            </div>
            <CardTitle class="text-2xl font-bold text-foreground mt-1">
              {{ quotations.length }}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-xs text-muted-foreground">
              {{ draftCount }} active in draft
            </p>
          </CardContent>
        </Card>

        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardDescription class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Pipeline Value
              </CardDescription>
              <DollarSign class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <CardTitle class="text-2xl font-bold text-foreground mt-1">
              {{ formatCurrency(totalPipelineValue) }}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-xs text-muted-foreground">
              Gross sum of current active quotations
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Filters and search -->
      <Card class="border-border bg-card shadow-xs">
        <CardHeader class="pb-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="relative flex-1 max-w-sm">
              <Search class="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                v-model="searchQuery"
                placeholder="Search quote number, customer, company..."
                class="pl-9 h-9"
              />
            </div>
            <div class="flex items-center gap-2">
              <select
                v-model="statusFilter"
                class="h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="approved">Approved</option>
                <option value="sent">Sent</option>
                <option value="negotiating">Under Negotiation</option>
                <option value="confirmed">Confirmed</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div v-if="isLoading" class="py-12 text-center text-muted-foreground text-sm">
            Loading quotations...
          </div>

          <div v-else-if="filteredQuotations.length === 0" class="py-12 text-center space-y-3">
            <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <FileText class="w-6 h-6" />
            </div>
            <h3 class="text-base font-semibold text-foreground">No quotations found</h3>
            <p class="text-xs text-muted-foreground max-w-sm mx-auto">
              {{ searchQuery || statusFilter ? 'Try clearing your search filters.' : 'Quotations start from a customer — pick a customer request to build for.' }}
            </p>
            <Button
              v-if="!searchQuery && !statusFilter"
              @click="openCustomerPicker"
              size="sm"
              class="mt-2"
            >
              <Plus class="w-4 h-4 mr-1.5" />
              New Quotation for a Customer
            </Button>
          </div>

          <div v-else class="rounded-md border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50">
                  <TableHead class="font-semibold text-xs">Quote #</TableHead>
                  <TableHead class="font-semibold text-xs">Customer</TableHead>
                  <TableHead class="font-semibold text-xs">Tier</TableHead>
                  <TableHead class="font-semibold text-xs">Lines</TableHead>
                  <TableHead class="font-semibold text-xs">Status</TableHead>
                  <TableHead class="font-semibold text-xs text-right">Margin</TableHead>
                  <TableHead class="font-semibold text-xs text-right">Total Amount</TableHead>
                  <TableHead class="font-semibold text-xs text-right">Date</TableHead>
                  <TableHead class="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="quote in filteredQuotations"
                  :key="quote.id"
                  class="cursor-pointer hover:bg-muted/30 transition-colors"
                  @click="router.push(`/quotations/${quote.id}`)"
                >
                  <TableCell class="font-mono text-xs font-semibold text-primary">
                    {{ quote.quotationNumber }}
                  </TableCell>
                  <TableCell>
                    <div class="font-medium text-xs text-foreground">{{ quote.customer.name }}</div>
                    <div class="text-2xs text-muted-foreground">{{ quote.customer.company || quote.customer.email }}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" class="text-2xs uppercase">
                      {{ quote.tier.name }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-xs text-muted-foreground">
                    {{ quote._count.lines }} {{ quote._count.lines === 1 ? 'line' : 'lines' }}
                  </TableCell>
                  <TableCell>
                    <Badge
                      :variant="getStatusBadge(quote.status).variant as any"
                      :class="['text-2xs font-medium', getStatusBadge(quote.status).class]"
                    >
                      {{ getStatusBadge(quote.status).label }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-right">
                    <span
                      class="text-xs font-semibold"
                      :class="marginTone(Number(quote.totalMarginPercent)).text"
                    >
                      {{ Number(quote.totalMarginPercent).toFixed(1) }}%
                    </span>
                    <div class="text-2xs text-muted-foreground">
                      {{ formatCurrency(quote.totalMargin) }}
                    </div>
                  </TableCell>
                  <TableCell class="text-right font-bold text-xs text-foreground">
                    {{ formatCurrency(quote.totalAmount) }}
                    <div v-if="Number(quote.recurringMonthlyTotal) > 0" class="text-2xs font-normal text-primary">
                      +{{ formatCurrency(quote.recurringMonthlyTotal) }}/mo
                    </div>
                  </TableCell>
                  <TableCell class="text-right text-xs text-muted-foreground">
                    {{ formatDate(quote.createdAt) }}
                  </TableCell>
                  <TableCell class="text-right" @click.stop>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 w-8 p-0"
                      @click="router.push(`/quotations/${quote.id}`)"
                    >
                      <ArrowRight class="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <!-- Customer Request Picker: quotations always start from a customer -->
      <Dialog :open="isCustomerPickerOpen" @update:open="isCustomerPickerOpen = $event">
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2 text-base">
              <Users class="w-4 h-4 text-primary" />
              New Quotation for a Customer Request
            </DialogTitle>
            <DialogDescription class="text-xs">
              Select the customer whose request you are quoting — or add a new
              customer and we'll email them their portal link when the quotation is
              saved. All further communication happens through that link.
            </DialogDescription>
          </DialogHeader>

          <!-- Mode switch -->
          <div class="flex items-center gap-1.5 bg-muted p-1 rounded-lg border border-border w-fit">
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="pickerMode === 'pick' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'"
              @click="pickerMode = 'pick'"
            >
              Existing Customer
            </button>
            <button
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1"
              :class="pickerMode === 'create' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'"
              @click="pickerMode = 'create'"
            >
              <Plus class="w-3.5 h-3.5" />
              New Customer
            </button>
          </div>

          <!-- Error message inside the picker -->
          <div
            v-if="isCustomerPickerOpen && errorMessage"
            class="p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-start gap-1.5"
          >
            <AlertCircle class="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{{ errorMessage }}</span>
          </div>

          <!-- PICK MODE -->
          <template v-if="pickerMode === 'pick'">
            <div class="relative">
              <Search class="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                v-model="customerSearch"
                placeholder="Search customers by name, email or company..."
                class="pl-9 h-9 text-xs"
              />
            </div>

            <div class="max-h-72 overflow-y-auto space-y-1.5 -mx-1 px-1">
              <div v-if="isLoadingCustomers" class="py-8 text-center text-xs text-muted-foreground">
                Loading customers...
              </div>
              <div
                v-else-if="filteredCustomers.length === 0"
                class="py-8 text-center text-xs text-muted-foreground"
              >
                No customers match "{{ customerSearch }}".
              </div>
              <button
                v-for="customer in filteredCustomers"
                :key="customer.id"
                class="w-full text-left p-3 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-muted/20 transition-colors flex items-center justify-between gap-3 group"
                @click="startQuoteForCustomer(customer)"
              >
                <div class="min-w-0">
                  <div class="text-xs font-semibold text-foreground truncate">{{ customer.name }}</div>
                  <div class="text-2xs text-muted-foreground truncate">
                    {{ customer.company ? `${customer.company} · ` : '' }}{{ customer.email }}
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <Badge v-if="customer.tier" variant="outline" class="text-2xs">{{ customer.tier.name }}</Badge>
                  <Button size="sm" class="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus class="w-3 h-3 mr-1" />
                    Build Quote
                  </Button>
                </div>
              </button>
            </div>
          </template>

          <!-- CREATE MODE: new customer request -->
          <template v-else>
            <div class="space-y-3 py-1">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <label class="text-xs font-semibold text-foreground">Customer Name <span class="text-destructive">*</span></label>
                  <Input
                    v-model="newCustomerForm.name"
                    placeholder="e.g. Stark Industries"
                    class="h-9 text-xs"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs font-semibold text-foreground">Email <span class="text-destructive">*</span></label>
                  <Input
                    v-model="newCustomerForm.email"
                    type="email"
                    placeholder="contact@customer.com"
                    class="h-9 text-xs"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs font-semibold text-foreground">Company (optional)</label>
                  <Input
                    v-model="newCustomerForm.company"
                    placeholder="Company / organization"
                    class="h-9 text-xs"
                  />
                </div>
                <div class="space-y-1.5">
                  <label class="text-xs font-semibold text-foreground">Phone (optional)</label>
                  <Input
                    v-model="newCustomerForm.phone"
                    placeholder="+1 ..."
                    class="h-9 text-xs"
                  />
                </div>
              </div>

              <div class="space-y-1.5">
                <label class="text-xs font-semibold text-foreground">Pricing Tier <span class="text-destructive">*</span></label>
                <select
                  v-model="newCustomerForm.tierId"
                  class="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
                >
                  <option :value="''" disabled>Choose a tier...</option>
                  <option v-for="tier in customerTiers" :key="tier.id" :value="tier.id">
                    {{ tier.name }}
                  </option>
                </select>
                <p v-if="customerTiers.length === 0" class="text-2xs text-amber-600 dark:text-amber-400">
                  No tiers configured yet — set up customer tiers in the Catalog first.
                </p>
              </div>

              <div class="p-3 rounded-lg bg-primary/5 border border-primary/20 text-2xs text-muted-foreground flex items-start gap-2">
                <Send class="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  After you save the quotation, this customer automatically receives their
                  secure portal link by email — they review, negotiate, and close the deal there.
                </span>
              </div>
            </div>

            <div class="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" class="text-xs" @click="pickerMode = 'pick'">
                Back to List
              </Button>
              <Button
                size="sm"
                class="text-xs font-semibold"
                :disabled="isCreatingCustomer || !newCustomerForm.name.trim() || !newCustomerForm.email.trim() || !newCustomerForm.tierId"
                @click="submitNewCustomer"
              >
                <Plus class="w-3.5 h-3.5 mr-1" />
                {{ isCreatingCustomer ? 'Creating...' : 'Create & Build Quote' }}
              </Button>
            </div>
          </template>
        </DialogContent>
      </Dialog>
    </div>
  </WorkspaceLayout>
</template>
