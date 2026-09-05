import { authStore } from './auth';

/**
 * Money formatting for the workspace — always uses the organization's own
 * currency (₹, $, €, …) via Intl, never a hardcoded symbol.
 */
export function formatCurrency(
  val: number | string | undefined | null,
  currency?: string
): string {
  const num = Number(val ?? 0);
  const code = currency || authStore.state.organization?.currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${code} ${num.toFixed(2)}`;
  }
}

/**
 * Margin tone: any positive (or break-even) profit margin is green; a loss
 * (below zero) is red.
 */
export function marginTone(marginPercent: number): { bg: string; text: string } {
  if (marginPercent < 0) {
    return {
      bg: 'bg-red-100 dark:bg-red-950/60 border-red-300 dark:border-red-800',
      text: 'text-red-600 dark:text-red-400',
    };
  }
  return {
    bg: 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800',
    text: 'text-emerald-600 dark:text-emerald-400',
  };
}
