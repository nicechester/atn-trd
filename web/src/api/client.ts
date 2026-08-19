import type { GetSettingsResponse, PatchSettingsRequest, GetSecretsResponse, ValidateSymbolResponse } from '@shared/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `/api${path}`;
  const headers = new Headers(init?.headers);

  if (init?.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    throw new ApiError(response.status, body, `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// Health
interface HealthShape {
  version: string;
  migrationVersion: number | null;
  db: { path: string; size: number } | null;
  encKeyPresent: boolean;
  uptime: number;
}

export const health = {
  get(): Promise<HealthShape> {
    return request<HealthShape>('/health');
  },
};

// Settings
export const settings = {
  get(): Promise<GetSettingsResponse> {
    return request<GetSettingsResponse>('/settings');
  },
  patch(body: PatchSettingsRequest): Promise<GetSettingsResponse> {
    return request<GetSettingsResponse>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
};

// Secrets
export const secrets = {
  list(): Promise<GetSecretsResponse> {
    return request<GetSecretsResponse>('/secrets');
  },
  set(name: string, value: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/secrets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  },
  clear(name: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/secrets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },
};

// Symbols
export const symbols = {
  validate(symbol: string): Promise<ValidateSymbolResponse> {
    return request<ValidateSymbolResponse>('/symbols/validate', {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    });
  },
};

// Watchlist
interface WatchlistRow {
  symbol: string;
  enabled: boolean;
  addedAt: number | null;
  note: string | null;
}

interface WatchlistAddRow extends WatchlistRow {
  name: string;
  price: number;
  currency: string;
}

export const watchlist = {
  list(): Promise<{ ok: boolean; data: WatchlistRow[] }> {
    return request<{ ok: boolean; data: WatchlistRow[] }>('/watchlist');
  },
  add(symbol: string, note?: string): Promise<{ ok: boolean; data: WatchlistAddRow }> {
    const body: { symbol: string; note?: string } = { symbol };
    if (note !== undefined) {
      body.note = note;
    }
    return request<{ ok: boolean; data: WatchlistAddRow }>('/watchlist', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  remove(symbol: string): Promise<{ ok: boolean; data: { symbol: string } }> {
    return request<{ ok: boolean; data: { symbol: string } }>(`/watchlist/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
    });
  },
  patch(symbol: string, enabled: boolean): Promise<{ ok: boolean; data: WatchlistRow }> {
    return request<{ ok: boolean; data: WatchlistRow }>(`/watchlist/${encodeURIComponent(symbol)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  },
};

// LLM
interface LlmTestResult {
  ok: boolean;
  data?: {
    model: string;
    response: string;
    latency: number;
    tokens?: { inputTokens: number; outputTokens: number; totalTokens?: number };
  };
  error?: string;
}

export const llm = {
  test(prompt?: string): Promise<LlmTestResult> {
    const body: { prompt?: string } = {};
    if (prompt !== undefined) {
      body.prompt = prompt;
    }
    return request<LlmTestResult>('/llm/test', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};

// Data Sources
interface DataSourceEntry {
  id: string;
  name: string;
  provider: string;
  configured: boolean;
  enabled: boolean;
}

interface DataSourceTestResult {
  ok: boolean;
  id: string;
  name?: string;
  provider?: string;
  configured?: boolean;
  detail?: string;
  latencyMs?: number | null;
  checkedAt?: number;
}

export const datasources = {
  list(): Promise<{ ok: boolean; data: DataSourceEntry[] }> {
    return request<{ ok: boolean; data: DataSourceEntry[] }>('/datasources');
  },
  test(id: string): Promise<DataSourceTestResult> {
    return request<DataSourceTestResult>(`/datasources/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    });
  },
};

// Scheduler
export const scheduler = {
  nextRuns(n?: number): Promise<{ nextRuns: string[] }> {
    let path = '/scheduler/next-runs';
    if (n !== undefined) {
      path += `?n=${n}`;
    }
    return request<{ nextRuns: string[] }>(path);
  },
};

// Unified API object
export const api = { health, settings, secrets, symbols, watchlist, llm, datasources, scheduler };
