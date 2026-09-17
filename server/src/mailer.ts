import nodemailer from "nodemailer";
import { config } from "./config.js";
import { logger } from "./logger.js";

interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: string }>;
}
export interface DeliveryResult {
  delivered: boolean;
  channel: "email" | "development-log" | "unavailable";
}

const transport = config.SMTP_URL
  ? nodemailer.createTransport(config.SMTP_URL)
  : null;

export async function deliverMail(
  message: MailMessage,
): Promise<DeliveryResult> {
  if (!transport) {
    if (config.NODE_ENV !== "production") {
      logger.info(
        { to: message.to, subject: message.subject, text: message.text },
        "development mail",
      );
      return { delivered: true, channel: "development-log" };
    }
    logger.warn(
      { to: message.to, subject: message.subject },
      "email not delivered because SMTP_URL is not configured",
    );
    return { delivered: false, channel: "unavailable" };
  }
  try {
    await transport.sendMail({
      from: config.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
    });
    return { delivered: true, channel: "email" };
  } catch (error) {
    logger.error(
      { error, to: message.to, subject: message.subject },
      "email delivery failed",
    );
    return { delivered: false, channel: "unavailable" };
  }
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );

export const sendPasswordReset = (input: {
  email: string;
  name: string;
  token: string;
}) => {
  const url = `${config.APP_PUBLIC_URL.replace(/\/$/, "")}/?reset=${encodeURIComponent(input.token)}`;
  return deliverMail({
    to: input.email,
    subject: "Reset your Atlas password",
    text: `Hello ${input.name},\n\nReset your password using this link (valid for 30 minutes):\n${url}\n\nIf you did not request this, ignore this message.`,
    html: `<p>Hello ${escapeHtml(input.name)},</p><p>Use the link below to reset your Atlas password. It is valid for 30 minutes.</p><p><a href="${escapeHtml(url)}">Reset password</a></p><p>If you did not request this, ignore this message.</p>`,
  });
};

export const sendEmployeeInvitation = (input: {
  email: string;
  name: string;
  company: string;
  temporaryPassword: string;
}) => {
  const url = config.APP_PUBLIC_URL.replace(/\/$/, "");
  return deliverMail({
    to: input.email,
    subject: `Your ${input.company} Atlas account`,
    text: `Hello ${input.name},\n\nYour workforce account is ready.\nSign in: ${url}\nEmail: ${input.email}\nTemporary password: ${input.temporaryPassword}\n\nChange this password immediately after signing in.`,
    html: `<p>Hello ${escapeHtml(input.name)},</p><p>Your ${escapeHtml(input.company)} workforce account is ready.</p><p><a href="${escapeHtml(url)}">Sign in to Atlas</a></p><p>Email: <strong>${escapeHtml(input.email)}</strong><br>Temporary password: <strong>${escapeHtml(input.temporaryPassword)}</strong></p><p>Change this password immediately after signing in.</p>`,
  });
};
