/**
 * Notification Service
 *
 * Sends notifications to Discord/Slack webhooks for trading system events.
 * Helps with the psychological aspect of "most days: no action".
 */
import type { Settings } from '@atn-trd/shared';
export type NotificationType = 'WAITING' | 'PAUSED' | 'EXECUTED' | 'CREATED' | 'CANCELLED' | 'REGIME_CHANGE';
export interface NotificationPayload {
    type: NotificationType;
    title: string;
    message: string;
    fields?: Array<{
        name: string;
        value: string;
        inline?: boolean;
    }>;
    color?: number;
}
export interface NotificationServiceDeps {
    getSettings: () => Settings;
    getWebhookUrl: () => string | null;
}
export interface NotificationService {
    notify(payload: NotificationPayload): Promise<boolean>;
    notifyWaiting(symbol: string, reason: string, nextCheckDays?: number): Promise<boolean>;
    notifyPaused(symbol: string, reason: string): Promise<boolean>;
    notifyExecuted(symbol: string, shares: number, priceCents: number, tranche: string): Promise<boolean>;
    notifyRegimeChange(regime: string, streak: number): Promise<boolean>;
}
export declare function createNotificationService(deps: NotificationServiceDeps): NotificationService;
//# sourceMappingURL=notificationService.d.ts.map