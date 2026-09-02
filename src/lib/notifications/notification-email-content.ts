import "server-only";

import { z } from "zod";

import type { NotificationEmailCommand } from "@/lib/notifications/notification-email-provider";

export const NOTIFICATION_EMAIL_CONTENT_VERSION = "notification-email-content-v1" as const;
const SUBJECT = "עדכון מ-Financial OS";
const MESSAGE = "Financial OS זיהה שינוי פיננסי שדורש את תשומת לבך. יש להיכנס באופן מאובטח לאפליקציה כדי לעיין בפרטים.";
const LINK_LABEL = "כניסה מאובטחת ל-Financial OS";

function secureTarget(applicationOrigin: string): string {
  const target = new URL("/notifications", applicationOrigin);
  if (target.username !== "" || target.password !== "" || target.search !== "" || target.hash !== "") {
    throw new RangeError("The notification target must not contain credentials or parameters.");
  }
  return target.toString();
}

export function buildNotificationEmailCommand(input: Readonly<{
  applicationOrigin: string;
  idempotencyKey: string;
  recipient: string;
  requestId: string;
}>): NotificationEmailCommand {
  const recipient = z.string().email().parse(input.recipient);
  const target = secureTarget(input.applicationOrigin);
  return {
    html: `<div dir="rtl" lang="he"><p>${MESSAGE}</p><p><a href="${target}">${LINK_LABEL}</a></p></div>`,
    idempotencyKey: z.string().min(1).max(256).parse(input.idempotencyKey),
    recipient,
    requestId: z.string().uuid().parse(input.requestId),
    subject: SUBJECT,
    text: `${MESSAGE}\n${target}`,
  };
}

export function assertMinimizedNotificationEmailCommand(command: NotificationEmailCommand): void {
  const textUrl = command.text.split("\n").at(-1);
  if (textUrl === undefined) throw new RangeError("Notification email content is invalid.");
  let expected: NotificationEmailCommand;
  try {
    const target = new URL(textUrl);
    expected = buildNotificationEmailCommand({
      applicationOrigin: target.origin,
      idempotencyKey: command.idempotencyKey,
      recipient: command.recipient,
      requestId: command.requestId,
    });
  } catch {
    throw new RangeError("Notification email content is not an approved minimized template.");
  }
  if (command.subject !== expected.subject || command.text !== expected.text || command.html !== expected.html) {
    throw new RangeError("Notification email content is not an approved minimized template.");
  }
}
