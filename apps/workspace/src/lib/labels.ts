/** Human-readable labels for everything the UI previously showed as raw enums. */

export function statusLabel(status: string | undefined | null): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'pending_approval':
      return 'Pending Review';
    case 'approved':
      return 'Approved';
    case 'sent':
      return 'Sent';
    case 'negotiating':
      return 'Under Negotiation';
    case 'confirmed':
      return 'Confirmed';
    case 'rejected':
      return 'Rejected';
    default:
      return status
        ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : 'Unknown';
  }
}

export function roleLabel(role: string | undefined | null): string {
  switch (role) {
    case 'org_admin':
      return 'Org Admin';
    case 'rep':
      return 'Sales Rep';
    case 'manager':
      return 'Sales Manager';
    case 'finance':
      return 'Finance Approver';
    case 'ops':
      return 'Operations';
    case 'super_admin':
      return 'Super Admin';
    default:
      return role ? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'User';
  }
}

export function billingLabel(frequency: string | undefined | null): string {
  switch (frequency) {
    case 'one_time':
      return 'One-time';
    case 'monthly':
      return 'Billed monthly';
    case 'quarterly':
      return 'Billed quarterly';
    case 'annual':
      return 'Billed yearly';
    default:
      return frequency ? frequency.replace(/_/g, ' ') : '';
  }
}

export function fulfillmentStatusLabel(
  status: string | undefined | null
): { label: string; class: string } {
  switch (status) {
    case 'fulfilled':
      return { label: 'Fulfilled', class: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300' };
    case 'ready':
      return { label: 'Ready to ship', class: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200' };
    case 'split':
      return { label: 'Split across warehouses', class: 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 border-blue-200' };
    case 'partial':
      return { label: 'Partially covered', class: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300' };
    case 'backordered':
      return { label: 'Backordered', class: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300' };
    case 'shortfall':
      return { label: 'Not enough stock', class: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-300' };
    default:
      return { label: status ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown', class: 'bg-muted text-muted-foreground border-border' };
  }
}

export function invoiceStatusLabel(status: string | undefined | null): { label: string; class: string } {
  switch (status) {
    case 'paid':
      return { label: 'Paid', class: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300' };
    case 'issued':
      return { label: 'Issued / Due', class: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-300' };
    case 'draft':
      return { label: 'Draft', class: 'bg-muted text-muted-foreground border-border' };
    case 'partially_refunded':
      return { label: 'Partially Refunded', class: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300' };
    case 'refunded':
      return { label: 'Refunded', class: 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-300' };
    case 'void':
      return { label: 'Void', class: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-300' };
    default:
      return { label: status ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown', class: 'bg-muted text-muted-foreground border-border' };
  }
}

export function invoiceTypeLabel(type: string | undefined | null): string {
  switch (type) {
    case 'one_time':
      return 'One-Time Products';
    case 'subscription_cycle':
      return 'Subscription Cycle';
    case 'proration_adjustment':
      return 'Proration Adjustment';
    default:
      return type ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Invoice';
  }
}

