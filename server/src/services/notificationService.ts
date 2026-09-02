/**
 * Notification Service
 *
 * Sends notifications to Discord/Slack webhooks for trading system events.
 * Helps with the psychological aspect of "most days: no action".
 */

import { logger } from '../lib/logger.js';
import type { Settings } from '@atn-trd/shared';

const log = logger.child({ component: 'notifications' });

export type NotificationType = 'WAITING' | 'PAUSED' | 'EXECUTED' | 'CREATED' | 'CANCELLED' | 'REGIME_CHANGE';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  message: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  color?: number; // Discord embed color
}

// Discord embed colors
const COLORS = {
  WAITING: 0x808080,    // Gray
  PAUSED: 0xffa500,     // Orange
  EXECUTED: 0x00ff00,   // Green
  CREATED: 0x0099ff,    // Blue
  CANCELLED: 0xff0000,  // Red
  REGIME_CHANGE: 0x9932cc, // Purple
};

/**
 * Send notification to Discord webhook.
 */
async function sendDiscordNotification(webhookUrl: string, payload: NotificationPayload): Promise<boolean> {
  try {
    const embed = {
      title: `[${payload.type}] ${payload.title}`,
      description: payload.message,
      color: payload.color ?? COLORS[payload.type],
      fields: payload.fields?.map(f => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? true,
      })),
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      log.warn('Discord notification failed', { status: response.status });
      return false;
    }

    return true;
  } catch (err) {
    log.warn('Discord notification error', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Send notification to Slack webhook.
 */
async function sendSlackNotification(webhookUrl: string, payload: NotificationPayload): Promise<boolean> {
  try {
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `[${payload.type}] ${payload.title}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: payload.message },
      },
    ];

    if (payload.fields && payload.fields.length > 0) {
      blocks.push({
        type: 'section',
        fields: payload.fields.map(f => ({
          type: 'mrkdwn',
          text: `*${f.name}*\n${f.value}`,
        })),
      } as any);
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      log.warn('Slack notification failed', { status: response.status });
      return false;
    }

    return true;
  } catch (err) {
    log.warn('Slack notification error', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export interface NotificationServiceDeps {
  getSettings: () => Settings;
  getWebhookUrl: () => string | null; // From secrets
}

export interface NotificationService {
  notify(payload: NotificationPayload): Promise<boolean>;
  notifyWaiting(symbol: string, reason: string, nextCheckDays?: number): Promise<boolean>;
  notifyPaused(symbol: string, reason: string): Promise<boolean>;
  notifyExecuted(symbol: string, shares: number, priceCents: number, tranche: string): Promise<boolean>;
  notifyRegimeChange(regime: string, streak: number): Promise<boolean>;
}

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const { getSettings, getWebhookUrl } = deps;

  async function notify(payload: NotificationPayload): Promise<boolean> {
    const settings = getSettings();
    if (!settings.hedging.enabled) return false; // Use hedging.enabled as proxy for notifications

    const webhookUrl = getWebhookUrl();
    if (!webhookUrl) return false;

    // Detect webhook type from URL
    if (webhookUrl.includes('discord.com')) {
      return sendDiscordNotification(webhookUrl, payload);
    } else if (webhookUrl.includes('slack.com') || webhookUrl.includes('hooks.slack.com')) {
      return sendSlackNotification(webhookUrl, payload);
    }

    log.warn('Unknown webhook type', { url: webhookUrl.slice(0, 30) });
    return false;
  }

  return {
    notify,

    async notifyWaiting(symbol: string, reason: string, nextCheckDays?: number): Promise<boolean> {
      return notify({
        type: 'WAITING',
        title: symbol,
        message: reason,
        fields: nextCheckDays ? [{ name: 'Next Check', value: `${nextCheckDays} days` }] : undefined,
      });
    },

    async notifyPaused(symbol: string, reason: string): Promise<boolean> {
      return notify({
        type: 'PAUSED',
        title: `${symbol} plan paused`,
        message: reason,
      });
    },

    async notifyExecuted(symbol: string, shares: number, priceCents: number, tranche: string): Promise<boolean> {
      return notify({
        type: 'EXECUTED',
        title: symbol,
        message: `Executed ${shares} shares @ $${(priceCents / 100).toFixed(2)}`,
        fields: [{ name: 'Tranche', value: tranche }],
      });
    },

    async notifyRegimeChange(regime: string, streak: number): Promise<boolean> {
      return notify({
        type: 'REGIME_CHANGE',
        title: `Regime: ${regime}`,
        message: `Market regime changed to ${regime}`,
        fields: [{ name: 'Streak', value: `${streak} days` }],
      });
    },
  };
}
