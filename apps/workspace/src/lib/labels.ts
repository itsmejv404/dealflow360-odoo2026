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
