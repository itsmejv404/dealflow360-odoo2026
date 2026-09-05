<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle2, 
  XCircle, 
  ArrowUpRight, 
  Clock, 
  Sparkles, 
  ShieldAlert, 
  FileText,
  UserCheck
} from 'lucide-vue-next';

export interface AuditLogItem {
  id: string;
  action: string;
  userEmail?: string | null;
  userRole?: string | null;
  reason?: string | null;
  metadata?: any;
  createdAt: string;
}

const props = defineProps<{
  auditLogs: AuditLogItem[];
}>();

function formatTime(isoStr: string) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

function getActionInfo(action: string) {
  switch (action) {
    case 'submitted_for_approval':
      return {
        label: 'Submitted for Review',
        color: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800',
        icon: Clock,
      };
    case 'manager_approved':
      return {
        label: 'Sales Manager Approved',
        color: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800',
        icon: CheckCircle2,
      };
    case 'finance_escalated':
      return {
        label: 'Escalated to Finance',
        color: 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-950/50 dark:text-purple-400 dark:border-purple-800',
        icon: ArrowUpRight,
      };
    case 'finance_approved':
      return {
        label: 'Finance Approved (Binding)',
        color: 'text-emerald-700 bg-emerald-100 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-700',
        icon: ShieldAlert,
      };
    case 'auto_approved':
      return {
        label: 'Auto-Approved (Within Ceilings)',
        color: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800',
        icon: Sparkles,
      };
    case 'rejected':
      return {
        label: 'Quotation Rejected',
        color: 'text-destructive bg-destructive/10 border-destructive/20',
        icon: XCircle,
      };
    case 'created':
      return {
        label: 'Draft Created',
        color: 'text-muted-foreground bg-muted border-border',
        icon: FileText,
      };
    default:
      return {
        label: action.replace(/_/g, ' '),
        color: 'text-muted-foreground bg-muted border-border',
        icon: UserCheck,
      };
  }
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="!auditLogs || auditLogs.length === 0" class="text-center py-6 text-sm text-muted-foreground">
      No audit records found for this quotation yet.
    </div>

    <div v-else class="relative border-l-2 border-border/80 ml-3.5 space-y-6 my-2">
      <div v-for="(log, idx) in auditLogs" :key="log.id || idx" class="relative pl-6 group">
        <!-- Timeline bullet icon -->
        <div
          class="absolute -left-3.5 top-0.5 flex items-center justify-center w-7 h-7 rounded-full border bg-card shadow-xs transition-transform group-hover:scale-110"
          :class="getActionInfo(log.action).color"
        >
          <component :is="getActionInfo(log.action).icon" class="w-3.5 h-3.5" />
        </div>

        <div class="flex flex-col gap-1">
          <!-- Top row: Action name, role badge, timestamp -->
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-foreground">
                {{ getActionInfo(log.action).label }}
              </span>
              <Badge variant="outline" class="text-2xs py-0 uppercase">
                {{ log.userRole || 'system' }}
              </Badge>
            </div>
            <span class="text-xs text-muted-foreground font-mono">
              {{ formatTime(log.createdAt) }}
            </span>
          </div>

          <!-- Actor info -->
          <p class="text-xs text-muted-foreground">
            By: <span class="font-medium text-foreground">{{ log.userEmail || 'System Process' }}</span>
          </p>

          <!-- Mandatory Reason note if present -->
          <div
            v-if="log.reason"
            class="mt-2 p-2.5 rounded-md bg-muted/50 border border-border/60 text-xs text-foreground/90 font-sans"
          >
            <span class="font-semibold text-muted-foreground block mb-0.5">Recorded Reason:</span>
            {{ log.reason }}
          </div>

          <!-- Metadata snapshot preview -->
          <div v-if="log.metadata && Object.keys(log.metadata).length > 0" class="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
            <span v-if="log.metadata.riskScore !== undefined">
              Score: <strong class="text-foreground">{{ log.metadata.riskScore }}/100</strong>
            </span>
            <span v-if="log.metadata.riskLevel">
              Risk: <strong class="text-foreground uppercase">{{ log.metadata.riskLevel }}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
