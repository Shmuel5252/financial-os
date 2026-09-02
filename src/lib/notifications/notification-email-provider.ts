import "server-only";

export type NotificationEmailCommand = Readonly<{
  html: string;
  idempotencyKey: string;
  recipient: string;
  requestId: string;
  subject: string;
  text: string;
}>;

export type NotificationEmailAcceptance = Readonly<{
  providerMessageId: string;
}>;

export type NotificationEmailDeliveryStatus =
  | "accepted"
  | "delivered"
  | "failed"
  | "unknown";

export interface NotificationEmailProvider {
  getDeliveryStatus(providerMessageId: string): Promise<NotificationEmailDeliveryStatus>;
  send(command: NotificationEmailCommand): Promise<NotificationEmailAcceptance>;
}
