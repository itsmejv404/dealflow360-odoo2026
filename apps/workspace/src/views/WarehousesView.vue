<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue';
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
} from 'lucide-vue-next';

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
  }>;
  rows: Array<{
    productId: string;
    productName: string;
    sku: string;
    quantities: Record<string, number>;
    total: number;
  }>;
  grandTotal: number;
}

interface ShippingRules {
  allowSplitShipments: boolean;
  chargeForSplitShipments: boolean;
  deliveryExtensionDays: number;
  notes?: string | null;
}

const activeTab = ref<'warehouses' | 'stock' | 'shipping'>('warehouses');
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

// ---- Stock adjustments ----
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

let socketBound = false;

onMounted(async () => {
  await loadAll();
  try {
    const socket = getSocket();
    if (!socketBound) {
      socket.on('inventory:updated', onInventoryUpdated);
      socketBound = true;
    }
  } catch (err) {
    console.warn('Socket setup for inventory failed:', err);
  }
});

onUnmounted(() => {
  try {
    const socket = getSocket();
    socket.off('inventory:updated', onInventoryUpdated);
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
      <TabsList class="grid grid-cols-3 w-full max-w-xl p-1 rounded-lg">
        <TabsTrigger value="warehouses" class="flex items-center gap-2 text-xs">
          <WarehouseIcon class="w-4 h-4" />
          Warehouses ({{ warehouses.length }})
        </TabsTrigger>
        <TabsTrigger value="stock" class="flex items-center gap-2 text-xs">
          <Boxes class="w-4 h-4" />
          Stock Levels
        </TabsTrigger>
        <TabsTrigger value="shipping" class="flex items-center gap-2 text-xs">
          <Truck class="w-4 h-4" />
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
                    <TableHead v-if="canEditWarehouses" class="text-right font-semibold text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(wh, idx) in warehouses" :key="wh.id" class="hover:bg-muted/30">
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
                    <TableCell v-if="canEditWarehouses" class="text-right">
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
                      v-for="wh in stockMatrix.warehouses"
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
                      v-for="wh in stockMatrix.warehouses"
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
                    </TableCell>
                    <TableCell class="text-center text-xs font-bold text-foreground">
                      {{ row.total }}
                    </TableCell>
                  </TableRow>
                  <TableRow class="bg-muted/40">
                    <TableCell class="text-xs font-bold text-foreground">Column Totals</TableCell>
                    <TableCell
                      v-for="wh in stockMatrix.warehouses"
                      :key="'tot-' + wh.id"
                      class="text-center text-xs font-bold text-foreground"
                    >
                      {{ wh.columnTotal }}
                    </TableCell>
                    <TableCell class="text-center text-xs font-bold text-primary">
                      {{ stockMatrix.grandTotal }}
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
    </div>
  </WorkspaceLayout>
</template>
