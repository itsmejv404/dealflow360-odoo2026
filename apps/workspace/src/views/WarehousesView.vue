<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { formatCurrency as formatMoney } from '@/lib/currency';
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
  Warehouse as WarehouseIcon,
  Boxes,
  Truck,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Star,
  Database,
  PackageX,
  Zap,
  Clock,
  ArrowUpRight,
} from 'lucide-vue-next';

const router = useRouter();

interface Warehouse {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  isDefault: boolean;
  status: 'active' | 'inactive';
  _count?: { stockLevels: number };
}

interface StockMatrix {
  cachedAt: string;
  warehouses: Array<{
    id: string;
    name: string;
    code: string;
    city: string | null;
    isDefault: boolean;
    status: string;
    columnTotal: number;
    columnWorth: number;
  }>;
  rows: Array<{
    productId: string;
    productName: string;
    sku: string;
    quantities: Record<string, number>;
    worth: Record<string, number>;
    total: number;
    totalWorth: number;
  }>;
  grandTotal: number;
  grandTotalWorth: number;
}

interface ShippingRules {
  allowSplitShipments: boolean;
  chargeForSplitShipments: boolean;
  deliveryExtensionDays: number;
  notes?: string | null;
}

interface BackorderRecord {
  id: string;
  quotationId: string;
  quotationLineId: string;
  productId: string;
  quantity: number;
  fulfilledQuantity: number;
  remainingQuantity: number;
  status: 'pending' | 'partially_fulfilled' | 'fulfilled' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  product?: { id: string; name: string; sku: string };
  quotation?: { id: string; quotationNumber: string; customer?: { name: string; company?: string } };
}

interface ConsolidationPromptRecord {
  id: string;
  planId: string;
  warehouseId: string;
  productId: string;
  proposedQuantity: number;
  availableStock: number;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: string;
  product?: { id: string; name: string; sku: string };
  warehouse?: { id: string; name: string; code: string };
  quotation?: { id: string; quotationNumber: string };
}

const activeTab = ref<'warehouses' | 'stock' | 'backorders' | 'shipping'>('warehouses');
const isLoading = ref(true);
const isSaving = ref(false);
const actionError = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const warehouses = ref<Warehouse[]>([]);
const stockMatrix = ref<StockMatrix | null>(null);
const shippingRules = ref<ShippingRules>({
  allowSplitShipments: true,
  chargeForSplitShipments: false,
  deliveryExtensionDays: 3,
  notes: '',
});

const canEditWarehouses = computed(() => authStore.state.user?.role === 'org_admin');
const canAdjustStock = computed(() =>
  ['org_admin', 'ops'].includes(authStore.state.user?.role || '')
);

// ---- Stock Arrival (Phase 17) ----
const isStockArrivalDialogOpen = ref(false);
const isSubmittingArrival = ref(false);
const stockArrivalForm = reactive({
  warehouseId: '',
  productId: '',
  quantity: 10,
  referenceNote: '',
});

function openStockArrivalDialog(defaultWarehouseId?: string, defaultProductId?: string) {
  const activeWh = warehouses.value.filter((w) => w.status === 'active');
  stockArrivalForm.warehouseId = defaultWarehouseId || (activeWh[0]?.id ?? '');
  stockArrivalForm.productId = defaultProductId || (stockMatrix.value?.rows[0]?.productId ?? '');
  stockArrivalForm.quantity = 10;
  stockArrivalForm.referenceNote = 'PO arrival restock';
  isStockArrivalDialogOpen.value = true;
}

async function submitStockArrival() {
  if (!stockArrivalForm.warehouseId || !stockArrivalForm.productId || stockArrivalForm.quantity < 1) {
    actionError.value = 'Select a warehouse, product, and positive quantity.';
    return;
  }
  isSubmittingArrival.value = true;
  actionError.value = null;
  try {
    const res = await apiRequest<{ success: boolean; jobId: string }>('/api/warehouses/stock/arrival', {
      method: 'POST',
      data: {
        warehouseId: stockArrivalForm.warehouseId,
        productId: stockArrivalForm.productId,
        quantityAdded: Number(stockArrivalForm.quantity),
        referenceNote: stockArrivalForm.referenceNote.trim() || undefined,
      },
    });
    const wh = warehouses.value.find((w) => w.id === stockArrivalForm.warehouseId);
    const prod = stockMatrix.value?.rows.find((r) => r.productId === stockArrivalForm.productId);
    successMessage.value = `Stock recorded! +${stockArrivalForm.quantity} unit(s) of ${prod?.productName || 'product'} in ${wh?.name || 'warehouse'}. Auto-consolidation job enqueued (Job #${res.jobId || 'done'})!`;
    isStockArrivalDialogOpen.value = false;
    await Promise.all([loadStock(), loadBackordersAndPrompts()]);
    setTimeout(() => {
      if (successMessage.value?.startsWith('Stock recorded')) {
        successMessage.value = null;
      }
    }, 4000);
  } catch (err: any) {
    actionError.value = err.message || 'Failed to record stock arrival';
  } finally {
    isSubmittingArrival.value = false;
  }
}

// ---- Backorders & Consolidation Prompts (Phase 17) ----
const backorders = ref<BackorderRecord[]>([]);
const consolidationPrompts = ref<ConsolidationPromptRecord[]>([]);
const isBackordersLoading = ref(false);
const promptBusyId = ref<string | null>(null);

async function loadBackordersAndPrompts() {
  isBackordersLoading.value = true;
  try {
    const [boRes, promptsRes] = await Promise.all([
      apiRequest<{ backorders: BackorderRecord[] }>('/api/fulfillment/backorders'),
      apiRequest<{ prompts: ConsolidationPromptRecord[] }>('/api/fulfillment/prompts?status=pending'),
    ]);
    backorders.value = boRes.backorders || [];
    consolidationPrompts.value = promptsRes.prompts || [];
  } catch (err: any) {
    console.warn('Failed to load backorders or prompts:', err);
  } finally {
    isBackordersLoading.value = false;
  }
}

async function handleConsolidatePrompt(prompt: ConsolidationPromptRecord) {
  promptBusyId.value = prompt.id;
  actionError.value = null;
  try {
    await apiRequest(`/api/fulfillment/prompts/${prompt.id}/consolidate`, {
      method: 'POST',
      body: '{}',
    });
    successMessage.value = `Backorder consolidated for quotation #${prompt.quotation?.quotationNumber || ''}! Stock deducted from ${prompt.warehouse?.name || 'warehouse'}.`;
    await Promise.all([loadBackordersAndPrompts(), loadStock()]);
    setTimeout(() => {
      if (successMessage.value?.startsWith('Backorder consolidated')) {
        successMessage.value = null;
      }
    }, 4000);
  } catch (err: any) {
    actionError.value = err.message || 'Failed to consolidate backorder';
  } finally {
    promptBusyId.value = null;
  }
}

async function handleDismissPrompt(prompt: ConsolidationPromptRecord) {
  promptBusyId.value = prompt.id;
  actionError.value = null;
  try {
    await apiRequest(`/api/fulfillment/prompts/${prompt.id}/dismiss`, {
      method: 'POST',
      body: '{}',
    });
    successMessage.value = 'Consolidation prompt dismissed.';
    await loadBackordersAndPrompts();
    setTimeout(() => {
      if (successMessage.value === 'Consolidation prompt dismissed.') {
        successMessage.value = null;
      }
    }, 2500);
  } catch (err: any) {
    actionError.value = err.message || 'Failed to dismiss prompt';
  } finally {
    promptBusyId.value = null;
  }
}

// ---- Warehouse form ----
const isWarehouseDialogOpen = ref(false);
const editingWarehouseId = ref<string | null>(null);
const isDeleting = ref<string | null>(null);
const warehouseForm = reactive({
  name: '',
  code: '',
  address: '',
  city: '',
  isDefault: false,
  status: 'active' as 'active' | 'inactive',
});

// ---- Stock edits (per cell, saved on blur/enter) ----
const savingCell = ref<string | null>(null);
const cellNotice = ref<string | null>(null);

async function loadAll() {
  isLoading.value = true;
  actionError.value = null;
  try {
    const [whRes, stockRes, rulesRes] = await Promise.all([
      apiRequest<{ warehouses: Warehouse[] }>('/api/warehouses'),
      apiRequest<StockMatrix>('/api/warehouses/stock'),
      apiRequest<{ rules: ShippingRules }>('/api/warehouses/shipping-rules'),
    ]);
    warehouses.value = whRes.warehouses || [];
    stockMatrix.value = stockRes;
    shippingRules.value = { ...shippingRules.value, ...rulesRes.rules };
    await Promise.all([loadBackordersAndPrompts()]);
    loadShippingOverrides();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to load warehouses and inventory';
  } finally {
    isLoading.value = false;
  }
}

async function loadStock() {
  try {
    stockMatrix.value = await apiRequest<StockMatrix>('/api/warehouses/stock');
  } catch (err: any) {
    actionError.value = err.message || 'Failed to load stock';
  }
}

function handleTabChange(tab: unknown) {
  activeTab.value = tab as any;
  actionError.value = null;
  successMessage.value = null;
}

// ---- Warehouse CRUD ----
function openAddWarehouse() {
  editingWarehouseId.value = null;
  warehouseForm.name = '';
  warehouseForm.code = '';
  warehouseForm.address = '';
  warehouseForm.city = '';
  warehouseForm.isDefault = warehouses.value.length === 0;
  warehouseForm.status = 'active';
  isWarehouseDialogOpen.value = true;
}

function openEditWarehouse(wh: Warehouse) {
  editingWarehouseId.value = wh.id;
  warehouseForm.name = wh.name;
  warehouseForm.code = wh.code;
  warehouseForm.address = wh.address || '';
  warehouseForm.city = wh.city || '';
  warehouseForm.isDefault = wh.isDefault;
  warehouseForm.status = wh.status;
  isWarehouseDialogOpen.value = true;
}

async function saveWarehouse() {
  if (!warehouseForm.name.trim() || !warehouseForm.code.trim()) {
    actionError.value = 'Warehouse name and code are required.';
    return;
  }
  isSaving.value = true;
  actionError.value = null;
  try {
    const payload = {
      name: warehouseForm.name.trim(),
      code: warehouseForm.code.trim(),
      address: warehouseForm.address.trim() || undefined,
      city: warehouseForm.city.trim() || undefined,
      isDefault: warehouseForm.isDefault,
      status: warehouseForm.status,
    };
    if (editingWarehouseId.value) {
      await apiRequest(`/api/warehouses/${editingWarehouseId.value}`, {
        method: 'PUT',
        data: payload,
      });
      successMessage.value = `Warehouse "${payload.name}" updated.`;
    } else {
      await apiRequest('/api/warehouses', { method: 'POST', data: payload });
      successMessage.value = `Warehouse "${payload.name}" created.`;
    }
    isWarehouseDialogOpen.value = false;
    await loadAll();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to save the warehouse';
  } finally {
    isSaving.value = false;
  }
}

async function deleteWarehouse(wh: Warehouse) {
  if (!window.confirm(`Delete warehouse "${wh.name}"?`)) return;
  isDeleting.value = wh.id;
  actionError.value = null;
  try {
    await apiRequest(`/api/warehouses/${wh.id}`, { method: 'DELETE' });
    successMessage.value = `Warehouse "${wh.name}" deleted.`;
    await loadAll();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to delete the warehouse';
  } finally {
    isDeleting.value = null;
  }
}

// ---- Click a warehouse row to manage its stock levels ----
const selectedWarehouseId = ref<string | null>(null);

const visibleStockWarehouses = computed(() => {
  if (!stockMatrix.value) return [];
  if (!selectedWarehouseId.value) return stockMatrix.value.warehouses;
  return stockMatrix.value.warehouses.filter((w) => w.id === selectedWarehouseId.value);
});

function openWarehouseStock(warehouseId: string) {
  selectedWarehouseId.value = warehouseId;
  handleTabChange('stock');
}

// ---- Stock adjustments ----
function warehouseWorth(warehouseId: string): string {
  const wh = stockMatrix.value?.warehouses.find((w) => w.id === warehouseId);
  return formatMoney(wh?.columnWorth ?? 0);
}

function stockToneClass(qty: number): string {
  if (qty <= 0) return 'text-red-600 dark:text-red-400 font-bold';
  if (qty < 5) return 'text-amber-600 dark:text-amber-400 font-semibold';
  return 'text-foreground';
}

async function adjustStock(row: StockMatrix['rows'][0], warehouseId: string) {
  if (!canAdjustStock.value) return;
  const cellKey = `${warehouseId}:${row.productId}`;
  const raw = row.quantities[warehouseId];
  const quantity = raw === null || raw === undefined || (raw as unknown) === ('' as unknown) ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
  savingCell.value = cellKey;
  cellNotice.value = null;
  try {
    await apiRequest(`/api/warehouses/${warehouseId}/stock/${row.productId}`, {
      method: 'PUT',
      data: { quantity },
    });
    row.quantities[warehouseId] = quantity;
    row.total = Object.values(row.quantities).reduce((a, b) => a + (Number(b) || 0), 0);
    const wh = stockMatrix.value?.warehouses.find((w) => w.id === warehouseId);
    if (wh) {
      wh.columnTotal = stockMatrix.value!.rows.reduce(
        (sum, r) => sum + (r.quantities[wh.id] || 0),
        0
      );
    }
    if (stockMatrix.value) {
      stockMatrix.value.grandTotal = stockMatrix.value.rows.reduce((sum, r) => sum + r.total, 0);
    }
    cellNotice.value = `Saved — ${row.productName} @ ${wh?.name || 'warehouse'} = ${quantity}`;
    setTimeout(() => {
      if (cellNotice.value?.startsWith('Saved')) cellNotice.value = null;
    }, 2500);
  } catch (err: any) {
    actionError.value = err.message || 'Failed to update stock';
    await loadStock();
  } finally {
    savingCell.value = null;
  }
}

// ---- Shipping rules ----
async function saveShippingRules() {
  isSaving.value = true;
  actionError.value = null;
  try {
    const res = await apiRequest<{ rules: ShippingRules }>('/api/warehouses/shipping-rules', {
      method: 'PUT',
      data: {
        allowSplitShipments: shippingRules.value.allowSplitShipments,
        chargeForSplitShipments: shippingRules.value.chargeForSplitShipments,
        deliveryExtensionDays: Number(shippingRules.value.deliveryExtensionDays) || 0,
        notes: shippingRules.value.notes?.trim() || null,
      },
    });
    shippingRules.value = { ...shippingRules.value, ...res.rules };
    successMessage.value = 'Shipping rules saved.';
    setTimeout(() => {
      if (successMessage.value === 'Shipping rules saved.') successMessage.value = null;
    }, 3000);
  } catch (err: any) {
    actionError.value = err.message || 'Failed to save shipping rules';
  } finally {
    isSaving.value = false;
  }
}

// ---- Shipping rules ----
const shippingScope = ref<'org' | 'customer' | 'warehouse'>('org');
const shippingScopeTargetId = ref<string>('');
const shippingOverrides = ref<any[]>([]);
const shippingCustomers = ref<Array<{ id: string; name: string; email: string }>>([]);
const shippingWarehousesList = ref<Array<{ id: string; name: string; code: string }>>([]);
const canManageOverrides = computed(() =>
  ['org_admin', 'manager', 'finance'].includes(authStore.state.user?.role || '')
);

async function loadShippingOverrides() {
  try {
    const data = await apiRequest<{
      overrides: any[];
      customers: Array<{ id: string; name: string; email: string }>;
      warehouses: Array<{ id: string; name: string; code: string }>;
    }>('/api/warehouses/shipping-rules/overrides');
    shippingOverrides.value = data.overrides || [];
    shippingCustomers.value = data.customers || [];
    shippingWarehousesList.value = data.warehouses || [];
  } catch {
    // Overrides listing is non-fatal
  }
}

function scopeTargetOptions(): Array<{ id: string; name: string; code?: string }> {
  return shippingScope.value === 'customer'
    ? shippingCustomers.value.map((c) => ({ id: c.id, name: c.name }))
    : shippingWarehousesList.value;
}

async function saveScopedShippingRules() {
  if (!shippingScopeTargetId.value) {
    actionError.value = 'Select a customer or warehouse for the override.';
    return;
  }
  isSaving.value = true;
  actionError.value = null;
  try {
    await apiRequest('/api/warehouses/shipping-rules/overrides', {
      method: 'PUT',
      data: {
        ...(shippingScope.value === 'customer'
          ? { customerId: shippingScopeTargetId.value }
          : { warehouseId: shippingScopeTargetId.value }),
        allowSplitShipments: shippingRules.value.allowSplitShipments,
        chargeForSplitShipments: shippingRules.value.chargeForSplitShipments,
        deliveryExtensionDays: shippingRules.value.deliveryExtensionDays,
        notes: shippingRules.value.notes || null,
      },
    });
    successMessage.value =
      shippingScope.value === 'customer'
        ? 'Customer shipping rule override saved.'
        : 'Warehouse shipping rule override saved.';
    await loadShippingOverrides();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to save the shipping rule override';
  } finally {
    isSaving.value = false;
  }
}

async function deleteShippingOverride(id: string) {
  if (!window.confirm('Remove this shipping rule override? The default rules will apply again.')) return;
  try {
    await apiRequest(`/api/warehouses/shipping-rules/overrides/${id}`, { method: 'DELETE' });
    successMessage.value = 'Override removed — default rules apply again.';
    await loadShippingOverrides();
  } catch (err: any) {
    actionError.value = err.message || 'Failed to remove the override';
  }
}

function overrideTargetLabel(o: any): string {
  if (o.customerId) {
    const c = shippingCustomers.value.find((x) => x.id === o.customerId);
    return `Customer: ${c?.name || o.customerId}`;
  }
  const w = shippingWarehousesList.value.find((x) => x.id === o.warehouseId);
  return `Warehouse: ${w?.name || o.warehouseId}`;
}

// ---- Realtime inventory updates from other actors ----
async function onInventoryUpdated(data: any) {
  if (!data) return;
  // Another screen adjusted stock — refresh the matrix (the writer already
  // invalidated the cache, so this read is fresh).
  if (activeTab.value === 'stock') {
    await loadStock();
  } else {
    await loadStock();
  }
  cellNotice.value = null;
}

let pollInterval: any = null;
let socketBound = false;

onMounted(async () => {
  await loadAll();
  try {
    const socket = getSocket();
    if (!socketBound) {
      socket.on('inventory:updated', onInventoryUpdated);
      socket.on('fulfillment:backorder_prompt', () => {
        loadBackordersAndPrompts();
          });
      socket.on('fulfillment:prompt_resolved', () => {
        loadBackordersAndPrompts();
          });
      socketBound = true;
    }
  } catch (err) {
    console.warn('Socket setup for inventory failed:', err);
  }
});

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
  try {
    const socket = getSocket();
    socket.off('inventory:updated', onInventoryUpdated);
    socket.off('fulfillment:backorder_prompt');
    socket.off('fulfillment:prompt_resolved');
    socketBound = false;
  } catch {
    // Non-fatal
  }
});
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-5">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <WarehouseIcon class="w-6 h-6 text-primary" />
          Warehouses & Inventory
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
          Manage your organization's warehouses, live stock levels, and shipping rules.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="canAdjustStock"
          variant="outline"
          size="sm"
          class="font-semibold"
          @click="() => openStockArrivalDialog()"
        >
          <Plus class="w-4 h-4 mr-1.5 text-primary" />
          Receive Stock
        </Button>
        <Button variant="outline" size="sm" :disabled="isLoading" @click="loadAll">
          <RefreshCw class="w-4 h-4 mr-1.5" :class="{ 'animate-spin': isLoading }" />
          Refresh
        </Button>
        <Button v-if="canEditWarehouses" size="sm" class="font-semibold" @click="openAddWarehouse">
          <Plus class="w-4 h-4 mr-1.5" />
          New Warehouse
        </Button>
      </div>
    </div>

    <!-- Alerts -->
    <div v-if="actionError" class="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-start gap-2">
      <AlertTriangle class="w-4 h-4 shrink-0 mt-0.5" />
      <span>{{ actionError }}</span>
    </div>
    <div v-if="successMessage" class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-300/50 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
      <CheckCircle2 class="w-4 h-4 shrink-0 mt-0.5" />
      <span>{{ successMessage }}</span>
    </div>

    <!-- Tabs -->
    <Tabs :model-value="activeTab" class="w-full" @update:model-value="handleTabChange">
      <TabsList class="grid grid-cols-2 sm:grid-cols-5 w-full max-w-3xl p-1 rounded-lg">
        <TabsTrigger value="warehouses" class="flex items-center gap-1.5 text-xs">
          <WarehouseIcon class="w-3.5 h-3.5" />
          Warehouses ({{ warehouses.length }})
        </TabsTrigger>
        <TabsTrigger value="stock" class="flex items-center gap-1.5 text-xs">
          <Boxes class="w-3.5 h-3.5" />
          Stock Levels
        </TabsTrigger>
        <TabsTrigger value="backorders" class="flex items-center gap-1.5 text-xs relative">
          <Clock class="w-3.5 h-3.5" />
          Backorders
          <Badge
            v-if="consolidationPrompts.length > 0"
            variant="outline"
            class="ml-1 px-1.5 py-0 text-2xs bg-blue-500/10 text-blue-600 border-blue-300 font-bold"
          >
            {{ consolidationPrompts.length }}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="shipping" class="flex items-center gap-1.5 text-xs">
          <Truck class="w-3.5 h-3.5" />
          Shipping Rules
        </TabsTrigger>
      </TabsList>

      <!-- TAB: Warehouses -->
      <TabsContent value="warehouses" class="mt-4 space-y-4">
        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-3 border-b border-border/70">
            <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
              <WarehouseIcon class="w-4 h-4 text-primary" />
              Your Warehouses
            </CardTitle>
            <CardDescription class="text-xs">
              Fulfillment locations for your organization.
              <template v-if="!canEditWarehouses"> Only an Org Admin can change warehouse setup.</template>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div v-if="isLoading" class="py-12 text-center text-muted-foreground text-sm">
              <RefreshCw class="w-8 h-8 animate-spin mx-auto text-primary mb-3" />
              Loading warehouses...
            </div>

            <div v-else-if="warehouses.length === 0" class="py-12 text-center space-y-3">
              <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <WarehouseIcon class="w-6 h-6" />
              </div>
              <h3 class="text-base font-semibold text-foreground">No warehouses yet</h3>
              <p class="text-xs text-muted-foreground max-w-sm mx-auto">
                Add your first fulfillment location to start tracking stock.
              </p>
              <Button v-if="canEditWarehouses" size="sm" class="mt-2" @click="openAddWarehouse">
                <Plus class="w-4 h-4 mr-1.5" />
                New Warehouse
              </Button>
            </div>

            <div v-else class="rounded-md border border-border overflow-x-auto">
              <Table class="min-w-[640px]">
                <TableHeader>
                  <TableRow class="bg-muted/50">
                    <TableHead class="w-14 font-semibold text-xs">S.No</TableHead>
                    <TableHead class="font-semibold text-xs">Warehouse</TableHead>
                    <TableHead class="font-semibold text-xs">Location</TableHead>
                    <TableHead class="font-semibold text-xs">Status</TableHead>
                    <TableHead class="text-center font-semibold text-xs">Stock Records</TableHead>
                    <TableHead class="text-right font-semibold text-xs">Stock Worth</TableHead>
                    <TableHead v-if="canEditWarehouses" class="text-right font-semibold text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="(wh, idx) in warehouses"
                    :key="wh.id"
                    class="hover:bg-muted/30 cursor-pointer"
                    @click="openWarehouseStock(wh.id)"
                  >
                    <TableCell class="text-xs font-semibold text-muted-foreground">{{ idx + 1 }}</TableCell>
                    <TableCell>
                      <div class="flex items-center gap-2">
                        <div class="min-w-0">
                          <div class="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            {{ wh.name }}
                            <Badge v-if="wh.isDefault" variant="outline" class="text-2xs bg-amber-500/10 text-amber-600 border-amber-300">
                              <Star class="w-2.5 h-2.5 mr-0.5" />
                              Primary
                            </Badge>
                          </div>
                          <div class="text-2xs text-muted-foreground font-mono">{{ wh.code }}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell class="text-xs text-muted-foreground">
                      <span v-if="wh.city || wh.address" class="flex items-center gap-1">
                        <MapPin class="w-3 h-3 shrink-0" />
                        {{ [wh.city, wh.address].filter(Boolean).join(' · ') }}
                      </span>
                      <span v-else>—</span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        class="text-2xs uppercase"
                        :class="wh.status === 'active'
                          ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300'
                          : 'bg-muted text-muted-foreground border-border'"
                      >
                        {{ wh.status === 'active' ? 'Active' : 'Inactive' }}
                      </Badge>
                    </TableCell>
                    <TableCell class="text-center text-xs text-muted-foreground">
                      {{ wh._count?.stockLevels ?? 0 }}
                    </TableCell>
                    <TableCell class="text-right text-xs font-semibold text-foreground">
                      {{ warehouseWorth(wh.id) }}
                    </TableCell>
                    <TableCell v-if="canEditWarehouses" class="text-right" @click.stop>
                      <div class="flex items-center justify-end gap-1.5">
                        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="openEditWarehouse(wh)">
                          <Pencil class="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-7 w-7 p-0"
                          :disabled="isDeleting === wh.id"
                          @click="deleteWarehouse(wh)"
                        >
                          <Trash2 class="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <!-- TAB: Stock Levels -->
      <TabsContent value="stock" class="mt-4 space-y-4">
        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-3 border-b border-border/70">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Boxes class="w-4 h-4 text-primary" />
                  Live Stock Levels
                  <Badge variant="outline" class="text-2xs flex items-center gap-1 text-muted-foreground">
                    <Database class="w-2.5 h-2.5" />
                    Cache-backed
                  </Badge>
                </CardTitle>
                <CardDescription class="text-xs">
                  <template v-if="canAdjustStock">Edit any cell and press Enter (or click away) to save.</template>
                  <template v-else> Read-only — Ops and Org Admins adjust stock.</template>
                  <template v-if="stockMatrix?.cachedAt">
                    Last served {{ new Date(stockMatrix.cachedAt).toLocaleTimeString() }}.
                  </template>
                </CardDescription>
              </div>
              <div v-if="cellNotice" class="text-2xs text-emerald-600 dark:text-emerald-400 font-medium">
                {{ cellNotice }}
              </div>
            </div>
            <div v-if="selectedWarehouseId" class="sm:col-span-full flex items-center gap-2 -mt-1 sm:justify-end">
              <span class="text-2xs text-muted-foreground">
                Showing stock for <span class="font-semibold text-foreground">{{ warehouses.find(w => w.id === selectedWarehouseId)?.name }}</span> — click another warehouse row to switch.
              </span>
              <Button variant="ghost" size="sm" class="h-6 text-2xs" @click="selectedWarehouseId = null">
                Show all warehouses
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div v-if="isLoading" class="py-12 text-center text-muted-foreground text-sm">
              <RefreshCw class="w-8 h-8 animate-spin mx-auto text-primary mb-3" />
              Loading stock...
            </div>

            <div v-else-if="!stockMatrix || stockMatrix.warehouses.length === 0" class="py-12 text-center space-y-3">
              <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <PackageX class="w-6 h-6" />
              </div>
              <h3 class="text-base font-semibold text-foreground">No warehouses to track stock in</h3>
              <p class="text-xs text-muted-foreground">Add a warehouse first, then stock levels appear here.</p>
            </div>

            <div v-else-if="stockMatrix.rows.length === 0" class="py-12 text-center space-y-3">
              <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <Boxes class="w-6 h-6" />
              </div>
              <h3 class="text-base font-semibold text-foreground">No products to stock yet</h3>
              <p class="text-xs text-muted-foreground">Add products in the Catalog and they will appear here automatically.</p>
            </div>

            <div v-else class="rounded-md border border-border overflow-x-auto">
              <Table class="min-w-[560px]">
                <TableHeader>
                  <TableRow class="bg-muted/50">
                    <TableHead class="font-semibold text-xs min-w-[200px]">Product</TableHead>
                    <TableHead
                      v-for="wh in visibleStockWarehouses"
                      :key="wh.id"
                      class="text-center font-semibold text-xs"
                    >
                      <div class="flex flex-col items-center gap-0.5 py-0.5">
                        <span class="flex items-center gap-1">
                          {{ wh.name }}
                          <Star v-if="wh.isDefault" class="w-3 h-3 text-amber-500" />
                        </span>
                        <span class="text-2xs text-muted-foreground font-normal">{{ wh.code }}</span>
                      </div>
                    </TableHead>
                    <TableHead class="text-center font-semibold text-xs">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="row in stockMatrix.rows" :key="row.productId" class="hover:bg-muted/20">
                    <TableCell>
                      <div class="text-xs font-semibold text-foreground">{{ row.productName }}</div>
                      <div class="text-2xs text-muted-foreground">{{ row.sku }}</div>
                    </TableCell>
                    <TableCell
                      v-for="wh in visibleStockWarehouses"
                      :key="wh.id"
                      class="text-center p-2"
                    >
                      <Input
                        v-if="canAdjustStock && wh.status === 'active'"
                        v-model.number="row.quantities[wh.id]"
                        type="number"
                        min="0"
                        step="1"
                        class="h-8 w-20 mx-auto text-center text-xs"
                        :class="stockToneClass(Number(row.quantities[wh.id] ?? 0))"
                        :disabled="savingCell === `${wh.id}:${row.productId}`"
                        @change="adjustStock(row, wh.id)"
                        @keydown.enter="($event.target as HTMLInputElement).blur()"
                      />
                      <span
                        v-else
                        class="text-xs"
                        :class="stockToneClass(Number(row.quantities[wh.id] ?? 0))"
                      >
                        {{ row.quantities[wh.id] ?? 0 }}
                      </span>
                      <div class="text-2xs text-muted-foreground mt-0.5">
                        {{ formatMoney(row.worth[wh.id] ?? 0) }}
                      </div>
                    </TableCell>
                    <TableCell class="text-center">
                      <div class="text-xs font-bold text-foreground">{{ row.total }}</div>
                      <div class="text-2xs text-muted-foreground">{{ formatMoney(row.totalWorth ?? 0) }}</div>
                    </TableCell>
                  </TableRow>
                  <TableRow class="bg-muted/40">
                    <TableCell class="text-xs font-bold text-foreground">Column Totals</TableCell>
                    <TableCell
                      v-for="wh in stockMatrix.warehouses"
                      :key="'tot-' + wh.id"
                      class="text-center"
                    >
                      <div class="text-xs font-bold text-foreground">{{ wh.columnTotal }}</div>
                      <div class="text-2xs text-muted-foreground">{{ formatMoney(wh.columnWorth ?? 0) }}</div>
                    </TableCell>
                    <TableCell class="text-center">
                      <div class="text-xs font-bold text-primary">{{ stockMatrix.grandTotal }}</div>
                      <div class="text-2xs text-muted-foreground">{{ formatMoney(stockMatrix.grandTotalWorth ?? 0) }}</div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-4 text-2xs text-muted-foreground">
              <span class="flex items-center gap-1.5">
                <span class="size-2 rounded-full bg-emerald-500"></span> In stock (5+)
              </span>
              <span class="flex items-center gap-1.5">
                <span class="size-2 rounded-full bg-amber-500"></span> Low stock (under 5)
              </span>
              <span class="flex items-center gap-1.5">
                <span class="size-2 rounded-full bg-red-500"></span> Out of stock
              </span>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <!-- TAB: Backorders & Consolidation (Phase 17) -->
      <TabsContent value="backorders" class="mt-4 space-y-4">
        <!-- Active Prompts Banner / Section -->
        <div v-if="consolidationPrompts.length > 0" class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap class="w-4 h-4 text-blue-500" />
              Active Consolidation Prompts ({{ consolidationPrompts.length }})
            </h3>
            <span class="text-2xs text-muted-foreground">
              Generated in real-time by background BullMQ consolidation worker
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card
              v-for="prompt in consolidationPrompts"
              :key="prompt.id"
              class="border-blue-300 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 shadow-xs"
            >
              <CardContent class="p-4 space-y-3">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="flex items-center gap-1.5">
                      <span class="font-bold text-xs text-blue-700 dark:text-blue-300">
                        Quote #{{ prompt.quotation?.quotationNumber || 'Unknown' }}
                      </span>
                      <Badge variant="outline" class="text-2xs bg-blue-500/10 text-blue-600 border-blue-300">
                        Consolidation Prompt
                      </Badge>
                    </div>
                    <div class="text-xs font-semibold text-foreground mt-1">
                      {{ prompt.product?.name || 'Product' }}
                      <span class="text-2xs font-mono text-muted-foreground ml-1">({{ prompt.product?.sku }})</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 text-2xs"
                    @click="router.push(`/quotations/${prompt.planId ? prompt.quotation?.id || '' : ''}`)"
                  >
                    View Quote
                    <ArrowUpRight class="w-3 h-3 ml-0.5" />
                  </Button>
                </div>

                <div class="p-2.5 rounded-md bg-background/80 border border-border/60 text-xs space-y-1">
                  <div class="flex items-center justify-between">
                    <span class="text-muted-foreground">Warehouse:</span>
                    <span class="font-semibold text-foreground">{{ prompt.warehouse?.name }} ({{ prompt.warehouse?.code }})</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-muted-foreground">Stock Available:</span>
                    <span class="font-semibold text-emerald-600 dark:text-emerald-400">{{ prompt.availableStock }} units</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-muted-foreground">Proposed Consolidation:</span>
                    <span class="font-bold text-blue-600 dark:text-blue-400">{{ prompt.proposedQuantity }} unit(s)</span>
                  </div>
                </div>

                <div class="flex items-center justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 text-xs"
                    :disabled="promptBusyId === prompt.id"
                    @click="handleDismissPrompt(prompt)"
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    class="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    :disabled="promptBusyId === prompt.id"
                    @click="handleConsolidatePrompt(prompt)"
                  >
                    <Zap class="w-3 h-3 mr-1" :class="{ 'animate-spin': promptBusyId === prompt.id }" />
                    Consolidate Backorder
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <!-- Backorders Table -->
        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-3 border-b border-border/70">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Clock class="w-4 h-4 text-primary" />
                  All Backorders
                  <Badge variant="outline" class="text-2xs text-muted-foreground">
                    {{ backorders.length }} total
                  </Badge>
                </CardTitle>
                <CardDescription class="text-xs">
                  Pending and fulfilled backordered quotation items in your organization.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-xs"
                :disabled="isBackordersLoading"
                @click="loadBackordersAndPrompts"
              >
                <RefreshCw class="w-3 h-3 mr-1" :class="{ 'animate-spin': isBackordersLoading }" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div v-if="isBackordersLoading" class="py-12 text-center text-muted-foreground text-sm">
              <RefreshCw class="w-8 h-8 animate-spin mx-auto text-primary mb-3" />
              Loading backorders...
            </div>

            <div v-else-if="backorders.length === 0" class="py-12 text-center space-y-3">
              <div class="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <CheckCircle2 class="w-6 h-6 text-emerald-500" />
              </div>
              <h3 class="text-base font-semibold text-foreground">No pending backorders</h3>
              <p class="text-xs text-muted-foreground max-w-sm mx-auto">
                When an order is accepted with shortfall items, backorders are tracked here automatically.
              </p>
            </div>

            <div v-else class="rounded-md border border-border overflow-x-auto">
              <Table class="min-w-[680px]">
                <TableHeader>
                  <TableRow class="bg-muted/50">
                    <TableHead class="font-semibold text-xs">Quotation</TableHead>
                    <TableHead class="font-semibold text-xs">Product</TableHead>
                    <TableHead class="text-center font-semibold text-xs">Backordered</TableHead>
                    <TableHead class="text-center font-semibold text-xs">Fulfilled</TableHead>
                    <TableHead class="text-center font-semibold text-xs">Remaining</TableHead>
                    <TableHead class="text-center font-semibold text-xs">Status</TableHead>
                    <TableHead class="text-right font-semibold text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="bo in backorders" :key="bo.id" class="hover:bg-muted/20">
                    <TableCell>
                      <div class="text-xs font-semibold text-foreground">
                        #{{ bo.quotation?.quotationNumber || 'Quote' }}
                      </div>
                      <div class="text-2xs text-muted-foreground">
                        {{ bo.quotation?.customer?.name || 'Customer' }}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div class="text-xs font-semibold text-foreground">{{ bo.product?.name || 'Product' }}</div>
                      <div class="text-2xs text-muted-foreground font-mono">{{ bo.product?.sku }}</div>
                    </TableCell>
                    <TableCell class="text-center text-xs font-mono font-medium">
                      {{ bo.quantity }}
                    </TableCell>
                    <TableCell class="text-center text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {{ bo.fulfilledQuantity }}
                    </TableCell>
                    <TableCell
                      class="text-center text-xs font-mono font-bold"
                      :class="bo.remainingQuantity > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'"
                    >
                      {{ bo.remainingQuantity }}
                    </TableCell>
                    <TableCell class="text-center">
                      <Badge
                        variant="outline"
                        class="text-2xs uppercase"
                        :class="bo.status === 'fulfilled'
                          ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300'
                          : bo.status === 'partially_fulfilled'
                            ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-300'
                            : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300'"
                      >
                        {{ bo.status.replace('_', ' ') }}
                      </Badge>
                    </TableCell>
                    <TableCell class="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-7 text-xs"
                        @click="router.push(`/quotations/${bo.quotationId}`)"
                      >
                        View
                        <ArrowUpRight class="w-3 h-3 ml-1" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

<!-- TAB: Shipping Rules -->
      <TabsContent value="shipping" class="mt-4 space-y-4">
        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-3 border-b border-border/70">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Truck class="w-4 h-4 text-primary" />
                  Shipping Rules
                </CardTitle>
                <CardDescription class="text-xs">
                  How fulfillment handles products that are not available in the same warehouse.
                </CardDescription>
              </div>
              <Button
                v-if="canEditWarehouses"
                size="sm"
                :disabled="isSaving"
                @click="saveShippingRules"
              >
                <Save class="w-4 h-4 mr-1.5" :class="{ 'animate-spin': isSaving }" />
                Save Rules
              </Button>
            </div>
          </CardHeader>
          <CardContent class="space-y-5 pt-4">
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                v-model="shippingRules.allowSplitShipments"
                type="checkbox"
                :disabled="!canEditWarehouses"
                class="mt-0.5 rounded border-border text-primary focus:ring-primary h-4 w-4"
              />
              <div>
                <p class="text-xs font-semibold text-foreground">
                  Allow split shipments across warehouses
                </p>
                <p class="text-2xs text-muted-foreground">
                  If a product is not available in the same warehouse, the salesperson can still
                  promise it — fulfillment ships from multiple warehouses.
                </p>
              </div>
            </label>

            <label class="flex items-start gap-3 cursor-pointer" :class="{ 'opacity-50 pointer-events-none': !shippingRules.allowSplitShipments }">
              <input
                v-model="shippingRules.chargeForSplitShipments"
                type="checkbox"
                :disabled="!canEditWarehouses"
                class="mt-0.5 rounded border-border text-primary focus:ring-primary h-4 w-4"
              />
              <div>
                <p class="text-xs font-semibold text-foreground">
                  Charge the customer extra for split shipments
                </p>
                <p class="text-2xs text-muted-foreground">
                  Keep this off (recommended): split shipments extend the delivery date instead of
                  costing the customer more.
                </p>
              </div>
            </label>

            <div class="grid gap-2 max-w-xs">
              <Label class="text-xs font-semibold">Delivery extension when split (days)</Label>
              <Input
                v-model.number="shippingRules.deliveryExtensionDays"
                type="number"
                min="0"
                max="60"
                :disabled="!canEditWarehouses || !shippingRules.allowSplitShipments"
                class="h-9 w-28"
              />
              <p class="text-2xs text-muted-foreground">
                Added to the promised delivery date when an order ships from multiple warehouses.
              </p>
            </div>

            <div class="grid gap-2">
              <Label class="text-xs font-semibold">Notes (optional)</Label>
              <textarea
                v-model="shippingRules.notes"
                rows="3"
                :disabled="!canEditWarehouses"
                placeholder="Any additional fulfillment or delivery terms..."
                class="w-full rounded-md border border-input bg-background p-2.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
              ></textarea>
            </div>
          </CardContent>
        </Card>

        <!-- Scoped overrides: per-customer / per-warehouse shipping rules -->
        <Card class="border-border bg-card shadow-xs">
          <CardHeader class="pb-3 border-b border-border/70">
            <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-2">
              <Truck class="w-4 h-4 text-primary" />
              Rule Overrides
            </CardTitle>
            <CardDescription class="text-xs">
              Shipping rules can differ per customer and per warehouse. Overrides take priority over
              the organization defaults above; split-warehouse shipments resolve rules per warehouse.
            </CardDescription>
          </CardHeader>
          <CardContent class="pt-4 space-y-4" v-if="canManageOverrides">
            <div class="flex flex-col sm:flex-row sm:items-end gap-3">
              <div class="grid gap-1.5">
                <Label class="text-xs font-semibold">Scope</Label>
                <select
                  v-model="shippingScope"
                  class="h-9 text-xs bg-background border border-border rounded-md px-2 text-foreground"
                >
                  <option value="customer">Per Customer</option>
                  <option value="warehouse">Per Warehouse</option>
                </select>
              </div>
              <div class="grid gap-1.5 flex-1">
                <Label class="text-xs font-semibold">
                  {{ shippingScope === 'customer' ? 'Customer' : 'Warehouse' }}
                </Label>
                <select
                  v-model="shippingScopeTargetId"
                  class="h-9 text-xs bg-background border border-border rounded-md px-2 text-foreground"
                >
                  <option value="" disabled>Select…</option>
                  <option v-for="opt in scopeTargetOptions()" :key="opt.id" :value="opt.id">
                    {{ shippingScope === 'customer' ? opt.name : `${opt.name} (${opt.code})` }}
                  </option>
                </select>
              </div>
              <Button size="sm" :disabled="isSaving" @click="saveScopedShippingRules">
                <Save class="w-3.5 h-3.5 mr-1.5" />
                Save Override
              </Button>
            </div>

            <div v-if="shippingOverrides.length > 0" class="space-y-2">
              <div
                v-for="o in shippingOverrides"
                :key="o.id"
                class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2"
              >
                <div class="text-xs">
                  <span class="font-semibold text-foreground">{{ overrideTargetLabel(o) }}</span>
                  <span class="text-muted-foreground">
                    — {{ o.allowSplitShipments ? 'split allowed' : 'no splits' }},
                    {{ o.chargeForSplitShipments ? 'extra charge' : 'no extra charge' }},
                    +{{ o.deliveryExtensionDays }}d delivery
                  </span>
                </div>
                <Button variant="ghost" size="sm" class="h-7 text-2xs" @click="deleteShippingOverride(o.id)">
                  Remove
                </Button>
              </div>
            </div>
            <p v-else class="text-2xs text-muted-foreground">
              No overrides yet — all customers and warehouses use the organization defaults.
            </p>
          </CardContent>
          <CardContent v-else class="pt-4">
            <p class="text-2xs text-muted-foreground">
              Only Org Admins, Managers, and Finance can manage shipping rule overrides.
            </p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <!-- Warehouse create/edit dialog -->
    <Dialog :open="isWarehouseDialogOpen" @update:open="isWarehouseDialogOpen = $event">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="text-base flex items-center gap-2">
            <WarehouseIcon class="w-4 h-4 text-primary" />
            {{ editingWarehouseId ? 'Edit Warehouse' : 'New Warehouse' }}
          </DialogTitle>
          <DialogDescription class="text-xs">
            Fulfillment locations hold stock for your products.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3 py-1">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <Label class="text-xs font-semibold">Name <span class="text-destructive">*</span></Label>
              <Input v-model="warehouseForm.name" placeholder="e.g. Central Warehouse" class="h-9 text-xs" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs font-semibold">Code <span class="text-destructive">*</span></Label>
              <Input v-model="warehouseForm.code" placeholder="e.g. WH-CENTRAL" class="h-9 text-xs" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs font-semibold">City</Label>
              <Input v-model="warehouseForm.city" placeholder="e.g. Chicago" class="h-9 text-xs" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs font-semibold">Status</Label>
              <select
                v-model="warehouseForm.status"
                class="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div class="grid gap-1.5">
            <Label class="text-xs font-semibold">Address</Label>
            <Input v-model="warehouseForm.address" placeholder="Street address" class="h-9 text-xs" />
          </div>
          <label class="flex items-start gap-3 cursor-pointer pt-1">
            <input
              v-model="warehouseForm.isDefault"
              type="checkbox"
              class="mt-0.5 rounded border-border text-primary focus:ring-primary h-4 w-4"
            />
            <div>
              <p class="text-xs font-semibold text-foreground">Primary warehouse</p>
              <p class="text-2xs text-muted-foreground">
                The first location fulfillment tries for every order.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter class="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" @click="isWarehouseDialogOpen = false">Cancel</Button>
          <Button
            size="sm"
            class="font-semibold"
            :disabled="isSaving || !warehouseForm.name.trim() || !warehouseForm.code.trim()"
            @click="saveWarehouse"
          >
            <Save v-if="!isSaving" class="w-3.5 h-3.5 mr-1" />
            <RefreshCw v-else class="w-3.5 h-3.5 mr-1 animate-spin" />
            {{ editingWarehouseId ? 'Save Changes' : 'Create Warehouse' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Stock Arrival Dialog (Phase 17) -->
    <Dialog :open="isStockArrivalDialogOpen" @update:open="isStockArrivalDialogOpen = $event">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle class="text-base flex items-center gap-2">
            <Boxes class="w-4 h-4 text-primary" />
            Receive Stock Arrival
          </DialogTitle>
          <DialogDescription class="text-xs">
            Record inventory arriving at a warehouse. Automatically triggers the BullMQ auto-consolidation job for backorders.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3 py-1 text-xs">
          <div class="space-y-1.5">
            <Label class="text-xs font-semibold">Receiving Warehouse <span class="text-destructive">*</span></Label>
            <select
              v-model="stockArrivalForm.warehouseId"
              class="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
            >
              <option value="" disabled>-- Select a warehouse --</option>
              <option
                v-for="w in warehouses.filter(w => w.status === 'active')"
                :key="w.id"
                :value="w.id"
              >
                {{ w.name }} ({{ w.code }})
              </option>
            </select>
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs font-semibold">Product <span class="text-destructive">*</span></Label>
            <select
              v-model="stockArrivalForm.productId"
              class="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
            >
              <option value="" disabled>-- Select a product --</option>
              <option
                v-for="r in stockMatrix?.rows || []"
                :key="r.productId"
                :value="r.productId"
              >
                {{ r.productName }} ({{ r.sku }})
              </option>
            </select>
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs font-semibold">Quantity Received <span class="text-destructive">*</span></Label>
            <Input
              v-model.number="stockArrivalForm.quantity"
              type="number"
              min="1"
              class="h-9 text-xs"
            />
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs font-semibold">Reference Note / PO #</Label>
            <Input
              v-model="stockArrivalForm.referenceNote"
              placeholder="e.g. PO-8812 Restock"
              class="h-9 text-xs"
            />
          </div>
        </div>

        <DialogFooter class="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" @click="isStockArrivalDialogOpen = false">Cancel</Button>
          <Button
            size="sm"
            class="font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
            :disabled="isSubmittingArrival || !stockArrivalForm.warehouseId || !stockArrivalForm.productId || stockArrivalForm.quantity < 1"
            @click="submitStockArrival"
          >
            <CheckCircle2 v-if="!isSubmittingArrival" class="w-3.5 h-3.5 mr-1" />
            <RefreshCw v-else class="w-3.5 h-3.5 mr-1 animate-spin" />
            Record Arrival & Run Consolidation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  </WorkspaceLayout>
</template>
