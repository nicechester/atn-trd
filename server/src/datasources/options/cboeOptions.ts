/**
 * CBOE delayed-quotes fallback for the options connector (doc 02).
 *
 * Yahoo's option endpoint sits behind the cookie/crumb flow and is frequently
 * throttled; CBOE publishes the same chain as a plain, key-less JSON document.
 * The payload is large (~1.5MB, every expiry at once), so it is only used when
 * Yahoo fails, and it is filtered down to a single expiry immediately.
 */

import { HttpClient, HttpError } from '../http.js';
import { SymbolNotFoundError, UpstreamError } from '../../lib/errors.js';
import { startOfUtcDay } from './optionsCalendar.js';
import type { RawOptionChain, YahooOptionContractRaw } from './yahooOptions.js';

export const CBOE_OPTIONS_SOURCE = 'cboe-options';
export const CBOE_BASE_URL = 'https://cdn.cboe.com/api/global/delayed_quotes/options/';

export interface CboeContractRaw {
  /** OSI symbol, e.g. "AAPL260821C00225000". */
  option?: string;
  bid?: number;
  ask?: number;
  iv?: number;
  open_interest?: number;
  volume?: number;
  last_trade_price?: number;
}

export interface CboeOptionsResponse {
  timestamp?: string;
  symbol?: string;
  data?: {
    symbol?: string;
    options?: CboeContractRaw[];
    current_price?: number;
    close?: number;
    prev_day_close?: number;
  };
}

export interface ParsedOsiSymbol {
  root: string;
  /** Expiration at UTC midnight, epoch ms. */
  expiration: number;
  type: 'call' | 'put';
  strike: number;
}

/** OSI: <root><YYMMDD><C|P><strike * 1000, 8 digits>. */
const OSI_PATTERN = /^(.+?)(\d{6})([CP])(\d{8})$/;

export function parseOsiSymbol(symbol: string): ParsedOsiSymbol | null {
  const match = OSI_PATTERN.exec(symbol.trim().toUpperCase());
  if (!match) return null;
  const [, root, yymmdd, type, strikeDigits] = match;
  const year = 2000 + Number(yymmdd!.slice(0, 2));
  const month = Number(yymmdd!.slice(2, 4));
  const day = Number(yymmdd!.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const strike = Number(strikeDigits) / 1000;
  if (!Number.isFinite(strike)) return null;
  return {
    root: root!,
    expiration: Date.UTC(year, month - 1, day),
    type: type === 'C' ? 'call' : 'put',
    strike,
  };
}

function toContract(
  raw: CboeContractRaw,
  parsed: ParsedOsiSymbol,
  underlyingPrice: number | null
): YahooOptionContractRaw {
  const inTheMoney =
    underlyingPrice === null
      ? undefined
      : parsed.type === 'call'
        ? parsed.strike < underlyingPrice
        : parsed.strike > underlyingPrice;

  return {
    contractSymbol: raw.option ?? '',
    strike: parsed.strike,
    lastPrice: raw.last_trade_price,
    bid: raw.bid,
    ask: raw.ask,
    volume: raw.volume,
    openInterest: raw.open_interest,
    impliedVolatility: raw.iv,
    ...(inTheMoney === undefined ? {} : { inTheMoney }),
    expiration: parsed.expiration,
  };
}

/**
 * Reshape the CBOE document into the same intermediate chain the Yahoo path
 * produces, keeping a single normalization routine in the connector.
 */
export function toChain(
  body: CboeOptionsResponse,
  symbol: string,
  options: { expiration?: number; now: number }
): RawOptionChain {
  const contracts = Array.isArray(body.data?.options) ? body.data!.options! : [];
  const underlyingPrice = body.data?.current_price ?? body.data?.close ?? null;

  const parsed = contracts
    .map((raw) => {
      const osi = raw.option ? parseOsiSymbol(raw.option) : null;
      return osi ? { raw, osi } : null;
    })
    .filter((entry): entry is { raw: CboeContractRaw; osi: ParsedOsiSymbol } => entry !== null);

  const expirationDates = [...new Set(parsed.map((entry) => entry.osi.expiration))].sort(
    (a, b) => a - b
  );

  const today = startOfUtcDay(options.now);
  const target =
    options.expiration !== undefined
      ? // Snap to the closest listed expiry so callers need not match exactly.
        expirationDates.reduce<number | null>(
          (best, date) =>
            best === null ||
            Math.abs(date - options.expiration!) < Math.abs(best - options.expiration!)
              ? date
              : best,
          null
        )
      : (expirationDates.find((date) => date >= today) ?? expirationDates[0] ?? null);

  const selected = parsed.filter((entry) => entry.osi.expiration === target);

  return {
    underlyingSymbol: body.data?.symbol ?? body.symbol ?? symbol,
    expirationDates,
    ...(underlyingPrice === null ? {} : { quote: { regularMarketPrice: underlyingPrice } }),
    options: [
      {
        ...(target === null ? {} : { expirationDate: target }),
        calls: selected
          .filter((entry) => entry.osi.type === 'call')
          .map((entry) => toContract(entry.raw, entry.osi, underlyingPrice)),
        puts: selected
          .filter((entry) => entry.osi.type === 'put')
          .map((entry) => toContract(entry.raw, entry.osi, underlyingPrice)),
      },
    ],
  };
}

export function createCboeHttpClient(): HttpClient {
  return new HttpClient({
    name: CBOE_OPTIONS_SOURCE,
    baseUrl: CBOE_BASE_URL,
    defaultHeaders: { 'user-agent': 'atn-trd/0.1.0', accept: 'application/json' },
    rateLimit: { capacity: 2, refillPerSecond: 0.5 },
    // The payload is multi-megabyte; give it room beyond the default 10s.
    timeoutMs: 20_000,
    retry: { retries: 1, baseDelayMs: 500, maxDelayMs: 4000 },
  });
}

export async function fetchCboeChain(
  http: HttpClient,
  symbol: string,
  options: { expiration?: number; now: number; signal?: AbortSignal }
): Promise<RawOptionChain> {
  let body: CboeOptionsResponse;
  try {
    body = await http.json<CboeOptionsResponse>(`${encodeURIComponent(symbol)}.json`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) {
      // CBOE serves a static file per symbol; a miss means it has no listed chain.
      throw new SymbolNotFoundError(symbol);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(`Could not reach CBOE for "${symbol}" options: ${message}`, CBOE_OPTIONS_SOURCE);
  }

  if (!Array.isArray(body.data?.options)) {
    throw new SymbolNotFoundError(symbol);
  }
  return toChain(body, symbol, {
    ...(options.expiration === undefined ? {} : { expiration: options.expiration }),
    now: options.now,
  });
}
