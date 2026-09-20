/**
 * Transactional email.
 *
 * Two things make this safe to depend on:
 *
 *   • **It degrades instead of failing.** With `MAIL_ENABLED=false` the message
 *     is logged rather than sent, so a fresh clone runs with no SMTP account
 *     and a developer can still read the reset link out of the console.
 *
 *   • **It never throws into the caller.** A password reset must succeed from
 *     the user's point of view even if the mail provider is down; the failure
 *     is logged and alertable. The alternative — a 500 on the reset endpoint —
 *     tells an attacker their target's email exists *and* leaves the real user
 *     stuck.
 *
 * Templates are inline rather than in a templating engine. There are eight of
 * them, they change rarely, and a build step for eight strings is not worth the
 * moving part.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { APP_NAME, SECURITY } from '@pawsitive/shared';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('email');

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.MAIL_ENABLED) return null;

  transporter ??= nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_SECURE,
    auth: {
      user: env.MAIL_USER ?? '',
      pass: env.MAIL_PASSWORD ?? '',
    },
    /* Bounded, so a hanging provider cannot tie up a request slot. */
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return transporter;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send, or log if mail is disabled.
 *
 * Returns whether it was actually delivered, so a caller that genuinely needs
 * to know (an admin inviting a colleague) can surface "we could not send the
 * invitation" without the whole request failing.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const mailer = getTransporter();

  if (!mailer) {
    log.info(
      { to: message.to, subject: message.subject, body: message.text },
      'Mail is disabled — logging the message instead of sending it',
    );
    return false;
  }

  try {
    await mailer.sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    log.info({ to: message.to, subject: message.subject }, 'Email sent');
    return true;
  } catch (error) {
    log.error({ err: error, to: message.to, subject: message.subject }, 'Failed to send email');
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Templates                                 */
/* -------------------------------------------------------------------------- */

/**
 * Escape interpolated values.
 *
 * Names and reasons come from user input and land inside HTML. Without this, a
 * display name of `<img onerror=...>` executes in the recipient's mail client.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08);">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-.02em;">🐾 ${APP_NAME}</div>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0f172a;font-weight:650;">${heading}</h1>
          <div style="font-size:15px;line-height:1.6;color:#475569;">${bodyHtml}</div>
        </td></tr>
        ${
          cta
            ? `<tr><td style="padding:24px 32px 8px;">
                 <a href="${cta.url}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:15px;">${esc(cta.label)}</a>
               </td></tr>
               <tr><td style="padding:12px 32px 0;">
                 <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">If the button does not work, paste this into your browser:<br><span style="color:#64748b;word-break:break-all;">${cta.url}</span></p>
               </td></tr>`
            : ''
        }
        <tr><td style="padding:28px 32px 32px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">You are receiving this because you have a ${APP_NAME} account. If this was not you, you can safely ignore it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function passwordResetEmail(to: string, name: string, token: string): EmailMessage {
  const url = `${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const minutes = SECURITY.PASSWORD_RESET_TTL_MINUTES;

  return {
    to,
    subject: `Reset your ${APP_NAME} password`,
    html: layout(
      'Reset your password',
      `<p style="margin:0 0 12px;">Hi ${esc(name)}, we received a request to reset your password.</p>
       <p style="margin:0;">This link expires in <strong>${minutes} minutes</strong> and can be used once.</p>`,
      { label: 'Choose a new password', url },
    ),
    text: `Hi ${name},\n\nReset your ${APP_NAME} password using this link (valid for ${minutes} minutes):\n\n${url}\n\nIf you did not request this, ignore this email — your password will not change.`,
  };
}

export function inviteEmail(
  to: string,
  name: string,
  token: string,
  invitedBy: string,
  role: string,
): EmailMessage {
  const url = `${env.WEB_APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;

  return {
    to,
    subject: `${invitedBy} invited you to ${APP_NAME}`,
    html: layout(
      `You have been invited as a ${esc(role)}`,
      `<p style="margin:0 0 12px;">Hi ${esc(name)}, <strong>${esc(invitedBy)}</strong> has invited you to join ${APP_NAME}.</p>
       <p style="margin:0;">Set a password to activate your account. This invitation expires in <strong>${SECURITY.INVITE_TTL_DAYS} days</strong>.</p>`,
      { label: 'Accept invitation', url },
    ),
    text: `Hi ${name},\n\n${invitedBy} invited you to join ${APP_NAME} as a ${role}.\n\nActivate your account (expires in ${SECURITY.INVITE_TTL_DAYS} days):\n${url}`,
  };
}

export function appointmentConfirmedEmail(
  to: string,
  name: string,
  details: { petName: string; doctorName: string; when: string; reference: string },
): EmailMessage {
  return {
    to,
    subject: `Appointment confirmed — ${details.reference}`,
    html: layout(
      'Your appointment is confirmed',
      `<p style="margin:0 0 16px;">Hi ${esc(name)}, here are the details:</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#334155;">
         <tr><td style="padding:6px 0;color:#94a3b8;width:96px;">Pet</td><td style="padding:6px 0;font-weight:600;">${esc(details.petName)}</td></tr>
         <tr><td style="padding:6px 0;color:#94a3b8;">Doctor</td><td style="padding:6px 0;font-weight:600;">${esc(details.doctorName)}</td></tr>
         <tr><td style="padding:6px 0;color:#94a3b8;">When</td><td style="padding:6px 0;font-weight:600;">${esc(details.when)}</td></tr>
         <tr><td style="padding:6px 0;color:#94a3b8;">Reference</td><td style="padding:6px 0;font-family:ui-monospace,monospace;">${esc(details.reference)}</td></tr>
       </table>`,
      { label: 'View appointment', url: `${env.WEB_APP_URL}/app/appointments` },
    ),
    text: `Hi ${name},\n\nYour appointment is confirmed.\n\nPet: ${details.petName}\nDoctor: ${details.doctorName}\nWhen: ${details.when}\nReference: ${details.reference}`,
  };
}

export function appointmentReminderEmail(
  to: string,
  name: string,
  details: { petName: string; doctorName: string; when: string; hoursUntil: number },
): EmailMessage {
  return {
    to,
    subject: `Reminder: ${details.petName}'s appointment ${details.hoursUntil <= 3 ? 'is soon' : 'is tomorrow'}`,
    html: layout(
      `${esc(details.petName)}'s appointment is coming up`,
      `<p style="margin:0 0 12px;">Hi ${esc(name)}, this is a reminder that <strong>${esc(details.petName)}</strong> is seeing <strong>${esc(details.doctorName)}</strong>.</p>
       <p style="margin:0;font-size:16px;color:#0f172a;"><strong>${esc(details.when)}</strong></p>`,
      { label: 'View appointment', url: `${env.WEB_APP_URL}/app/appointments` },
    ),
    text: `Hi ${name},\n\nReminder: ${details.petName} is seeing ${details.doctorName} at ${details.when}.`,
  };
}

export function appointmentCancelledEmail(
  to: string,
  name: string,
  details: { petName: string; when: string; reason: string },
): EmailMessage {
  return {
    to,
    subject: `Appointment cancelled — ${details.petName}`,
    html: layout(
      'Your appointment was cancelled',
      `<p style="margin:0 0 12px;">Hi ${esc(name)}, the appointment for <strong>${esc(details.petName)}</strong> on ${esc(details.when)} has been cancelled.</p>
       <p style="margin:0;color:#64748b;">Reason: ${esc(details.reason)}</p>`,
      { label: 'Book another time', url: `${env.WEB_APP_URL}/app/appointments/new` },
    ),
    text: `Hi ${name},\n\nThe appointment for ${details.petName} on ${details.when} was cancelled.\nReason: ${details.reason}`,
  };
}

export function vaccinationDueEmail(
  to: string,
  name: string,
  details: { petName: string; vaccineName: string; dueDate: string; isOverdue: boolean },
): EmailMessage {
  return {
    to,
    subject: details.isOverdue
      ? `Overdue: ${details.petName}'s ${details.vaccineName}`
      : `${details.petName}'s ${details.vaccineName} is due soon`,
    html: layout(
      details.isOverdue ? 'A vaccination is overdue' : 'A vaccination is due soon',
      `<p style="margin:0 0 12px;">Hi ${esc(name)}, <strong>${esc(details.petName)}</strong> is due for <strong>${esc(details.vaccineName)}</strong>.</p>
       <p style="margin:0;color:#64748b;">Due ${esc(details.dueDate)}.</p>`,
      { label: 'Book a visit', url: `${env.WEB_APP_URL}/app/appointments/new` },
    ),
    text: `Hi ${name},\n\n${details.petName} is due for ${details.vaccineName} on ${details.dueDate}.`,
  };
}

export function accountSuspendedEmail(to: string, name: string, reason: string): EmailMessage {
  return {
    to,
    subject: `Your ${APP_NAME} account has been suspended`,
    html: layout(
      'Your account has been suspended',
      `<p style="margin:0 0 12px;">Hi ${esc(name)}, your account has been suspended and you will not be able to sign in.</p>
       <p style="margin:0;color:#64748b;">Reason: ${esc(reason)}</p>
       <p style="margin:12px 0 0;">If you believe this is a mistake, please contact your clinic.</p>`,
    ),
    text: `Hi ${name},\n\nYour ${APP_NAME} account has been suspended.\nReason: ${reason}`,
  };
}

export function welcomeEmail(to: string, name: string): EmailMessage {
  return {
    to,
    subject: `Welcome to ${APP_NAME} 🐾`,
    html: layout(
      `Welcome, ${esc(name)}`,
      `<p style="margin:0 0 12px;">Your account is ready. Add your pets and you can book your first appointment in under a minute.</p>`,
      { label: 'Add your first pet', url: `${env.WEB_APP_URL}/app/pets/new` },
    ),
    text: `Welcome to ${APP_NAME}, ${name}! Add your pets to get started: ${env.WEB_APP_URL}/app/pets/new`,
  };
}
