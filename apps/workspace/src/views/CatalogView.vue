<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue';
import WorkspaceLayout from '../components/layout/WorkspaceLayout.vue';
import { apiRequest } from '../lib/api';
import { authStore } from '../lib/auth';
import { formatCurrency as formatMoney } from '../lib/currency';
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
  Package,
  Plus,
  Edit2,
  Trash2,
  Search,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Award,
  RefreshCw,
  DollarSign,
  Tag,
  Clock,
} from 'lucide-vue-next';

interface Category {
  id: string;
  name: string;
  code: string;
  description?: string;
  _count?: { products: number };
}

interface CustomerTier {
  id: string;
  name: string;
  code: string;
  description?: string;
  defaultDiscountPercent: number;
}

interface TierPriceItem {
  id?: string;
  tierId: string;
  customPrice: number;
  tier?: { id: string; name: string; code: string };
}

interface Product {
  id: string;
  name: string;
  sku: string;
  categoryId?: string | null;
  description?: string;
  price: number;
  costPrice?: number | null;
  billingFrequency: 'one_time' | 'monthly' | 'quarterly' | 'annual';
  status: 'active' | 'archived';
  maxDiscountPercent?: number | null;
  category?: { id: string; name: string; code: string } | null;
  priceListItems?: TierPriceItem[];
}


// State
const activeTab = ref('products');
const isLoading = ref(true);
const actionError = ref<string | null>(null);
const successMessage = ref<string | null>(null);

// Data collections
const products = ref<Product[]>([]);
const categories = ref<Category[]>([]);
const tiers = ref<CustomerTier[]>([]);

// Filters
const searchQuery = ref('');
const filterCategoryId = ref('');
const filterStatus = ref('');

// Modals
const isProductDialogOpen = ref(false);
const isCategoryDialogOpen = ref(false);
const isTierDialogOpen = ref(false);
const editingProductId = ref<string | null>(null);
const editingCategoryId = ref<string | null>(null);
const editingTierId = ref<string | null>(null);
const isSubmitting = ref(false);


// Forms
const productForm = reactive({
  name: '',
  sku: '',
  categoryId: '',
  description: '',
  price: 0,
  costPrice: 0,
  billingFrequency: 'one_time' as 'one_time' | 'monthly' | 'quarterly' | 'annual',
  status: 'active' as 'active' | 'archived',
  maxDiscountPercent: null as number | null,
  tierOverrides: {} as Record<string, number | undefined>,
});

const categoryForm = reactive({
  name: '',
  code: '',
  description: '',
});

const tierForm = reactive({
  name: '',
  code: '',
  description: '',
  defaultDiscountPercent: 0,
});

const isOrgAdmin = computed(() => authStore.state.user?.role === 'org_admin');

// Filtered products list
const filteredProducts = computed(() => {
  return products.value.filter((p) => {
    if (filterCategoryId.value && p.categoryId !== filterCategoryId.value) return false;
    if (filterStatus.value && p.status !== filterStatus.value) return false;
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
      );
    }
    return true;
  });
});

async function loadAllData() {
  isLoading.value = true;
  actionError.value = null;
  try {
    const [catsRes, tiersRes, prodsRes] = await Promise.all([
      apiRequest<{ categories: Category[] }>('/api/catalog/categories'),
      apiRequest<{ tiers: CustomerTier[] }>('/api/catalog/tiers'),
      apiRequest<{ products: Product[] }>('/api/catalog/products'),
    ]);
    categories.value = catsRes.categories;
    tiers.value = tiersRes.tiers;
    products.value = prodsRes.products;
  } catch (err: any) {
    actionError.value = err.message || 'Failed to load catalog data';
  } finally {
    isLoading.value = false;
  }
}

function handleTabChange(tab: string | number) {
  activeTab.value = String(tab);
  actionError.value = null;
  successMessage.value = null;
}

// ================= PRODUCT ACTIONS =================

function openAddProductDialog() {
  editingProductId.value = null;
  productForm.name = '';
  productForm.sku = '';
  productForm.categoryId = categories.value[0]?.id || '';
  productForm.description = '';
  productForm.price = 0;
  productForm.costPrice = 0;
  productForm.billingFrequency = 'one_time';
  productForm.status = 'active';
  productForm.maxDiscountPercent = null;
  productForm.tierOverrides = {};
  for (const t of tiers.value) {
    productForm.tierOverrides[t.id] = undefined;
  }
  isProductDialogOpen.value = true;
}

function openEditProductDialog(prod: Product) {
  editingProductId.value = prod.id;
  productForm.name = prod.name;
  productForm.sku = prod.sku;
  productForm.categoryId = prod.categoryId || '';
  productForm.description = prod.description || '';
  productForm.price = Number(prod.price);
  productForm.costPrice = prod.costPrice ? Number(prod.costPrice) : 0;
  productForm.billingFrequency = prod.billingFrequency;
  productForm.status = prod.status;
  productForm.maxDiscountPercent = prod.maxDiscountPercent !== null && prod.maxDiscountPercent !== undefined ? Number(prod.maxDiscountPercent) : null;
  productForm.tierOverrides = {};

  for (const t of tiers.value) {
    const override = prod.priceListItems?.find((item) => item.tierId === t.id);
    productForm.tierOverrides[t.id] = override ? Number(override.customPrice) : undefined;
  }

  isProductDialogOpen.value = true;
}

async function handleSaveProduct() {
  isSubmitting.value = true;
  actionError.value = null;
  successMessage.value = null;

  try {
    const tierPrices = Object.entries(productForm.tierOverrides)
      .filter(([_, val]) => val !== null && val !== undefined && !isNaN(Number(val)) && Number(val) > 0)
      .map(([tierId, customPrice]) => ({
        tierId,
        customPrice: Number(customPrice),
      }));

    const rawCost: number | null | '' = productForm.costPrice ?? null;
    const parsedCost = rawCost === null || rawCost === ('' as unknown) ? null : Number(rawCost);

    const payload = {
      name: productForm.name,
      sku: productForm.sku,
      categoryId: productForm.categoryId || undefined,
      description: productForm.description || undefined,
      price: Number(productForm.price),
      // Omit empty/zero cost entirely — never send null (it 400s on create).
      costPrice: parsedCost && parsedCost !== 0 ? parsedCost : undefined,
      billingFrequency: productForm.billingFrequency,
      status: productForm.status,
      maxDiscountPercent:
        productForm.maxDiscountPercent !== null &&
        productForm.maxDiscountPercent !== undefined &&
        !isNaN(Number(productForm.maxDiscountPercent))
          ? Number(productForm.maxDiscountPercent)
          : null,
      tierPrices,
    };

    if (editingProductId.value) {
      await apiRequest(`/api/catalog/products/${editingProductId.value}`, {
        method: 'PUT',
        data: payload,
      });
      successMessage.value = `Product "${productForm.name}" updated successfully!`;
    } else {
      await apiRequest('/api/catalog/products', {
        method: 'POST',
        data: payload,
      });
      successMessage.value = `Product "${productForm.name}" created successfully!`;
    }

    isProductDialogOpen.value = false;
    await loadAllData();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to save product';
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDeleteProduct(prod: Product) {
  if (!confirm(`Are you sure you want to delete/archive product "${prod.name}"?`)) return;
  actionError.value = null;
  successMessage.value = null;
  try {
    const res = await apiRequest<{ success: boolean; message: string }>(`/api/catalog/products/${prod.id}`, {
      method: 'DELETE',
    });
    successMessage.value = res.message || `Product ${prod.name} removed`;
    await loadAllData();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to delete product';
  }
}

// ================= CATEGORY ACTIONS =================

function openAddCategoryDialog() {
  editingCategoryId.value = null;
  categoryForm.name = '';
  categoryForm.code = '';
  categoryForm.description = '';
  isCategoryDialogOpen.value = true;
}

function openEditCategoryDialog(cat: Category) {
  editingCategoryId.value = cat.id;
  categoryForm.name = cat.name;
  categoryForm.code = cat.code;
  categoryForm.description = cat.description || '';
  isCategoryDialogOpen.value = true;
}

async function handleSaveCategory() {
  isSubmitting.value = true;
  actionError.value = null;
  successMessage.value = null;
  try {
    if (editingCategoryId.value) {
      await apiRequest(`/api/catalog/categories/${editingCategoryId.value}`, {
        method: 'PUT',
        data: categoryForm,
      });
      successMessage.value = `Category "${categoryForm.name}" updated!`;
    } else {
      await apiRequest('/api/catalog/categories', {
        method: 'POST',
        data: categoryForm,
      });
      successMessage.value = `Category "${categoryForm.name}" created!`;
    }
    isCategoryDialogOpen.value = false;
    await loadAllData();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to save category';
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDeleteCategory(cat: Category) {
  if (!confirm(`Are you sure you want to delete category "${cat.name}"?`)) return;
  actionError.value = null;
  successMessage.value = null;
  try {
    await apiRequest(`/api/catalog/categories/${cat.id}`, { method: 'DELETE' });
    successMessage.value = `Category "${cat.name}" deleted`;
    await loadAllData();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to delete category';
  }
}

// ================= TIER ACTIONS =================

function openAddTierDialog() {
  editingTierId.value = null;
  tierForm.name = '';
  tierForm.code = '';
  tierForm.description = '';
  tierForm.defaultDiscountPercent = 0;
  isTierDialogOpen.value = true;
}

function openEditTierDialog(t: CustomerTier) {
  editingTierId.value = t.id;
  tierForm.name = t.name;
  tierForm.code = t.code;
  tierForm.description = t.description || '';
  tierForm.defaultDiscountPercent = Number(t.defaultDiscountPercent);
  isTierDialogOpen.value = true;
}

async function handleSaveTier() {
  isSubmitting.value = true;
  actionError.value = null;
  successMessage.value = null;
  try {
    const payload = {
      ...tierForm,
      defaultDiscountPercent: Number(tierForm.defaultDiscountPercent),
    };
    if (editingTierId.value) {
      await apiRequest(`/api/catalog/tiers/${editingTierId.value}`, {
        method: 'PUT',
        data: payload,
      });
      successMessage.value = `Customer tier "${tierForm.name}" updated!`;
    } else {
      await apiRequest('/api/catalog/tiers', {
        method: 'POST',
        data: payload,
      });
      successMessage.value = `Customer tier "${tierForm.name}" created!`;
    }
    isTierDialogOpen.value = false;
    await loadAllData();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to save customer tier';
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDeleteTier(t: CustomerTier) {
  if (!confirm(`Are you sure you want to delete customer tier "${t.name}"?`)) return;
  actionError.value = null;
  successMessage.value = null;
  try {
    await apiRequest(`/api/catalog/tiers/${t.id}`, { method: 'DELETE' });
    successMessage.value = `Customer tier "${t.name}" deleted`;
    await loadAllData();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to delete customer tier';
  }
}

function formatCurrency(val?: number | null) {
  if (val === undefined || val === null) return '-';
  return formatMoney(val);
}

function getBillingCadenceBadge(cadence: string) {
  switch (cadence) {
    case 'monthly':
      return { label: 'Monthly Sub', variant: 'secondary' as const };
    case 'quarterly':
      return { label: 'Quarterly Sub', variant: 'secondary' as const };
    case 'annual':
      return { label: 'Annual Sub', variant: 'secondary' as const };
    default:
      return { label: 'One-Time', variant: 'outline' as const };
  }
}

onMounted(() => {
  loadAllData();
});
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-6">
      <!-- Header Bar -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Package class="w-6 h-6 text-primary" />
            Product Catalog & Price Lists
          </h1>
          <p class="text-sm text-muted-foreground">
            Configure products, categories, customer tiers, and per-product discount ceilings for {{ authStore.state.organization?.name }}.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="loadAllData" :disabled="isLoading">
            <RefreshCw class="w-4 h-4 mr-1.5" :class="{ 'animate-spin': isLoading }" />
            Refresh
          </Button>

          <Button
            v-if="isOrgAdmin && activeTab === 'products'"
            class="bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
            @click="openAddProductDialog"
          >
            <Plus class="w-4 h-4 mr-1.5" />
            Add Product
          </Button>

          <Button
            v-if="isOrgAdmin && activeTab === 'categories'"
            class="bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
            @click="openAddCategoryDialog"
          >
            <Plus class="w-4 h-4 mr-1.5" />
            Add Category
          </Button>

          <Button
            v-if="isOrgAdmin && activeTab === 'tiers'"
            class="bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
            @click="openAddTierDialog"
          >
            <Plus class="w-4 h-4 mr-1.5" />
            Add Customer Tier
          </Button>
        </div>
      </div>

      <!-- Alerts -->
      <div
        v-if="actionError"
        class="p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm flex items-center gap-2"
      >
        <AlertTriangle class="w-4 h-4 shrink-0" />
        <span>{{ actionError }}</span>
      </div>

      <div
        v-if="successMessage"
        class="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-700 dark:text-emerald-300 text-sm flex items-center gap-2"
      >
        <CheckCircle2 class="w-4 h-4 shrink-0" />
        <span>{{ successMessage }}</span>
      </div>

      <!-- Tabs Navigation -->
      <Tabs :model-value="activeTab" class="w-full" @update:model-value="handleTabChange">
        <TabsList class="grid grid-cols-3 w-full max-w-2xl p-1 rounded-lg">
          <TabsTrigger value="products" class="flex items-center gap-2 text-xs sm:text-sm">
            <Package class="w-4 h-4" />
            Products ({{ products.length }})
          </TabsTrigger>
          <TabsTrigger value="categories" class="flex items-center gap-2 text-xs sm:text-sm">
            <Layers class="w-4 h-4" />
            Categories ({{ categories.length }})
          </TabsTrigger>
          <TabsTrigger value="tiers" class="flex items-center gap-2 text-xs sm:text-sm">
            <Award class="w-4 h-4" />
            Customer Tiers ({{ tiers.length }})
          </TabsTrigger>
        </TabsList>

        <!-- ================= TAB 1: PRODUCTS ================= -->
        <TabsContent value="products" class="mt-4 space-y-4">
          <!-- Filters Card -->
          <Card class="border-border bg-card shadow-xs">
            <CardContent class="p-4">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="relative">
                  <Search class="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <Input
                    v-model="searchQuery"
                    placeholder="Search by name, SKU..."
                    class="pl-9"
                  />
                </div>
                <div>
                  <select
                    v-model="filterCategoryId"
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All Categories</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">
                      {{ c.name }}
                    </option>
                  </select>
                </div>
                <div>
                  <select
                    v-model="filterStatus"
                    class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All Statuses</option>
                    <option value="active">Active Only</option>
                    <option value="archived">Archived Only</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Products Table -->
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3">
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle class="text-lg font-semibold text-foreground">Products Catalog</CardTitle>
                  <CardDescription>
                    All items available for quotations in your organization.
                  </CardDescription>
                </div>
                <Badge variant="secondary" class="font-medium text-foreground">
                  {{ filteredProducts.length }} Products Shown
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div v-if="isLoading" class="py-12 text-center text-sm text-muted-foreground">
                Loading products...
              </div>
              <div v-else-if="filteredProducts.length === 0" class="py-12 text-center">
                <Package class="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p class="text-sm font-medium text-slate-600">No products found</p>
                <p class="text-xs text-slate-400 mt-1">Try adjusting your filters or click "Add Product" to create one.</p>
              </div>
              <Table v-else>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Billing Cadence</TableHead>
                    <TableHead class="text-right">Base Price</TableHead>
                    <TableHead class="text-right">Max Discount</TableHead>
                    <TableHead class="text-right">Cost Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead v-if="isOrgAdmin" class="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="prod in filteredProducts" :key="prod.id">
                    <TableCell>
                      <div class="font-medium text-foreground">{{ prod.name }}</div>
                      <div v-if="prod.description" class="text-xs text-muted-foreground line-clamp-1 max-w-xs">
                        {{ prod.description }}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code class="px-2 py-0.5 rounded bg-muted text-foreground text-xs font-mono">
                        {{ prod.sku }}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" class="text-xs font-medium">
                        {{ prod.category?.name || 'Uncategorized' }}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge :variant="getBillingCadenceBadge(prod.billingFrequency).variant" class="text-xs">
                        <Clock class="w-3 h-3 mr-1" />
                        {{ getBillingCadenceBadge(prod.billingFrequency).label }}
                      </Badge>
                    </TableCell>
                    <TableCell class="text-right font-semibold text-foreground">
                      {{ formatCurrency(prod.price) }}
                    </TableCell>
                    <TableCell class="text-right">
                      <Badge
                        v-if="prod.maxDiscountPercent !== null && prod.maxDiscountPercent !== undefined"
                        variant="outline"
                        class="text-xs font-semibold text-primary"
                      >
                        {{ Number(prod.maxDiscountPercent).toFixed(1) }}% max
                      </Badge>
                      <span v-else class="text-xs text-muted-foreground">Rulebook</span>
                    </TableCell>
                    <TableCell class="text-right text-muted-foreground text-xs">
                      {{ prod.costPrice ? formatCurrency(prod.costPrice) : '—' }}
                    </TableCell>
                    <TableCell>
                      <Badge
                        :variant="prod.status === 'active' ? 'outline' : 'secondary'"
                        :class="{ 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800': prod.status === 'active' }"
                      >
                        {{ prod.status === 'active' ? 'Active' : 'Archived' }}
                      </Badge>
                    </TableCell>
                    <TableCell v-if="isOrgAdmin" class="text-right">
                      <div class="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                          @click="openEditProductDialog(prod)"
                        >
                          <Edit2 class="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          @click="handleDeleteProduct(prod)"
                        >
                          <Trash2 class="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- ================= TAB 2: CATEGORIES ================= -->
        <TabsContent value="categories" class="mt-4 space-y-4">
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3">
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle class="text-lg font-semibold text-foreground">Product Categories</CardTitle>
                  <CardDescription>
                    Categories classify products for catalog browsing, billing rules, and discount approval ceilings.
                  </CardDescription>
                </div>
                <Badge variant="secondary" class="font-medium text-foreground">
                  {{ categories.length }} Categories
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead class="text-center">Linked Products</TableHead>
                    <TableHead v-if="isOrgAdmin" class="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="cat in categories" :key="cat.id">
                    <TableCell class="font-semibold text-foreground">
                      {{ cat.name }}
                    </TableCell>
                    <TableCell>
                      <code class="px-2 py-0.5 rounded bg-muted text-foreground text-xs font-mono">
                        {{ cat.code }}
                      </code>
                    </TableCell>
                    <TableCell class="text-xs text-muted-foreground max-w-md">
                      {{ cat.description || '—' }}
                    </TableCell>
                    <TableCell class="text-center">
                      <Badge variant="outline">
                        {{ cat._count?.products ?? 0 }} products
                      </Badge>
                    </TableCell>
                    <TableCell v-if="isOrgAdmin" class="text-right">
                      <div class="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                          @click="openEditCategoryDialog(cat)"
                        >
                          <Edit2 class="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          :disabled="(cat._count?.products ?? 0) > 0"
                          @click="handleDeleteCategory(cat)"
                        >
                          <Trash2 class="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- ================= TAB 3: CUSTOMER TIERS ================= -->
        <TabsContent value="tiers" class="mt-4 space-y-4">
          <Card class="border-border bg-card shadow-xs">
            <CardHeader class="pb-3">
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle class="text-lg font-semibold text-foreground">Customer Tiers</CardTitle>
                  <CardDescription>
                    Customer accounts belong to tiers which govern their price-list discounts.
                  </CardDescription>
                </div>
                <Badge variant="secondary" class="font-medium text-foreground">
                  {{ tiers.length }} Tiers Configured
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-16">S.No</TableHead>
                    <TableHead>Tier Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Default Discount</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead v-if="isOrgAdmin" class="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(t, tierIdx) in tiers" :key="t.id">
                    <TableCell>
                      <span class="text-xs font-semibold text-muted-foreground">{{ tierIdx + 1 }}</span>
                    </TableCell>
                    <TableCell class="font-semibold text-foreground flex items-center gap-1.5">
                      <Award class="w-4 h-4 text-amber-500" />
                      {{ t.name }}
                    </TableCell>
                    <TableCell>
                      <code class="px-2 py-0.5 rounded bg-muted text-foreground text-xs font-mono">
                        {{ t.code }}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" class="font-semibold text-primary">
                        {{ t.defaultDiscountPercent }}% OFF
                      </Badge>
                    </TableCell>
                    <TableCell class="text-xs text-muted-foreground max-w-md">
                      {{ t.description || '—' }}
                    </TableCell>
                    <TableCell v-if="isOrgAdmin" class="text-right">
                      <div class="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                          @click="openEditTierDialog(t)"
                        >
                          <Edit2 class="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          @click="handleDeleteTier(t)"
                        >
                          <Trash2 class="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <!-- ================= MODAL: PRODUCT DIALOG ================= -->
      <Dialog v-model:open="isProductDialogOpen">
        <DialogContent class="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{{ editingProductId ? 'Edit Product' : 'Create New Product' }}</DialogTitle>
            <DialogDescription>
              Configure product details, category classification, base pricing, and optional tier overrides.
            </DialogDescription>
          </DialogHeader>

          <form class="space-y-4 py-2" @submit.prevent="handleSaveProduct">
            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label for="prod-name">Product Name *</Label>
                <Input id="prod-name" v-model="productForm.name" required placeholder="e.g. Enterprise Server X1" />
              </div>
              <div class="grid gap-1.5">
                <Label for="prod-sku">Product SKU *</Label>
                <Input id="prod-sku" v-model="productForm.sku" required placeholder="e.g. SRV-X1-001" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label for="prod-cat">Category</Label>
                <select
                  id="prod-cat"
                  v-model="productForm.categoryId"
                  class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                >
                  <option value="">None / Uncategorized</option>
                  <option v-for="c in categories" :key="c.id" :value="c.id">
                    {{ c.name }}
                  </option>
                </select>
              </div>
              <div class="grid gap-1.5">
                <Label for="prod-cadence">Billing Frequency</Label>
                <select
                  id="prod-cadence"
                  v-model="productForm.billingFrequency"
                  class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                >
                  <option value="one_time">One-Time Purchase</option>
                  <option value="monthly">Monthly Subscription</option>
                  <option value="quarterly">Quarterly Subscription</option>
                  <option value="annual">Annual Subscription</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label for="prod-price">Base List Price ({{ authStore.state.organization?.currency || 'USD' }}) *</Label>
                <Input
                  id="prod-price"
                  v-model.number="productForm.price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                />
              </div>
              <div class="grid gap-1.5">
                <Label for="prod-cost">Estimated Cost (For Margins)</Label>
                <Input
                  id="prod-cost"
                  v-model.number="productForm.costPrice"
                  type="number"
                  step="0.01"
                  min="0"
                />
              </div>
            </div>

            <div class="grid gap-1.5">
              <Label for="prod-max-disc">Maximum Discount Threshold (%) — Optional</Label>
              <Input
                id="prod-max-disc"
                :model-value="productForm.maxDiscountPercent ?? undefined"
                @update:model-value="productForm.maxDiscountPercent = $event === '' || $event === null ? null : Number($event)"
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="e.g. 15 — leave blank to use the rulebook ceilings"
              />
              <p class="text-2xs text-muted-foreground">
                Discounts beyond this threshold on this product are flagged and routed for approval. If unset, the discount rulebook ceilings apply.
              </p>
            </div>

            <div class="grid gap-1.5">
              <Label for="prod-desc">Description</Label>
              <textarea
                id="prod-desc"
                v-model="productForm.description"
                rows="2"
                class="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                placeholder="Key specs, SLA terms, or notes..."
              ></textarea>
            </div>

            <!-- Customer Tier Custom Prices -->
            <div class="border-t border-slate-200 pt-3 space-y-2">
              <Label class="text-xs font-bold text-foreground uppercase tracking-wider">
                Tier-Specific Price Overrides (Optional)
              </Label>
              <p class="text-2xs text-slate-500">
                Override list price for specific customer tiers. If empty, the tier's default discount will calculate automatically.
              </p>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <div v-for="t in tiers" :key="t.id" class="p-2 border border-border rounded bg-muted/40">
                  <span class="text-xs font-semibold text-foreground block">{{ t.name }}</span>
                  <span class="text-2xs text-slate-500 block mb-1">Default: {{ t.defaultDiscountPercent }}% off</span>
                  <Input
                    v-model.number="productForm.tierOverrides[t.id]"
                    type="number"
                    step="0.01"
                    placeholder="Override price"
                    class="h-7 text-xs bg-white"
                  />
                </div>
              </div>
            </div>

            <DialogFooter class="pt-4">
              <Button type="button" variant="outline" @click="isProductDialogOpen = false">
                Cancel
              </Button>
              <Button type="submit" :disabled="isSubmitting" class="bg-primary text-primary-foreground hover:bg-primary/90">
                {{ isSubmitting ? 'Saving...' : editingProductId ? 'Save Changes' : 'Create Product' }}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <!-- ================= MODAL: CATEGORY DIALOG ================= -->
      <Dialog v-model:open="isCategoryDialogOpen">
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{{ editingCategoryId ? 'Edit Category' : 'Create Category' }}</DialogTitle>
            <DialogDescription>
              Categories classify products for catalog browsing and discount governance.
            </DialogDescription>
          </DialogHeader>

          <form class="space-y-4 py-2" @submit.prevent="handleSaveCategory">
            <div class="grid gap-2">
              <Label for="cat-name">Category Name *</Label>
              <Input id="cat-name" v-model="categoryForm.name" required placeholder="e.g. Hardware" />
            </div>

            <div class="grid gap-2">
              <Label for="cat-code">Category Code *</Label>
              <Input id="cat-code" v-model="categoryForm.code" required placeholder="e.g. hardware" />
            </div>

            <div class="grid gap-2">
              <Label for="cat-desc">Description</Label>
              <Input id="cat-desc" v-model="categoryForm.description" placeholder="Brief details..." />
            </div>

            <DialogFooter class="pt-4">
              <Button type="button" variant="outline" @click="isCategoryDialogOpen = false">
                Cancel
              </Button>
              <Button type="submit" :disabled="isSubmitting" class="bg-primary text-primary-foreground hover:bg-primary/90">
                {{ isSubmitting ? 'Saving...' : 'Save Category' }}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <!-- ================= MODAL: TIER DIALOG ================= -->
      <Dialog v-model:open="isTierDialogOpen">
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{{ editingTierId ? 'Edit Customer Tier' : 'Create Customer Tier' }}</DialogTitle>
            <DialogDescription>
              Tiers govern base pricing formulas and approval limits.
            </DialogDescription>
          </DialogHeader>

          <form class="space-y-4 py-2" @submit.prevent="handleSaveTier">
            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-2">
                <Label for="tier-name">Tier Name *</Label>
                <Input id="tier-name" v-model="tierForm.name" required placeholder="e.g. Platinum" />
              </div>
              <div class="grid gap-2">
                <Label for="tier-code">Code *</Label>
                <Input id="tier-code" v-model="tierForm.code" required placeholder="e.g. platinum" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-2">
                <Label for="tier-disc">Default Discount (%)</Label>
                <Input
                  id="tier-disc"
                  v-model.number="tierForm.defaultDiscountPercent"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  required
                />
              </div>
            </div>

            <div class="grid gap-2">
              <Label for="tier-desc">Description</Label>
              <Input id="tier-desc" v-model="tierForm.description" placeholder="Tier qualification or description..." />
            </div>

            <DialogFooter class="pt-4">
              <Button type="button" variant="outline" @click="isTierDialogOpen = false">
                Cancel
              </Button>
              <Button type="submit" :disabled="isSubmitting" class="bg-primary text-primary-foreground hover:bg-primary/90">
                {{ isSubmitting ? 'Saving...' : 'Save Customer Tier' }}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  </WorkspaceLayout>
</template>
