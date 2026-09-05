<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import WorkspaceLayout from '../components/layout/WorkspaceLayout.vue';
import { apiRequest } from '../lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    case 'confirmed':
      return { variant: 'default', label: 'Confirmed (Won)', class: 'bg-primary text-primary-foreground' };
    case 'rejected':
      return { variant: 'destructive', label: 'Rejected', class: '' };
    default:
      return { variant: 'outline', label: status, class: '' };
  }
}

function formatCurrency(val: number | string | undefined): string {
  const num = Number(val || 0);
  return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
            <Badge variant="outline" class="text-xs">Stage 2 Builder</Badge>
          </div>
          <p class="text-sm text-muted-foreground mt-1">
            Build, configure, discount, and manage tenant-isolated sales quotations.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button @click="router.push('/quotations/new')" class="shadow-xs font-semibold">
            <Plus class="w-4 h-4 mr-1.5" />
            New Quotation
          </Button>
        </div>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              {{ draftCount }} active in draft stage
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

        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardDescription class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tenancy Scope
              </CardDescription>
              <Layers class="w-4 h-4 text-primary" />
            </div>
            <CardTitle class="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              Isolated
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-xs text-muted-foreground">
              Quotes strictly scoped to your organization
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
              {{ searchQuery || statusFilter ? 'Try clearing your search filters.' : 'Get started by creating your first quotation.' }}
            </p>
            <Button
              v-if="!searchQuery && !statusFilter"
              @click="router.push('/quotations/new')"
              size="sm"
              class="mt-2"
            >
              <Plus class="w-4 h-4 mr-1.5" />
              Create Quotation
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
                    <span class="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
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
    </div>
  </WorkspaceLayout>
</template>
