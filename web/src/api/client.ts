import type { GetSettingsResponse, PatchSettingsRequest, GetSecretsResponse, ValidateSymbolResponse } from '@atn-trd/shared/api';

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

  console.log(`[API] ${init?.method || 'GET'} ${url}`);

  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    let body: unknown;
    let message = `HTTP ${response.status}`;
    try {
      body = await response.json();
      // Extract error message from backend response
      if (typeof body === 'object' && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        if (typeof bodyObj.message === 'string') {
          message = bodyObj.message;
        } else if (typeof bodyObj.error === 'string') {
          message = bodyObj.error;
        }
      }
    } catch {
      const text = await response.text();
      body = text;
      if (text) message = text;
    }
    console.log(`[API] Error ${response.status}: ${message}`);
    throw new ApiError(response.status, body, message);
  }

  console.log(`[API] Success ${response.status}`);
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
  requiresKey: boolean;
  secretName: string | null;
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

// Runs
export interface AgentRunRow {
  id: string;
  trigger: 'scheduled' | 'manual';
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  startedAt: number;
  finishedAt: number | null;
  model: string | null;
  settingsSnapshot: string;
  error: string | null;
  tokenUsageJson: string | null;
  skipReason: string | null;
}

export interface AssessmentRow {
  id: string;
  runId: string;
  symbol: string;
  score: number;
  confidence: number;
  thesis: string;
  risks: string | null;
  catalysts: string | null;
  evidenceIdsJson: string | null;
  createdAt: number;
}

export interface DecisionRow {
  id: string;
  runId: string;
  symbol: string;
  action: 'buy' | 'sell' | 'hold' | 'trim' | 'add';
  targetWeight: number | null;
  confidence: number;
  rationale: string;
  assessmentId: string | null;
  createdAt: number;
}

export interface RejectionRow {
  id: string;
  runId: string;
  decisionId: string | null;
  symbol: string;
  action: 'buy' | 'sell' | 'hold' | 'trim' | 'add';
  confidence: number;
  targetWeight: number | null;
  reason: string;
  createdAt: number;
}

export interface FillRow {
  id: string;
  orderId: string;
  qty: number;
  priceCents: number;
  feeCents: number;
  filledAt: number;
  barDate: string;
}

export interface OrderWithFills {
  id: string;
  clientOrderId: string;
  decisionId: string | null;
  runId: string | null;
  broker: string;
  brokerOrderId: string | null;
  mode: 'paper' | 'live';
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit';
  limitPriceCents: number | null;
  tif: 'day' | 'gtc';
  status: 'pending' | 'accepted' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired';
  rejectReason: string | null;
  submittedAt: number;
  updatedAt: number;
  fills: FillRow[];
}

export interface AgentMessageRow {
  id: string;
  runId: string;
  symbol: string | null;
  seq: number;
  role: 'system' | 'human' | 'ai' | 'tool';
  content: string;
  toolName: string | null;
  toolArgsJson: string | null;
  toolResultJson: string | null;
  createdAt: number;
}

export interface ResearchArtifactRow {
  id: string;
  runId: string;
  symbol: string | null;
  source: 'news' | 'fundamentals' | 'macro' | 'options' | 'prices';
  provider: string;
  fetchedAt: number;
  payloadJson: string;
  summary: string | null;
  citationsJson: string | null;
}

export interface CoverageCellData {
  source: 'news' | 'fundamentals' | 'macro' | 'options' | 'prices';
  status: 'ok' | 'error' | 'missing';
  provider?: string;
  fetchedAt?: number;
  error?: string;
}

export interface CoverageRowData {
  symbol: string;
  coveragePercent: number;
  cells: CoverageCellData[];
}

export interface SourceSummaryData {
  source: 'news' | 'fundamentals' | 'macro' | 'options' | 'prices';
  okCount: number;
  errorCount: number;
  missingCount: number;
  coveragePercent: number;
}

export interface RunCoverageData {
  runId: string;
  thresholdPercent: number;
  overallCoveragePercent: number;
  belowThreshold: boolean;
  sources: readonly ('news' | 'fundamentals' | 'macro' | 'options' | 'prices')[];
  symbols: string[];
  matrix: CoverageRowData[];
  sourceSummary: SourceSummaryData[];
}

export interface RunDetailData {
  run: AgentRunRow;
  assessments: AssessmentRow[];
  decisions: DecisionRow[];
  orders: OrderWithFills[];
  rejections: RejectionRow[];
  messages: AgentMessageRow[];
  artifacts: ResearchArtifactRow[];
}

export interface PositionDetail {
  symbol: string;
  qty: number;
  avgCostCents: number;
  currentPriceCents: number;
  costBasisCents: number;
  marketValueCents: number;
  weightPercent: number;
  unrealizedPnlCents: number;
  realizedPnlCents: number;
}

export interface Portfolio {
  asOfDate: string;
  cashCents: number;
  positionsValueCents: number;
  totalValueCents: number;
  totalUnrealizedPnlCents: number;
  totalRealizedPnlCents: number;
  totalPnlCents: number;
  totalReturnPercent: number;
  positions: PositionDetail[];
}

export interface PortfolioSnapshotRow {
  id: string;
  asOfDate: string;
  cashCents: number;
  positionsValueCents: number;
  totalValueCents: number;
  unrealizedPnlCents: number;
  weightsJson: string | null;
  createdAt: number;
}

export interface FillWithOrder extends FillRow {
  symbol: string;
  side: 'buy' | 'sell';
  mode: 'paper' | 'live';
}

export const runs = {
  list(limit = 50, offset = 0): Promise<{ ok: boolean; data: AgentRunRow[] }> {
    return request(`/runs?limit=${limit}&offset=${offset}`);
  },
  get(id: string): Promise<{ ok: boolean; data: RunDetailData }> {
    return request(`/runs/${encodeURIComponent(id)}`);
  },
  getCoverage(id: string): Promise<{ ok: boolean; data: RunCoverageData }> {
    return request(`/runs/${encodeURIComponent(id)}/coverage`);
  },
  trigger(): Promise<{ ok: boolean; runId: string }> {
    return request('/runs', { method: 'POST', body: JSON.stringify({}) });
  },
  cancel(id: string): Promise<{ ok: boolean }> {
    return request(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },
};

export const portfolio = {
  get(): Promise<{ ok: boolean; data: Portfolio }> {
    return request('/portfolio');
  },
  history(limit = 30): Promise<{ ok: boolean; data: PortfolioSnapshotRow[] }> {
    return request(`/portfolio/history?limit=${limit}`);
  },
  transfer(amountCents: number, type: 'deposit' | 'withdraw'): Promise<{ ok: boolean; data: { cashCents: number } }> {
    return request('/portfolio/transfer', {
      method: 'POST',
      body: JSON.stringify({ amountCents, type }),
    });
  },
};

export interface OrderRow {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit';
  limitPriceCents: number | null;
  status: 'pending' | 'accepted' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired';
  submittedAt: number;
  mode: 'paper' | 'live';
}

export const trades = {
  list(limit = 100, offset = 0): Promise<{ ok: boolean; data: FillWithOrder[] }> {
    return request(`/trades?limit=${limit}&offset=${offset}`);
  },
  pending(): Promise<{ ok: boolean; data: OrderRow[] }> {
    return request('/trades/pending');
  },
  cancel(id: string): Promise<{ ok: boolean }> {
    return request(`/trades/pending/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },
  cancelBulk(ids: string[]): Promise<{ ok: boolean; canceled: number }> {
    return request('/trades/pending/cancel-bulk', { method: 'POST', body: JSON.stringify({ ids }) });
  },
  get(id: string): Promise<{ ok: boolean; data: FillRow }> {
    return request(`/trades/${encodeURIComponent(id)}`);
  },
};

// Calibration
export interface CalibrationBand {
  band: string;
  count: number;
  correctCount: number;
  avgReturn5d: number | null;
  avgReturn20d: number | null;
}

export interface CalibrationReport {
  bands: CalibrationBand[];
  totalPending: number;
}

export const calibration = {
  get(): Promise<{ ok: boolean; data: CalibrationReport }> {
    return request<{ ok: boolean; data: CalibrationReport }>('/calibration');
  },
};

// Performance
export interface PerformancePoint {
  date: string;
  strategyReturn: number;
  benchmarkReturn: number;
}

export interface PerformanceMetrics {
  totalStrategyReturn: number;
  totalBenchmarkReturn: number;
  strategyMaxDrawdown: number;
  benchmarkMaxDrawdown: number;
  sharpeRatio?: number;
  series: PerformancePoint[];
}

export const performance = {
  get(fromDate?: string, toDate?: string): Promise<{ ok: boolean; data: PerformanceMetrics }> {
    const params = new URLSearchParams();
    if (fromDate) params.append('fromDate', fromDate);
    if (toDate) params.append('toDate', toDate);
    const qs = params.toString();
    return request<{ ok: boolean; data: PerformanceMetrics }>(`/performance${qs ? '?' + qs : ''}`);
  },
};

// Backtest
export interface BacktestRun {
  id: string;
  name: string | null;
  startDate: string;
  endDate: string;
  symbols: string[];
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface BacktestMetrics {
  totalReturn: number;
  benchmarkReturn: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  totalTrades: number;
  perSymbol: Record<string, { return: number; trades: number }> | null;
}

export interface BacktestEquityPoint {
  date: string;
  value: number;
  benchmark: number | null;
}

export interface BacktestTrade {
  date: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  rationale: string | null;
}

export const backtest = {
  list(): Promise<{ runs: BacktestRun[] }> {
    return request<{ runs: BacktestRun[] }>('/backtest');
  },
  get(id: string): Promise<{ run: BacktestRun; metrics: BacktestMetrics | null; equityCurve?: BacktestEquityPoint[]; trades?: BacktestTrade[] }> {
    return request(`/backtest/${encodeURIComponent(id)}`);
  },
  getEquity(id: string): Promise<{ equityCurve: BacktestEquityPoint[] }> {
    return request(`/backtest/${encodeURIComponent(id)}/equity`);
  },
  getTrades(id: string): Promise<{ trades: BacktestTrade[] }> {
    return request(`/backtest/${encodeURIComponent(id)}/trades`);
  },
  create(config: { name?: string; startDate: string; endDate: string; symbols: string[]; startingCashCents?: number }): Promise<{ backtestId: string }> {
    return request('/backtest', { method: 'POST', body: JSON.stringify(config) });
  },
};

// Unified API object
export const api = { health, settings, secrets, symbols, watchlist, llm, datasources, scheduler, runs, portfolio, trades, calibration, performance, backtest };
