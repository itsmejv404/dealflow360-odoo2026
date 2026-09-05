<script setup lang="ts">
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, marginTone } from '@/lib/currency';
import { billingLabel } from '@/lib/labels';
import {
  Layers,
  TrendingUp,
  Plus,
  Zap,
  Clock,
} from 'lucide-vue-next';

export interface UpsellSuggestionItem {
  productId: string;
  name: string;
  sku: string;
  categoryId: string | null;
  categoryName?: string;
  categoryCode?: string;
  billingFrequency: string;
  unitPrice: number;
  costPrice: number;
  lineDiscountPercent: number;
  lineTotal: number;
  marginAmount: number;
  marginPercent: number;
  reason: string;
  deltaRevenue: number;
  deltaMarginAmount: number;
  projectedQuoteMarginPercent: number;
}

const props = defineProps<{
  suggestions: UpsellSuggestionItem[];
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'add-suggestion', suggestion: UpsellSuggestionItem): void;
}>();

function getCategoryBadgeClass(code?: string) {
  switch (code) {
    case 'hardware':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    case 'services':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
    case 'subscriptions':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}
</script>

<template>
  <Card class="border-border bg-card shadow-xs">
    <CardHeader class="pb-3 border-b border-border/70">
      <div class="flex items-center justify-between">
        <div class="space-y-0.5">
          <CardTitle class="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Layers class="w-4 h-4 text-primary" />
            Similar Products
          </CardTitle>
          <CardDescription class="text-xs">
            More from the same category as your line items — click to add.
          </CardDescription>
        </div>
      </div>
    </CardHeader>

    <CardContent class="p-4 space-y-3">
      <!-- Loading skeleton -->
      <div v-if="isLoading" class="space-y-3 py-2">
        <div v-for="i in 2" :key="i" class="h-24 rounded-lg bg-muted/40 animate-pulse"></div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="suggestions.length === 0"
        class="py-6 text-center text-xs text-muted-foreground space-y-1"
      >
        <Layers class="w-5 h-5 mx-auto text-muted-foreground/60 mb-1" />
        <p>No other products share the category of your current line items.</p>
        <p>Add a line first — similar products from its category appear here.</p>
      </div>

      <!-- Suggestion Cards -->
      <div
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
      >
        <div
          v-for="item in suggestions"
          :key="item.productId"
          class="p-3 rounded-lg border border-border/70 hover:border-primary/40 bg-card hover:bg-muted/10 transition-all flex flex-col justify-between space-y-3 shadow-2xs group"
        >
          <!-- Top row: Name, SKU, Category -->
          <div class="space-y-1.5">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h4 class="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                  {{ item.name }}
                </h4>
                <div class="flex items-center gap-2 mt-0.5">
                  <Badge
                    variant="outline"
                    :class="['text-3xs px-1.5 py-0 font-medium', getCategoryBadgeClass(item.categoryCode)]"
                  >
                    {{ item.categoryName || 'Item' }}
                  </Badge>
                  <span
                    v-if="item.billingFrequency !== 'one_time'"
                    class="text-3xs text-primary font-semibold"
                  >
                    {{ billingLabel(item.billingFrequency) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Reason Pill -->
            <div class="flex items-center gap-1.5 text-3xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-sm">
              <Zap class="w-3 h-3 text-primary shrink-0" />
              <span class="truncate">{{ item.reason }}</span>
            </div>
          </div>

          <!-- Bottom row: Financial Metrics & Action -->
          <div class="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
            <div class="space-y-0.5">
              <div class="flex items-baseline gap-1.5">
                <span class="text-xs font-bold text-foreground">
                  {{ formatCurrency(item.lineTotal) }}
                </span>
                <span v-if="item.lineDiscountPercent > 0" class="text-3xs text-muted-foreground line-through">
                  {{ formatCurrency(item.unitPrice) }}
                </span>
              </div>
              <div class="flex items-center gap-1.5 text-3xs">
                <span
                  class="font-bold flex items-center"
                  :class="marginTone(item.deltaMarginAmount).text"
                >
                  <TrendingUp class="w-2.5 h-2.5 mr-0.5" />
                  {{ item.deltaMarginAmount >= 0 ? '+' : '' }}{{ formatCurrency(item.deltaMarginAmount) }} margin
                </span>
                <span class="text-muted-foreground">({{ Number(item.marginPercent).toFixed(0) }}%)</span>
              </div>
            </div>

            <Button
              size="sm"
              class="h-7 text-xs px-2.5 shadow-xs font-semibold"
              @click="emit('add-suggestion', item)"
            >
              <Plus class="w-3.5 h-3.5 mr-1" />
              Add
            </Button>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
