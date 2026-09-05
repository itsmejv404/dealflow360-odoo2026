<script setup lang="ts">
import { ref, onMounted, reactive, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import WorkspaceLayout from '../components/layout/WorkspaceLayout.vue';
import { apiRequest } from '../lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
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
      if (customers.value.length > 0 && customers.value[0]) {
        selectedCustomerId.value = customers.value[0].id;
      }
    }
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to load builder data';
  } finally {
    isLoading.value = false;
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
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to load quotation';
  }
}

async function recalculate() {
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
    return;
  }

  const tierId = selectedCustomer.value?.tierId;
  if (!tierId) return;

  try {
    const payload = {
      tierId,
      orderDiscountPercent: Number(orderDiscountPercent.value || 0),
      lines: lines.value.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity || 1),
        unitPrice: l.unitPrice !== undefined ? Number(l.unitPrice) : undefined,
        lineDiscountPercent: Number(l.lineDiscountPercent || 0),
      })),
    };

    const res = await apiRequest<{ computedLines: any[]; totals: QuotationTotals }>(
      '/api/quotations/calculate',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    res.computedLines.forEach((cl, idx) => {
      if (lines.value[idx]) {
        lines.value[idx].subtotal = cl.subtotal;
        lines.value[idx].total = cl.total;
        lines.value[idx].unitPrice = cl.unitPrice;
        lines.value[idx].marginAmount = cl.marginAmount;
        lines.value[idx].marginPercent = cl.marginPercent;
        lines.value[idx].billingFrequency = cl.billingFrequency;
      }
    });

    Object.assign(totals, res.totals);
  } catch (err: any) {
    console.error('Recalculation error:', err);
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
  recalculate();
}

function removeLine(index: number) {
  lines.value.splice(index, 1);
  recalculate();
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
    recalculate();
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to create customer';
  } finally {
    isCreatingCustomer.value = false;
  }
}

function formatCurrency(val: number | string | undefined): string {
  const num = Number(val || 0);
  return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

watch(selectedCustomerId, () => {
  recalculate();
});

onMounted(() => {
  loadInitialData();
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
              {{ quotationStatus }}
            </Badge>
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FileText class="w-6 h-6 text-primary" />
            {{ isEditMode ? `Edit Quote — ${quotationNumber}` : 'Quotation Builder (Stage 2)' }}
          </h1>
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            @click="recalculate"
            class="h-9"
          >
            <RotateCcw class="w-4 h-4 mr-1.5" />
            Recalculate
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
                <h4 class="text-sm font-semibold text-foreground">No line items in this quotation</h4>
                <p class="text-xs text-muted-foreground max-w-sm mx-auto">
                  Click "Add Product / Service" to build a mixed quotation with hardware, consulting services, or recurring licenses.
                </p>
                <Button
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
                      class="text-xs hover:bg-muted/20 transition-colors"
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
                            ({{ line.billingFrequency }})
                          </span>
                        </div>
                      </TableCell>

                      <!-- Quantity Input -->
                      <TableCell class="text-center py-3">
                        <Input
                          type="number"
                          min="1"
                          v-model.number="line.quantity"
                          @change="recalculate"
                          class="h-8 w-16 text-center mx-auto text-xs"
                        />
                      </TableCell>

                      <!-- Unit Price Input -->
                      <TableCell class="text-right py-3">
                        <div class="relative flex items-center justify-end">
                          <span class="text-2xs text-muted-foreground mr-1">$</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            v-model.number="line.unitPrice"
                            @change="recalculate"
                            class="h-8 w-24 text-right text-xs"
                          />
                        </div>
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
                            @change="recalculate"
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
                        <div class="text-2xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
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
                @click="isProductDialogOpen = true"
              >
                <Plus class="w-3.5 h-3.5 mr-1" />
                Add Another Item
              </Button>
            </CardFooter>
          </Card>

          <!-- Deal Notes & Terms -->
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-2">
              <CardTitle class="text-sm font-semibold text-foreground">Deal Notes & Special Terms</CardTitle>
              <CardDescription class="text-xs">Optional terms communicated to customer and approval reviewers.</CardDescription>
            </CardHeader>
            <CardContent>
              <textarea
                v-model="notes"
                placeholder="Add quotation remarks, payment terms, or fulfillment instructions..."
                rows="3"
                class="w-full rounded-md border border-input bg-background p-2.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
              ></textarea>
            </CardContent>
          </Card>
        </div>

        <!-- RIGHT COLUMN: Customer, Tier & Pricing Breakdown Card (4 cols) -->
        <div class="lg:col-span-4 space-y-6">
          <!-- Customer Selection Card -->
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <div class="flex items-center justify-between">
                <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                  <User class="w-4 h-4 text-primary" />
                  Target Customer
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
                <Label class="text-xs font-semibold">Select Customer</Label>
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

              <!-- Selected Customer Details & Tier -->
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
                  <span class="text-muted-foreground">Customer Email:</span>
                  <span class="text-foreground truncate max-w-[150px]">{{ selectedCustomer.email }}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Pricing & Financial Margin Summary Card -->
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3 border-b border-border/70">
              <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                <DollarSign class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Quotation Summary & Margin
              </CardTitle>
            </CardHeader>

            <CardContent class="space-y-4 pt-4 text-xs">
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
                      @change="recalculate"
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

              <!-- Margin Indicator -->
              <div class="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                    <Sparkles class="w-3.5 h-3.5" />
                    Total Deal Margin
                  </span>
                  <Badge variant="outline" class="bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border-emerald-300 font-bold text-xs">
                    {{ Number(totals.totalMarginPercent).toFixed(1) }}%
                  </Badge>
                </div>
                <div class="flex justify-between text-2xs text-emerald-700 dark:text-emerald-300">
                  <span>Gross Profit Margin:</span>
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
    </div>
  </WorkspaceLayout>
</template>