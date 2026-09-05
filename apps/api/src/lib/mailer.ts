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

