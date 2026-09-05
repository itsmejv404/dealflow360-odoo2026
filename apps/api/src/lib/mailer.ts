import nodemailer, { type SentMessageInfo } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
  ignoreTLS: true,
});

export interface SendInviteEmailOptions {
  to: string;
  orgName: string;
  inviteToken: string;
  inviteUrl?: string;
}

export async function sendOrgAdminInviteEmail({
  to,
  orgName,
  inviteToken,
  inviteUrl,
}: SendInviteEmailOptions): Promise<SentMessageInfo> {
  const url = inviteUrl || `http://localhost/activate?token=${inviteToken}`;

  const mailOptions = {
    from: '"DealFlow360 Platform" <no-reply@dealflow360.com>',
    to,
    subject: `Invitation to set up ${orgName} on DealFlow360`,
    text: `Hello,\n\nYou have been invited to manage ${orgName} on DealFlow360.\n\nPlease activate your organization account by visiting:\n${url}\n\nActivation Token: ${inviteToken}\n\nBest regards,\nThe DealFlow360 Team`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Welcome to DealFlow360</h2>
        <p>You have been invited as the <strong>Organization Admin</strong> for <strong>${orgName}</strong>.</p>
        <p>Click the button below to complete your onboarding and activate your organization account:</p>
        <div style="margin: 24px 0;">
          <a href="${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Activate Organization
          </a>
        </div>
        <p style="font-size: 13px; color: #64748b;">
          Or copy and paste this link into your browser:<br />
          <a href="${url}">${url}</a>
        </p>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          Token: <code>${inviteToken}</code>
        </p>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName }, 'Dispatched Org Admin invitation email');
  return info;
}

export interface SendTeamInviteEmailOptions {
  to: string;
  orgName: string;
  role: string;
  inviteToken: string;
  inviteUrl?: string;
}

export async function sendUserInviteEmail({
  to,
  orgName,
  role,
  inviteToken,
  inviteUrl,
}: SendTeamInviteEmailOptions): Promise<SentMessageInfo> {
  const url = inviteUrl || `http://localhost/activate?token=${inviteToken}`;

  const mailOptions = {
    from: `"${orgName} via DealFlow360" <no-reply@dealflow360.com>`,
    to,
    subject: `You've been invited to join ${orgName} on DealFlow360`,
    text: `Hello,\n\nYou have been invited to join ${orgName} on DealFlow360 as ${role}.\n\nPlease activate your account by visiting:\n${url}\n\nActivation Token: ${inviteToken}\n\nBest regards,\nThe DealFlow360 Team`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Join ${orgName} on DealFlow360</h2>
        <p>You have been invited to join <strong>${orgName}</strong> with the role of <strong>${role}</strong>.</p>
        <p>Click the button below to set your password and access your workspace:</p>
        <div style="margin: 24px 0;">
          <a href="${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Accept Invitation
          </a>
        </div>
        <p style="font-size: 13px; color: #64748b;">
          Or copy and paste this link into your browser:<br />
          <a href="${url}">${url}</a>
        </p>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          Token: <code>${inviteToken}</code>
        </p>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName, role }, 'Dispatched Team Member invitation email');
  return info;
}

export interface SendApprovalNotificationEmailOptions {
  to: string | string[];
  orgName: string;
  quotationNumber: string;
  quotationId: string;
  customerName?: string;
  requesterName?: string;
  requesterEmail?: string;
  stage: 'manager' | 'finance';
  riskScore: number;
  riskLevel: string;
  reason?: string;
  decision?: 'approved' | 'rejected';
}

export async function sendApprovalRequestedEmail({
  to,
  orgName,
  quotationNumber,
  quotationId,
  customerName,
  requesterName,
  requesterEmail,
  stage,
  riskScore,
  riskLevel,
}: SendApprovalNotificationEmailOptions): Promise<SentMessageInfo> {
  const url = `http://localhost/quotations/${quotationId}`;
  const stageTitle = stage === 'finance' ? 'Finance Escalation' : 'Sales Manager Review';
  const roleLabel = stage === 'finance' ? 'Finance Approver' : 'Sales Manager';

  const mailOptions = {
    from: `"${orgName} Approvals" <no-reply@dealflow360.com>`,
    to,
    subject: `[Action Required] Quotation ${quotationNumber} requires ${stageTitle} (${orgName})`,
    text: `Hello,\n\nQuotation ${quotationNumber} for customer "${customerName || 'N/A'}" has been submitted for ${stageTitle}.\n\nRequested by: ${requesterName || requesterEmail || 'Sales Rep'}\nRisk Score: ${riskScore}/100 (${riskLevel.toUpperCase()})\n\nPlease review and approve/reject here:\n${url}\n\nDealFlow360`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
        <h2 style="color: #0f172a; margin-top: 0;">${stageTitle} Required</h2>
        <p>Quotation <strong>${quotationNumber}</strong> has entered the approval workflow for <strong>${orgName}</strong>.</p>
        <div style="background-color: #f8fafc; border-left: 4px solid ${riskLevel === 'high' ? '#ef4444' : '#f59e0b'}; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <p style="margin: 4px 0;"><strong>Customer:</strong> ${customerName || 'N/A'}</p>
          <p style="margin: 4px 0;"><strong>Requested By:</strong> ${requesterName || requesterEmail || 'Sales Rep'}</p>
          <p style="margin: 4px 0;"><strong>Blended Risk Score:</strong> ${riskScore}/100 (<span style="text-transform: uppercase; font-weight: bold; color: ${riskLevel === 'high' ? '#ef4444' : '#d97706'};">${riskLevel}</span>)</p>
          <p style="margin: 4px 0;"><strong>Target Stage:</strong> ${roleLabel}</p>
        </div>
        <div style="margin: 24px 0;">
          <a href="${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Review Quotation
          </a>
        </div>
        <p style="font-size: 13px; color: #64748b;">
          Link: <a href="${url}">${url}</a>
        </p>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName, quotationNumber, stage }, 'Dispatched Approval Request email');
  return info;
}

export async function sendApprovalDecisionEmail({
  to,
  orgName,
  quotationNumber,
  quotationId,
  decision,
  reason,
  requesterName,
}: SendApprovalNotificationEmailOptions): Promise<SentMessageInfo> {
  const url = `http://localhost/quotations/${quotationId}`;
  const isApproved = decision === 'approved';
  const badgeColor = isApproved ? '#10b981' : '#ef4444';
  const statusLabel = isApproved ? 'APPROVED' : 'REJECTED';

  const mailOptions = {
    from: `"${orgName} Approvals" <no-reply@dealflow360.com>`,
    to,
    subject: `Quotation ${quotationNumber} has been ${statusLabel} (${orgName})`,
    text: `Hello ${requesterName || 'Sales Rep'},\n\nYour quotation ${quotationNumber} has been ${statusLabel}.\n\nReason recorded:\n"${reason || 'No reason provided'}"\n\nView quotation: ${url}\n\nDealFlow360`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
        <h2 style="color: #0f172a; margin-top: 0;">Quotation Decision Rendered</h2>
        <p>Quotation <strong>${quotationNumber}</strong> has been updated to <strong style="color: ${badgeColor};">${statusLabel}</strong>.</p>
        <div style="background-color: #f8fafc; border-left: 4px solid ${badgeColor}; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <p style="margin: 4px 0;"><strong>Decision:</strong> <span style="font-weight: bold; color: ${badgeColor};">${statusLabel}</span></p>
          <p style="margin: 4px 0;"><strong>Recorded Reason:</strong></p>
          <p style="margin: 4px 0; font-style: italic; color: #334155;">"${reason || 'No additional reason provided'}"</p>
        </div>
        <div style="margin: 24px 0;">
          <a href="${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Open Quotation
          </a>
        </div>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName, quotationNumber, decision }, 'Dispatched Approval Decision email');
  return info;
}

export interface SendMagicLinkEmailOptions {
  to: string;
  customerName: string;
  orgName: string;
  orgLogoUrl?: string | null;
  quotationNumber: string;
  quotationTitle: string;
  grandTotal: number;
  currency?: string;
  magicToken: string;
  magicUrl?: string;
}

export async function sendQuotationMagicLinkEmail({
  to,
  customerName,
  orgName,
  quotationNumber,
  quotationTitle,
  grandTotal,
  currency = 'USD',
  magicToken,
  magicUrl,
}: SendMagicLinkEmailOptions): Promise<SentMessageInfo> {
  const url = magicUrl || `${env.PORTAL_URL}/portal/access?token=${magicToken}`;
  const formattedTotal = `$${grandTotal.toFixed(2)} ${currency}`;

  const mailOptions = {
    from: `"${orgName}" <no-reply@dealflow360.com>`,
    to,
    subject: `Your quotation ${quotationNumber} from ${orgName} is ready`,
    text: `Hello ${customerName},\n\nYour quotation ${quotationNumber} ("${quotationTitle}") is ready for your review.\n\nTotal: ${formattedTotal}\n\nYou can access your customer portal here:\n${url}\n\nBest regards,\n${orgName}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; background-color: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">Quotation Ready for Review</h2>
        <p>Dear <strong>${customerName}</strong>,</p>
        <p>We are pleased to present your proposal <strong>${quotationNumber}</strong> (<em>${quotationTitle}</em>) from <strong>${orgName}</strong>.</p>
        
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #64748b; font-size: 13px;">Quotation Number:</span>
            <strong style="color: #0f172a; font-family: monospace;">${quotationNumber}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #64748b; font-size: 13px;">Total Amount:</span>
            <strong style="color: #059669; font-size: 16px;">${formattedTotal}</strong>
          </div>
        </div>

        <p>Click the secure link below to open your personalized customer portal to review line items, pricing, and confirm your order:</p>

        <div style="margin: 24px 0; text-align: center;">
          <a href="${url}" style="background-color: #059669; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 14px;">
            View Your Quotation
          </a>
        </div>

        <p style="font-size: 12px; color: #64748b; margin-top: 24px; word-break: break-all;">
          Or open this link directly:<br />
          <a href="${url}" style="color: #059669;">${url}</a>
        </p>

        <div style="margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center;">
          Sent securely by ${orgName} via DealFlow360 Customer Portal.
        </div>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName, quotationNumber }, 'Dispatched Customer Magic Link email');
  return info;
}

// ==================== PHASE 14 — NEGOTIATION NOTIFICATIONS ====================

export interface SendNegotiationActivityEmailOptions {
  to: string | string[];
  orgName: string;
  quotationNumber: string;
  quotationId: string;
  customerName?: string;
  activity: 'counter' | 'change_request' | 'comment';
  actorName: string;
  actorEmail?: string;
  note?: string;
  proposedDiscountPercent?: number;
}

const ACTIVITY_LABELS: Record<SendNegotiationActivityEmailOptions['activity'], string> = {
  counter: 'Counter-Discount Proposal',
  change_request: 'Change Request',
  comment: 'New Comment',
};

export async function sendNegotiationActivityEmail({
  to,
  orgName,
  quotationNumber,
  quotationId,
  customerName,
  activity,
  actorName,
  actorEmail,
  note,
  proposedDiscountPercent,
}: SendNegotiationActivityEmailOptions): Promise<SentMessageInfo> {
  const url = `${env.PORTAL_URL}/quotations/${quotationId}`;
  const label = ACTIVITY_LABELS[activity];

  const detailLines: string[] = [];
  if (activity === 'counter' && proposedDiscountPercent !== undefined) {
    detailLines.push(`Proposed discount: ${proposedDiscountPercent}%`);
  }
  if (note) {
    detailLines.push(`Note: "${note}"`);
  }

  const mailOptions = {
    from: `"${orgName} Negotiations" <no-reply@dealflow360.com>`,
    to,
    subject: `[Customer Activity] ${label} on quotation ${quotationNumber} (${orgName})`,
    text: `Hello,\n\n${actorName || actorEmail || 'The customer'} submitted a ${label.toLowerCase()} on quotation ${quotationNumber} for customer "${customerName || 'N/A'}".\n\n${detailLines.join('\n')}\n\nOpen the quotation to respond:\n${url}\n\nDealFlow360`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
        <h2 style="color: #0f172a; margin-top: 0;">${label}</h2>
        <p>Quotation <strong>${quotationNumber}</strong> has new customer negotiation activity in <strong>${orgName}</strong>.</p>
        <div style="background-color: #f8fafc; border-left: 4px solid #6366f1; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <p style="margin: 4px 0;"><strong>Customer:</strong> ${customerName || 'N/A'}</p>
          <p style="margin: 4px 0;"><strong>From:</strong> ${actorName || actorEmail || 'Customer'}</p>
          ${proposedDiscountPercent !== undefined ? `<p style="margin: 4px 0;"><strong>Proposed Discount:</strong> ${proposedDiscountPercent}%</p>` : ''}
          ${note ? `<p style="margin: 4px 0;"><strong>Note:</strong> <em>"${note}"</em></p>` : ''}
        </div>
        <div style="margin: 24px 0;">
          <a href="${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Open Quotation & Respond
          </a>
        </div>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName, quotationNumber, activity }, 'Dispatched Negotiation Activity email');
  return info;
}

export async function sendQuoteConfirmedEmail({
  to,
  orgName,
  quotationNumber,
  quotationId,
  customerName,
  grandTotal,
  currency = 'USD',
  reenteredApproval = false,
}: {
  to: string | string[];
  orgName: string;
  quotationNumber: string;
  quotationId: string;
  customerName?: string;
  grandTotal?: number;
  currency?: string;
  reenteredApproval?: boolean;
}): Promise<SentMessageInfo> {
  const url = `${env.PORTAL_URL}/quotations/${quotationId}`;
  const formattedTotal = grandTotal !== undefined ? `${grandTotal.toFixed(2)} ${currency}` : 'N/A';

  const subject = reenteredApproval
    ? `[Action Required] Customer confirmed quotation ${quotationNumber} — re-entered approval (${orgName})`
    : `Customer confirmed quotation ${quotationNumber} (${orgName})`;

  const mailOptions = {
    from: `"${orgName} Negotiations" <no-reply@dealflow360.com>`,
    to,
    subject,
    text: reenteredApproval
      ? `Hello,\n\nCustomer ${customerName || 'N/A'} confirmed the terms of quotation ${quotationNumber} (Total: ${formattedTotal}).\n\nThe confirmed terms exceed the organization's discount thresholds, so the quotation has automatically re-entered the Stage 3 approval workflow and is now waiting in the Sales Manager queue.\n\nOpen the quotation:\n${url}\n\nDealFlow360`
      : `Hello,\n\nCustomer ${customerName || 'N/A'} confirmed quotation ${quotationNumber} with a grand total of ${formattedTotal}. The order is confirmed and ready for fulfillment.\n\nOpen the quotation:\n${url}\n\nDealFlow360`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
        <h2 style="color: #0f172a; margin-top: 0;">${reenteredApproval ? 'Confirmed Terms Re-Entered Approval' : 'Quotation Confirmed by Customer'}</h2>
        <p>Quotation <strong>${quotationNumber}</strong> for <strong>${customerName || 'N/A'}</strong> was confirmed from the customer portal (Total: <strong>${formattedTotal}</strong>).</p>
        <div style="background-color: #fffbeb; border-left: 4px solid ${reenteredApproval ? '#f59e0b' : '#10b981'}; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          ${
            reenteredApproval
              ? '<p style="margin: 4px 0;">The confirmed terms exceed the discount thresholds configured in this organization\'s rulebook. The quotation has automatically re-entered <strong>Stage 3 — Approval</strong> and is queued for Sales Manager review.</p>'
              : '<p style="margin: 4px 0;">All terms comply with the discount rulebook. The order is confirmed and ready for fulfillment.</p>'
          }
        </div>
        <div style="margin: 24px 0;">
          <a href="${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            Open Quotation
          </a>
        </div>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName, quotationNumber, reenteredApproval }, 'Dispatched Quote Confirmed email');
  return info;
}



export interface SendPasswordResetEmailOptions {
  to: string;
  name?: string | null;
  resetToken: string;
  resetUrl: string;
  audience?: 'internal' | 'customer';
}

export async function sendPasswordResetEmail({
  to,
  name,
  resetToken,
  resetUrl,
  audience = 'internal',
}: SendPasswordResetEmailOptions): Promise<SentMessageInfo> {
  const mailOptions = {
    from: '"DealFlow360" <no-reply@dealflow360.com>',
    to,
    subject: 'Reset your password',
    text: `Hello ${name || 'there'},

We received a request to reset your password.

Use the link below to choose a new password (valid for 1 hour):
${resetUrl}

Reset Token: ${resetToken}

If you did not request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; background-color: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">Password Reset Requested</h2>
        <p>Hello <strong>${name || 'there'}</strong>,</p>
        <p>We received a request to reset the password for your ${audience === 'customer' ? 'customer portal' : 'DealFlow360'} account.</p>
        <div style="margin: 24px 0; text-align: center;">
          <a href="${resetUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
            Choose a New Password
          </a>
        </div>
        <p style="color: #64748b; font-size: 13px;">This link expires in 1 hour. If you did not request a reset, you can safely ignore this email — your password will not change.</p>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, audience }, 'Dispatched password reset email');
  return info;
}

export interface SendInvoiceEmailOptions {
  to: string;
  customerName: string;
  orgName: string;
  invoiceNumber: string;
  totalAmount: number;
  currency: string;
  dueDate: string;
  invoicePdf: Buffer;
  invoiceUrl?: string;
}

export async function sendInvoiceEmail({
  to,
  customerName,
  orgName,
  invoiceNumber,
  totalAmount,
  currency,
  dueDate,
  invoicePdf,
  invoiceUrl,
}: SendInvoiceEmailOptions): Promise<SentMessageInfo> {
  const formattedTotal = `${currency} ${totalAmount.toFixed(2)}`;
  const mailOptions = {
    from: `"${orgName}" <no-reply@dealflow360.com>`,
    to,
    subject: `Invoice ${invoiceNumber} from ${orgName}`,
    text: `Hello ${customerName},

Please find attached invoice ${invoiceNumber}.

Total: ${formattedTotal}
Due Date: ${dueDate}

Best regards,
${orgName}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; background-color: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">Invoice ${invoiceNumber}</h2>
        <p>Dear <strong>${customerName}</strong>,</p>
        <p>Your invoice from <strong>${orgName}</strong> is attached to this email as a PDF.</p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #64748b; font-size: 13px;">Invoice Number:</span>
            <strong style="color: #0f172a; font-family: monospace;">${invoiceNumber}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #64748b; font-size: 13px;">Total Amount:</span>
            <strong style="color: #059669; font-size: 16px;">${formattedTotal}</strong>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b; font-size: 13px;">Due Date:</span>
            <strong style="color: #0f172a;">${dueDate}</strong>
          </div>
        </div>
        ${invoiceUrl ? `<p style="text-align: center; margin: 24px 0;"><a href="${invoiceUrl}" style="background-color: #059669; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">View Invoice Online</a></p>` : ''}
        <p style="color: #64748b; font-size: 13px;">Thank you for your business.</p>
      </div>
    `,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: invoicePdf,
        contentType: 'application/pdf',
      },
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName, invoiceNumber }, 'Dispatched invoice email with PDF attachment');
  return info;
}
