import type { SentMessageInfo } from 'nodemailer';
import { transporter } from './mailer.js';
import { logger } from './logger.js';

export interface SendDealHealthNudgeEmailOptions {
  to: string | string[];
  orgName: string;
  alertTitle: string;
  alertDetail: string;
  alertType: string;
  severity: string;
  quotationNumber?: string;
  quotationId?: string;
  repName?: string;
  escalate?: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: '#64748b',
  medium: '#f59e0b',
  high: '#ef4444',
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  stalled_quote: 'Stalled Quotation',
  discount_anomaly: 'Discount Anomaly',
  delivery_slippage: 'Delivery Slippage',
};

export async function sendDealHealthNudgeEmail({
  to,
  orgName,
  alertTitle,
  alertDetail,
  alertType,
  severity,
  quotationNumber,
  quotationId,
  repName,
  escalate = false,
}: SendDealHealthNudgeEmailOptions): Promise<SentMessageInfo> {
  const typeLabel = ALERT_TYPE_LABELS[alertType] || 'Deal Health Alert';
  const url = quotationId ? `http://localhost/quotations/${quotationId}` : 'http://localhost/';
  const color = SEVERITY_COLORS[severity] || '#64748b';
  const subject = escalate
    ? `[Escalation] ${typeLabel}: ${alertTitle} (${orgName})`
    : `[Nudge] ${typeLabel}: ${alertTitle} (${orgName})`;

  const mailOptions = {
    from: `"${orgName} Deal Health" <no-reply@dealflow360.com>`,
    to,
    subject,
    text: escalate
      ? `Hello,\n\nA deal-health alert has been ESCALATED.\n\nAlert: ${alertTitle}\nType: ${typeLabel}\nSeverity: ${severity.toUpperCase()}\n${quotationNumber ? `Quotation: ${quotationNumber}\n` : ''}${repName ? `Rep: ${repName}\n` : ''}\nDetail:\n${alertDetail}\n\nOpen it here:\n${url}\n\nDealFlow360`
      : `Hello,\n\nThis is a deal-health nudge.\n\nAlert: ${alertTitle}\nType: ${typeLabel}\nSeverity: ${severity.toUpperCase()}\n${quotationNumber ? `Quotation: ${quotationNumber}\n` : ''}${repName ? `Rep: ${repName}\n` : ''}\nDetail:\n${alertDetail}\n\nOpen it here:\n${url}\n\nDealFlow360`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
        <h2 style="color: #0f172a; margin-top: 0;">${escalate ? 'Deal Health Escalation' : 'Deal Health Nudge'}</h2>
        <p style="font-size: 15px;"><strong>${alertTitle}</strong></p>
        <div style="background-color: #f8fafc; border-left: 4px solid ${color}; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <p style="margin: 4px 0;"><strong>Type:</strong> ${typeLabel}</p>
          <p style="margin: 4px 0;"><strong>Severity:</strong> <span style="text-transform: uppercase; font-weight: bold; color: ${color};">${severity}</span></p>
          ${quotationNumber ? `<p style="margin: 4px 0;"><strong>Quotation:</strong> ${quotationNumber}</p>` : ''}
          ${repName ? `<p style="margin: 4px 0;"><strong>Rep:</strong> ${repName}</p>` : ''}
          <p style="margin: 8px 0 0 0; color: #334155;">${alertDetail}</p>
        </div>
        <div style="margin: 24px 0;">
          <a href="${url}" style="background-color: ${escalate ? '#ef4444' : '#2563eb'}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            ${quotationId ? 'Open Quotation' : 'Open Workspace'}
          </a>
        </div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          Automated deal-health monitoring — ${orgName} via DealFlow360.
        </p>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  logger.info({ messageId: info.messageId, to, orgName, alertType, escalate }, 'Dispatched Deal Health nudge/escalation email');
  return info;
}
