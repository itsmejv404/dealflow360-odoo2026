<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue';
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
  ShieldCheck,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Info,
} from 'lucide-vue-next';

interface CustomerTier {
  id: string;
  name: string;
  code: string;
  description?: string;
  defaultDiscountPercent: number;
}

interface ProductCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
}

interface MatrixCategory {
  category: ProductCategory;
  tierCeilings: Record<
    string,
    {
      id: string | null;
      maxDiscountPercent: number;
    }
  >;
}

const loading = ref(true);
const savingCeilings = ref(false);

const errorMessage = ref('');
const successMessage = ref('');

const tiers = ref<CustomerTier[]>([]);
const categories = ref<ProductCategory[]>([]);
const matrix = ref<MatrixCategory[]>([]);
const editedCeilings = reactive<Record<string, number>>({});

function getCeilingKey(catId: string, tierId: string): string {
  return `${catId}:${tierId}`;
}

function getCeilingValue(catId: string, tierId: string): number {
  const key = getCeilingKey(catId, tierId);
  if (editedCeilings[key] !== undefined) {
    return editedCeilings[key];
  }
  const row = matrix.value.find((m) => m.category.id === catId);
  return row?.tierCeilings[tierId]?.maxDiscountPercent ?? 0;
}

function setCeilingValue(catId: string, tierId: string, val: number | string) {
  const num = Math.min(100, Math.max(0, Number(val) || 0));
  editedCeilings[getCeilingKey(catId, tierId)] = Math.round(num * 100) / 100;
}

const hasUnsavedCeilings = computed(() => {
  return Object.keys(editedCeilings).length > 0;
});

async function fetchRulebook() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const res = await apiRequest<{
      tiers: CustomerTier[];
      categories: ProductCategory[];
      matrix: MatrixCategory[];
    }>('/api/rulebook');

    tiers.value = res.tiers || [];
    categories.value = res.categories || [];
    matrix.value = res.matrix || [];

    // Clear edited cache
    Object.keys(editedCeilings).forEach((k) => delete editedCeilings[k]);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to load discount rulebook';
  } finally {
    loading.value = false;
  }
}

async function saveDiscountCeilings() {
  savingCeilings.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const items: Array<{ tierId: string; categoryId: string; maxDiscountPercent: number }> = [];

    for (const cat of categories.value) {
      for (const tier of tiers.value) {
        const val = getCeilingValue(cat.id, tier.id);
        items.push({
          categoryId: cat.id,
          tierId: tier.id,
          maxDiscountPercent: val,
        });
      }
    }

    await apiRequest('/api/rulebook/ceilings', {
      method: 'PUT',
      data: { ceilings: items },
    });

    successMessage.value = 'Discount ceilings matrix saved successfully.';
    Object.keys(editedCeilings).forEach((k) => delete editedCeilings[k]);
    await fetchRulebook();

    setTimeout(() => {
      if (successMessage.value.includes('ceilings')) successMessage.value = '';
    }, 4000);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to save discount ceilings';
  } finally {
    savingCeilings.value = false;
  }
}

function getTierBadgeClass(code: string): string {
  switch (code.toLowerCase()) {
    case 'gold':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30';
    case 'silver':
      return 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-400/30';
    case 'bronze':
      return 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30';
    default:
      return 'bg-primary/10 text-primary border-primary/20';
  }
}

function getCategoryBadgeClass(code: string): string {
  switch (code.toLowerCase()) {
    case 'hardware':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30';
    case 'services':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
    case 'subscriptions':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30';
    default:
      return 'bg-secondary text-secondary-foreground';
  }
}

onMounted(() => {
  fetchRulebook();
});
</script>

<template>
  <WorkspaceLayout>
    <div class="space-y-6 max-w-7xl mx-auto">
      <!-- Top Title & Description -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold tracking-tight text-foreground">
              Discount Rulebook
            </h1>

          </div>
          <p class="text-sm text-muted-foreground mt-1">
            Set the maximum allowed discount for each Product Category across Customer Tiers.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="loading || savingCeilings"
            @click="fetchRulebook"
          >
            <RefreshCw class="w-4 h-4 mr-1.5" :class="{ 'animate-spin': loading }" />
            Refresh
          </Button>
        </div>
      </div>

      <!-- Feedback Alerts -->
      <div
        v-if="errorMessage"
        class="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2"
      >
        <AlertTriangle class="w-5 h-5 shrink-0 mt-0.5" />
        <div class="flex-1">{{ errorMessage }}</div>
      </div>

      <div
        v-if="successMessage"
        class="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm flex items-start gap-2"
      >
        <CheckCircle2 class="w-5 h-5 shrink-0 mt-0.5" />
        <div class="flex-1">{{ successMessage }}</div>
      </div>

      <!-- DISCOUNT CEILINGS MATRIX -->
      <Card>
        <CardHeader class="pb-4">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle class="text-lg font-semibold flex items-center gap-2">
                <ShieldCheck class="w-5 h-5 text-primary" />
                Discount Ceiling Matrix (Tier × Category)
              </CardTitle>
              <CardDescription class="mt-1">
                Defines the maximum allowed discount percentage for each Product Category based on Customer Tier.
              </CardDescription>
            </div>

            <div class="flex items-center gap-2">
              <Button
                v-if="hasUnsavedCeilings"
                variant="ghost"
                size="sm"
                @click="fetchRulebook"
              >
                Discard Changes
              </Button>
              <Button
                variant="default"
                size="sm"
                :disabled="savingCeilings || loading"
                @click="saveDiscountCeilings"
              >
                <Save class="w-4 h-4 mr-1.5" :class="{ 'animate-spin': savingCeilings }" />
                Save Ceilings
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div v-if="loading" class="py-12 text-center text-muted-foreground">
            <RefreshCw class="w-8 h-8 animate-spin mx-auto text-primary mb-3" />
            <p>Loading discount matrix...</p>
          </div>

          <div v-else-if="categories.length === 0 || tiers.length === 0" class="py-12 text-center text-muted-foreground">
            <Layers class="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
            <p class="font-medium">No categories or customer tiers found.</p>
            <p class="text-xs mt-1">Please set up categories and tiers in the Catalog section first.</p>
          </div>

          <div v-else class="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/40 hover:bg-muted/40">
                  <TableHead class="w-64 font-semibold">Product Category</TableHead>
                  <TableHead
                    v-for="tier in tiers"
                    :key="tier.id"
                    class="text-center font-semibold min-w-36"
                  >
                    <div class="flex flex-col items-center gap-1 py-1">
                      <Badge variant="outline" :class="getTierBadgeClass(tier.code)">
                        {{ tier.name }}
                      </Badge>
                      <span class="text-2xs text-muted-foreground font-normal">
                        Base {{ tier.defaultDiscountPercent }}% discount
                      </span>
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="row in matrix"
                  :key="row.category.id"
                  class="hover:bg-muted/20"
                >
                  <!-- Category Info -->
                  <TableCell class="font-medium align-middle">
                    <div class="space-y-0.5">
                      <div class="flex items-center gap-2">
                        <span class="font-semibold text-foreground">{{ row.category.name }}</span>
                        <Badge variant="outline" class="text-2xs font-mono" :class="getCategoryBadgeClass(row.category.code)">
                          {{ row.category.code }}
                        </Badge>
                      </div>
                      <p class="text-xs text-muted-foreground line-clamp-1">
                        {{ row.category.description || 'Standard product group' }}
                      </p>
                    </div>
                  </TableCell>

                  <!-- Ceiling Input Cells -->
                  <TableCell
                    v-for="tier in tiers"
                    :key="tier.id"
                    class="text-center align-middle p-3"
                  >
                    <div class="relative max-w-28 mx-auto">
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        max="100"
                        :value="getCeilingValue(row.category.id, tier.id)"
                        class="text-center pr-7 h-9 font-semibold text-sm transition-all focus:ring-2 focus:ring-primary/30"
                        :class="{
                          'border-primary ring-1 ring-primary/20 bg-primary/5':
                            editedCeilings[getCeilingKey(row.category.id, tier.id)] !== undefined
                        }"
                        @input="setCeilingValue(row.category.id, tier.id, ($event.target as HTMLInputElement).value)"
                      />
                      <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-bold pointer-events-none">
                        %
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <!-- Matrix Guidance Callout -->
          <div class="mt-4 p-4 rounded-lg bg-muted/40 border text-xs text-muted-foreground flex items-start gap-2.5">
            <Info class="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p class="font-medium text-foreground">Relational Discount Governance Rule:</p>
              <p class="mt-0.5 leading-relaxed">
                When sales reps build quotations, each line item is validated against its own product category's ceiling for the customer's tier. Discounts up to the ceiling are applied freely; discounts exceeding the ceiling are flagged by the live risk score so reviewers can act on them.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </WorkspaceLayout>
</template>
