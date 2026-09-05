<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue';
import WorkspaceLayout from '../components/layout/WorkspaceLayout.vue';
import { apiRequest } from '../lib/api';
import { authStore } from '../lib/auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ShieldAlert,
  ShieldCheck,
  Percent,
  Sliders,
  PlayCircle,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Award,
  ArrowRight,
  UserCheck,
  DollarSign,
  Info,
  Check,
  Sparkles,
} from 'lucide-vue-next';

interface CustomerTier {
  id: string;
  name: string;
  code: string;
  description?: string;
  defaultDiscountPercent: number;
  rank: number;
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

interface ApprovalConfig {
  id: string;
  managerThresholdPercent: number;
  financeThresholdPercent: number;
  requireFinanceAboveThreshold: boolean;
  autoApproveWithinCeilings: boolean;
}

interface EvaluationResult {
  tierId: string;
  tierName: string;
  categoryId: string;
  categoryName: string;
  maxDiscountPercent: number;
  proposedDiscountPercent: number;
  discountDelta: number;
  outcome: 'AUTO_APPROVED' | 'MANAGER_ONLY' | 'MANAGER_THEN_FINANCE';
  requiresManager: boolean;
  requiresFinance: boolean;
  reason: string;
}

const activeTab = ref('matrix');
const loading = ref(true);
const savingCeilings = ref(false);
const savingConfig = ref(false);
const evaluating = ref(false);

const errorMessage = ref('');
const successMessage = ref('');

const tiers = ref<CustomerTier[]>([]);
const categories = ref<ProductCategory[]>([]);
const matrix = ref<MatrixCategory[]>([]);
const editedCeilings = reactive<Record<string, number>>({});

const approvalConfig = reactive<ApprovalConfig>({
  id: '',
  managerThresholdPercent: 0,
  financeThresholdPercent: 15,
  requireFinanceAboveThreshold: true,
  autoApproveWithinCeilings: true,
});

// Simulator state
const simTierId = ref('');
const simCategoryId = ref('');
const simDiscountPercent = ref(15);
const simResult = ref<EvaluationResult | null>(null);

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
      approvalConfig: ApprovalConfig | null;
    }>('/api/rulebook');

    tiers.value = res.tiers || [];
    categories.value = res.categories || [];
    matrix.value = res.matrix || [];

    if (res.approvalConfig) {
      approvalConfig.id = res.approvalConfig.id;
      approvalConfig.managerThresholdPercent = res.approvalConfig.managerThresholdPercent;
      approvalConfig.financeThresholdPercent = res.approvalConfig.financeThresholdPercent;
      approvalConfig.requireFinanceAboveThreshold = res.approvalConfig.requireFinanceAboveThreshold;
      approvalConfig.autoApproveWithinCeilings = res.approvalConfig.autoApproveWithinCeilings;
    }

    // Set simulator defaults
    if (tiers.value.length > 0 && !simTierId.value && tiers.value[0]) {
      simTierId.value = tiers.value[0].id;
    }
    if (categories.value.length > 0 && !simCategoryId.value && categories.value[0]) {
      simCategoryId.value = categories.value[0].id;
    }

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

async function saveApprovalConfig() {
  savingConfig.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const res = await apiRequest<{ config: ApprovalConfig }>('/api/rulebook/approval-chain', {
      method: 'PUT',
      data: {
        managerThresholdPercent: Number(approvalConfig.managerThresholdPercent),
        financeThresholdPercent: Number(approvalConfig.financeThresholdPercent),
        requireFinanceAboveThreshold: approvalConfig.requireFinanceAboveThreshold,
        autoApproveWithinCeilings: approvalConfig.autoApproveWithinCeilings,
      },
    });

    if (res.config) {
      approvalConfig.managerThresholdPercent = res.config.managerThresholdPercent;
      approvalConfig.financeThresholdPercent = res.config.financeThresholdPercent;
      approvalConfig.requireFinanceAboveThreshold = res.config.requireFinanceAboveThreshold;
      approvalConfig.autoApproveWithinCeilings = res.config.autoApproveWithinCeilings;
    }

    successMessage.value = 'Approval chain configuration updated.';
    setTimeout(() => {
      if (successMessage.value.includes('Approval')) successMessage.value = '';
    }, 4000);
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to update approval chain configuration';
  } finally {
    savingConfig.value = false;
  }
}

async function runSimulator() {
  if (!simTierId.value || !simCategoryId.value) return;

  evaluating.value = true;
  try {
    const res = await apiRequest<{ evaluation: EvaluationResult }>('/api/rulebook/evaluate', {
      method: 'POST',
      data: {
        tierId: simTierId.value,
        categoryId: simCategoryId.value,
        proposedDiscountPercent: Number(simDiscountPercent.value) || 0,
      },
    });
    simResult.value = res.evaluation;
  } catch (err: any) {
    errorMessage.value = err.message || 'Simulation failed';
  } finally {
    evaluating.value = false;
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
              Discount Rulebook & Approvals
            </h1>
            <Badge variant="outline" class="text-xs bg-primary/5 text-primary border-primary/20">
              Stage 1 Governance
            </Badge>
          </div>
          <p class="text-sm text-muted-foreground mt-1">
            Configure discount ceilings across Customer Tiers × Product Categories and define multi-step approval routing thresholds.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="loading || savingCeilings || savingConfig"
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

      <!-- Main Tabs -->
      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid grid-cols-3 w-full max-w-xl">
          <TabsTrigger value="matrix" class="flex items-center gap-2">
            <Percent class="w-4 h-4" />
            Ceiling Matrix
          </TabsTrigger>
          <TabsTrigger value="chains" class="flex items-center gap-2">
            <Sliders class="w-4 h-4" />
            Approval Chains
          </TabsTrigger>
          <TabsTrigger value="simulator" class="flex items-center gap-2">
            <PlayCircle class="w-4 h-4" />
            Rule Simulator
          </TabsTrigger>
        </TabsList>

        <!-- TAB 1: DISCOUNT CEILINGS MATRIX -->
        <TabsContent value="matrix" class="mt-6 space-y-6">
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
                            Rank {{ tier.rank }} · Base {{ tier.defaultDiscountPercent }}%
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
                    When sales reps build quotations, each line item is validated against its own product category's ceiling for the customer's tier. Discounts up to the ceiling are auto-approved; discounts exceeding the ceiling trigger the approval chain configured below.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- TAB 2: APPROVAL CHAINS CONFIGURATION -->
        <TabsContent value="chains" class="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle class="text-lg font-semibold flex items-center gap-2">
                    <Sliders class="w-5 h-5 text-primary" />
                    Approval Chain Governance Workflow
                  </CardTitle>
                  <CardDescription class="mt-1">
                    Configure automated routing thresholds for quotations exceeding category discount ceilings.
                  </CardDescription>
                </div>

                <Button
                  variant="default"
                  size="sm"
                  :disabled="savingConfig || loading"
                  @click="saveApprovalConfig"
                >
                  <Save class="w-4 h-4 mr-1.5" :class="{ 'animate-spin': savingConfig }" />
                  Save Approval Rules
                </Button>
              </div>
            </CardHeader>

            <CardContent class="space-y-8">
              <!-- Visual Step Pipeline Diagram -->
              <div class="p-6 rounded-xl bg-muted/30 border space-y-4">
                <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Live Routing Flowchart
                </h4>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
                  <!-- Step 1: Auto-Approved -->
                  <div class="p-4 rounded-lg bg-card border border-emerald-500/30 shadow-xs space-y-2 relative overflow-hidden">
                    <div class="h-1 bg-emerald-500 absolute top-0 left-0 right-0"></div>
                    <div class="flex items-center justify-between">
                      <Badge class="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-xs">
                        Tier 1: Within Ceiling
                      </Badge>
                      <CheckCircle2 class="w-4 h-4 text-emerald-600" />
                    </div>
                    <p class="text-sm font-bold text-foreground">Instant Approval</p>
                    <p class="text-xs text-muted-foreground">
                      Discounts ≤ Category Ceiling. No managerial review needed. Quotes can be sent directly to customer.
                    </p>
                  </div>

                  <!-- Step 2: Sales Manager -->
                  <div class="p-4 rounded-lg bg-card border border-amber-500/30 shadow-xs space-y-2 relative overflow-hidden">
                    <div class="h-1 bg-amber-500 absolute top-0 left-0 right-0"></div>
                    <div class="flex items-center justify-between">
                      <Badge class="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-xs">
                        Tier 2: Moderate Deviation
                      </Badge>
                      <UserCheck class="w-4 h-4 text-amber-600" />
                    </div>
                    <p class="text-sm font-bold text-foreground">Sales Manager Only</p>
                    <p class="text-xs text-muted-foreground">
                      Exceeds ceiling by up to <strong>+{{ approvalConfig.financeThresholdPercent }}%</strong>. Routes to Sales Manager with mandatory review reason.
                    </p>
                  </div>

                  <!-- Step 3: Sales Manager + Finance Escalation -->
                  <div class="p-4 rounded-lg bg-card border border-purple-500/30 shadow-xs space-y-2 relative overflow-hidden">
                    <div class="h-1 bg-purple-500 absolute top-0 left-0 right-0"></div>
                    <div class="flex items-center justify-between">
                      <Badge class="bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20 text-xs">
                        Tier 3: High Risk / Finance
                      </Badge>
                      <ShieldAlert class="w-4 h-4 text-purple-600" />
                    </div>
                    <p class="text-sm font-bold text-foreground">Manager → Finance</p>
                    <p class="text-xs text-muted-foreground">
                      Exceeds ceiling by <strong>&gt; +{{ approvalConfig.financeThresholdPercent }}%</strong>. Requires Sales Manager approval followed by Finance sign-off.
                    </p>
                  </div>
                </div>
              </div>

              <!-- Configuration Form -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Finance Threshold Setting -->
                <div class="p-5 rounded-lg border bg-card space-y-3">
                  <div class="flex items-center justify-between">
                    <Label class="text-sm font-semibold text-foreground">
                      Finance Escalation Threshold (% Over Ceiling)
                    </Label>
                    <Badge variant="secondary" class="font-mono text-xs">
                      +{{ approvalConfig.financeThresholdPercent }}%
                    </Badge>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    Discounts exceeding category ceilings by more than this percentage automatically require secondary approval from the Finance team.
                  </p>
                  <div class="flex items-center gap-3 pt-2">
                    <Input
                      v-model.number="approvalConfig.financeThresholdPercent"
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      class="max-w-32 font-bold"
                    />
                    <span class="text-xs text-muted-foreground font-medium">% over ceiling</span>
                  </div>
                </div>

                <!-- Policy Toggles -->
                <div class="p-5 rounded-lg border bg-card space-y-4">
                  <h4 class="text-sm font-semibold text-foreground">
                    Governance Policy Options
                  </h4>

                  <div class="space-y-3">
                    <label class="flex items-start gap-3 cursor-pointer">
                      <input
                        v-model="approvalConfig.autoApproveWithinCeilings"
                        type="checkbox"
                        class="mt-1 rounded border-border text-primary focus:ring-primary h-4 w-4"
                      />
                      <div>
                        <p class="text-xs font-semibold text-foreground">Auto-approve within ceilings</p>
                        <p class="text-2xs text-muted-foreground">
                          When checked, quotes within category ceilings bypass manager approval and go straight to customer delivery.
                        </p>
                      </div>
                    </label>

                    <label class="flex items-start gap-3 cursor-pointer">
                      <input
                        v-model="approvalConfig.requireFinanceAboveThreshold"
                        type="checkbox"
                        class="mt-1 rounded border-border text-primary focus:ring-primary h-4 w-4"
                      />
                      <div>
                        <p class="text-xs font-semibold text-foreground">Enable Finance Escalation</p>
                        <p class="text-2xs text-muted-foreground">
                          When checked, extreme discount deviations are forwarded to Finance after Sales Manager sign-off.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- TAB 3: LIVE GOVERNANCE SIMULATOR -->
        <TabsContent value="simulator" class="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle class="text-lg font-semibold flex items-center gap-2">
                <PlayCircle class="w-5 h-5 text-primary" />
                Live Governance Rule Simulator
              </CardTitle>
              <CardDescription>
                Test how a proposed discount for any Customer Tier × Product Category combination will be evaluated and routed under your organization's current rulebook.
              </CardDescription>
            </CardHeader>

            <CardContent class="space-y-6">
              <!-- Simulator Controls -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 rounded-xl bg-muted/40 border">
                <!-- Select Customer Tier -->
                <div class="space-y-1.5">
                  <Label class="text-xs font-semibold">1. Select Customer Tier</Label>
                  <select
                    v-model="simTierId"
                    class="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    @change="runSimulator"
                  >
                    <option v-for="t in tiers" :key="t.id" :value="t.id">
                      {{ t.name }} (Rank {{ t.rank }})
                    </option>
                  </select>
                </div>

                <!-- Select Product Category -->
                <div class="space-y-1.5">
                  <Label class="text-xs font-semibold">2. Select Product Category</Label>
                  <select
                    v-model="simCategoryId"
                    class="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    @change="runSimulator"
                  >
                    <option v-for="c in categories" :key="c.id" :value="c.id">
                      {{ c.name }} ({{ c.code }})
                    </option>
                  </select>
                </div>

                <!-- Proposed Discount Input -->
                <div class="space-y-1.5">
                  <Label class="text-xs font-semibold">3. Proposed Line Discount</Label>
                  <div class="flex items-center gap-2">
                    <div class="relative flex-1">
                      <Input
                        v-model.number="simDiscountPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        class="pr-7 font-bold text-sm"
                        @input="runSimulator"
                      />
                      <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-bold">
                        %
                      </span>
                    </div>
                    <Button size="sm" :disabled="evaluating" @click="runSimulator">
                      <Sparkles class="w-4 h-4 mr-1" />
                      Test
                    </Button>
                  </div>
                </div>
              </div>

              <!-- Simulation Output Card -->
              <div v-if="simResult" class="p-6 rounded-xl border shadow-xs space-y-6" :class="{
                'bg-emerald-500/5 border-emerald-500/30': simResult.outcome === 'AUTO_APPROVED',
                'bg-amber-500/5 border-amber-500/30': simResult.outcome === 'MANAGER_ONLY',
                'bg-purple-500/5 border-purple-500/30': simResult.outcome === 'MANAGER_THEN_FINANCE',
              }">
                <!-- Header Status -->
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b">
                  <div>
                    <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Governance Evaluation Outcome
                    </span>
                    <div class="flex items-center gap-2 mt-1">
                      <Badge
                        v-if="simResult.outcome === 'AUTO_APPROVED'"
                        class="bg-emerald-500 text-white text-sm py-1 px-3"
                      >
                        <CheckCircle2 class="w-4 h-4 mr-1.5" />
                        AUTO-APPROVED (NO APPROVAL REQUIRED)
                      </Badge>
                      <Badge
                        v-else-if="simResult.outcome === 'MANAGER_ONLY'"
                        class="bg-amber-500 text-white text-sm py-1 px-3"
                      >
                        <UserCheck class="w-4 h-4 mr-1.5" />
                        SALES MANAGER APPROVAL REQUIRED
                      </Badge>
                      <Badge
                        v-else-if="simResult.outcome === 'MANAGER_THEN_FINANCE'"
                        class="bg-purple-600 text-white text-sm py-1 px-3"
                      >
                        <ShieldAlert class="w-4 h-4 mr-1.5" />
                        SALES MANAGER + FINANCE ESCALATION REQUIRED
                      </Badge>
                    </div>
                  </div>

                  <!-- Quick Stats -->
                  <div class="flex items-center gap-4 text-xs font-medium">
                    <div>
                      <span class="text-muted-foreground">Allowed Ceiling:</span>
                      <strong class="ml-1 text-foreground">{{ simResult.maxDiscountPercent }}%</strong>
                    </div>
                    <div>
                      <span class="text-muted-foreground">Proposed:</span>
                      <strong class="ml-1 text-foreground">{{ simResult.proposedDiscountPercent }}%</strong>
                    </div>
                    <div>
                      <span class="text-muted-foreground">Ceiling Delta:</span>
                      <strong
                        class="ml-1"
                        :class="simResult.discountDelta > 0 ? 'text-destructive font-bold' : 'text-emerald-600 font-bold'"
                      >
                        {{ simResult.discountDelta > 0 ? `+${simResult.discountDelta}%` : `${simResult.discountDelta}%` }}
                      </strong>
                    </div>
                  </div>
                </div>

                <!-- Explanation Reason -->
                <div class="space-y-1">
                  <p class="text-xs font-semibold text-muted-foreground uppercase">System Evaluation Rationale:</p>
                  <p class="text-sm font-medium text-foreground leading-relaxed">
                    {{ simResult.reason }}
                  </p>
                </div>

                <!-- Visual Route Flow -->
                <div class="flex items-center gap-3 pt-2 text-xs">
                  <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-card border font-semibold">
                    <span>1. Sales Rep Quote</span>
                  </div>
                  <ArrowRight class="w-4 h-4 text-muted-foreground" />
                  <div
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-semibold"
                    :class="simResult.requiresManager ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' : 'bg-muted/40 text-muted-foreground border-transparent opacity-60'"
                  >
                    <span>2. Sales Manager Review</span>
                  </div>
                  <ArrowRight class="w-4 h-4 text-muted-foreground" />
                  <div
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-semibold"
                    :class="simResult.requiresFinance ? 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30' : 'bg-muted/40 text-muted-foreground border-transparent opacity-60'"
                  >
                    <span>3. Finance Approval Gate</span>
                  </div>
                  <ArrowRight class="w-4 h-4 text-muted-foreground" />
                  <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-semibold">
                    <span>4. Customer Delivery</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  </WorkspaceLayout>
</template>
