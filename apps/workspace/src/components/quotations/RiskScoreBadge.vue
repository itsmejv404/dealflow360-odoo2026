<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert, AlertOctagon, Info } from 'lucide-vue-next';

interface LineRiskInfo {
  productId: string;
  categoryName: string;
  lineDiscountPercent: number;
  effectiveDiscountPercent: number;
  categoryCeilingPercent: number;
  riskDeltaPercent: number;
  isOverCeiling: boolean;
  reason: string;
}

interface RiskProps {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  approvalRouting: 'none' | 'manager' | 'manager_finance';
  routingReason?: string;
  hasLineOverCeiling?: boolean;
  overCeilingLineCount?: number;
  totalLines?: number;
  lines?: LineRiskInfo[];
}

const props = withDefaults(defineProps<RiskProps>(), {
  riskScore: 0,
  riskLevel: 'low',
  approvalRouting: 'none',
  routingReason: 'All lines comply with rulebook ceilings.',
  hasLineOverCeiling: false,
  overCeilingLineCount: 0,
  totalLines: 0,
  lines: () => [],
});

// Level and color always derive from riskLevel alone, so a compliant quote can
// never render high-risk styling regardless of the raw score value.
const isHigh = computed(() => props.riskLevel === 'high');
const isMedium = computed(() => props.riskLevel === 'medium');
const isLow = computed(() => !isHigh.value && !isMedium.value);

const routingBadgeText = computed(() => {
  if (props.approvalRouting === 'manager_finance') return 'Manager + Finance Required';
  if (props.approvalRouting === 'manager') return 'Sales Manager Required';
  return 'Auto-Approved';
});

const containerClass = computed(() => {
  if (isHigh.value) {
    return 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-900 dark:text-red-200';
  }
  if (isMedium.value) {
    return 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200';
  }
  return 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200';
});

const progressColorClass = computed(() => {
  if (isHigh.value) return 'bg-red-600 dark:bg-red-500';
  if (isMedium.value) return 'bg-amber-500 dark:bg-amber-400';
  return 'bg-emerald-500 dark:bg-emerald-400';
});

const badgeVariantClass = computed(() => {
  if (isHigh.value) return 'bg-red-100 dark:bg-red-900/80 text-red-800 dark:text-red-200 border-red-300';
  if (isMedium.value) return 'bg-amber-100 dark:bg-amber-900/80 text-amber-800 dark:text-amber-200 border-amber-300';
  return 'bg-emerald-100 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200 border-emerald-300';
});
</script>

<template>
  <div :class="['rounded-lg border p-3.5 space-y-3 transition-colors', containerClass]">
    <!-- Top header with Score & Badge -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <component
          :is="isHigh ? AlertOctagon : isMedium ? ShieldAlert : ShieldCheck"
          class="w-4 h-4 shrink-0"
        />
        <span class="font-semibold text-xs tracking-tight">
          Discount Risk Score
        </span>
      </div>
      <Badge variant="outline" :class="['text-3xs font-bold uppercase tracking-wider', badgeVariantClass]">
        {{ routingBadgeText }}
      </Badge>
    </div>

    <!-- Progress / Meter -->
    <div class="space-y-1">
      <div class="flex items-center justify-between text-2xs">
        <span class="text-muted-foreground font-medium">Risk Score:</span>
        <span class="font-bold text-xs">{{ Number(riskScore).toFixed(1) }} / 100</span>
      </div>
      <div class="h-2 w-full bg-muted/60 dark:bg-muted/30 rounded-full overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-300"
          :class="progressColorClass"
          :style="{ width: `${Math.min(100, Math.max(0, riskScore))}%` }"
        ></div>
      </div>
      <div class="flex justify-between text-3xs text-muted-foreground pt-0.5">
        <span>Low</span>
        <span>Medium</span>
        <span>High</span>
      </div>
    </div>

    <!-- Routing Rationale -->
    <div class="text-2xs leading-relaxed opacity-90 border-t border-current/10 pt-2 flex items-start gap-1.5">
      <Info class="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-70" />
      <span>{{ routingReason }}</span>
    </div>

    <!-- Detailed line breaches if any -->
    <div v-if="overCeilingLineCount && overCeilingLineCount > 0" class="space-y-1.5 pt-1">
      <div class="text-3xs uppercase font-bold tracking-wider opacity-75">
        Lines Above Ceiling ({{ overCeilingLineCount }}):
      </div>
      <div class="space-y-1 max-h-28 overflow-y-auto pr-1">
        <div
          v-for="(l, idx) in lines.filter(x => x.isOverCeiling)"
          :key="idx"
          class="text-3xs p-1.5 rounded bg-background/60 dark:bg-background/40 border border-current/10 space-y-0.5"
        >
          <div class="font-semibold flex items-center justify-between">
            <span>{{ l.categoryName }} Line</span>
            <span class="font-bold text-destructive">+{{ Number(l.riskDeltaPercent).toFixed(1) }}% over ceiling</span>
          </div>
          <div class="text-muted-foreground">
            Effective Disc: {{ Number(l.effectiveDiscountPercent).toFixed(1) }}% (Ceiling: {{ Number(l.categoryCeilingPercent).toFixed(1) }}%)
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
