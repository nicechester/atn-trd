import { z } from 'zod';
export declare const AssessmentSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    runId: z.ZodString;
    symbol: z.ZodString;
    score: z.ZodNumber;
    confidence: z.ZodNumber;
    thesis: z.ZodString;
    risks: z.ZodOptional<z.ZodString>;
    catalysts: z.ZodOptional<z.ZodString>;
    evidenceIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    createdAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    runId: string;
    score: number;
    confidence: number;
    thesis: string;
    id?: string | undefined;
    risks?: string | undefined;
    catalysts?: string | undefined;
    evidenceIds?: string[] | undefined;
    createdAt?: number | undefined;
}, {
    symbol: string;
    runId: string;
    score: number;
    confidence: number;
    thesis: string;
    id?: string | undefined;
    risks?: string | undefined;
    catalysts?: string | undefined;
    evidenceIds?: string[] | undefined;
    createdAt?: number | undefined;
}>;
export type Assessment = z.infer<typeof AssessmentSchema>;
export declare const DecisionSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    runId: z.ZodString;
    symbol: z.ZodString;
    action: z.ZodEnum<["buy", "sell", "hold", "trim", "add"]>;
    targetWeight: z.ZodOptional<z.ZodNumber>;
    confidence: z.ZodNumber;
    rationale: z.ZodString;
    assessmentId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    runId: string;
    confidence: number;
    action: "buy" | "sell" | "hold" | "trim" | "add";
    rationale: string;
    id?: string | undefined;
    createdAt?: number | undefined;
    targetWeight?: number | undefined;
    assessmentId?: string | undefined;
}, {
    symbol: string;
    runId: string;
    confidence: number;
    action: "buy" | "sell" | "hold" | "trim" | "add";
    rationale: string;
    id?: string | undefined;
    createdAt?: number | undefined;
    targetWeight?: number | undefined;
    assessmentId?: string | undefined;
}>;
export type Decision = z.infer<typeof DecisionSchema>;
export declare const DecisionSetSchema: z.ZodObject<{
    decisions: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        runId: z.ZodString;
        symbol: z.ZodString;
        action: z.ZodEnum<["buy", "sell", "hold", "trim", "add"]>;
        targetWeight: z.ZodOptional<z.ZodNumber>;
        confidence: z.ZodNumber;
        rationale: z.ZodString;
        assessmentId: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        runId: string;
        confidence: number;
        action: "buy" | "sell" | "hold" | "trim" | "add";
        rationale: string;
        id?: string | undefined;
        createdAt?: number | undefined;
        targetWeight?: number | undefined;
        assessmentId?: string | undefined;
    }, {
        symbol: string;
        runId: string;
        confidence: number;
        action: "buy" | "sell" | "hold" | "trim" | "add";
        rationale: string;
        id?: string | undefined;
        createdAt?: number | undefined;
        targetWeight?: number | undefined;
        assessmentId?: string | undefined;
    }>, "many">;
    timestamp: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    decisions: {
        symbol: string;
        runId: string;
        confidence: number;
        action: "buy" | "sell" | "hold" | "trim" | "add";
        rationale: string;
        id?: string | undefined;
        createdAt?: number | undefined;
        targetWeight?: number | undefined;
        assessmentId?: string | undefined;
    }[];
    timestamp: number;
}, {
    decisions: {
        symbol: string;
        runId: string;
        confidence: number;
        action: "buy" | "sell" | "hold" | "trim" | "add";
        rationale: string;
        id?: string | undefined;
        createdAt?: number | undefined;
        targetWeight?: number | undefined;
        assessmentId?: string | undefined;
    }[];
    timestamp: number;
}>;
export type DecisionSet = z.infer<typeof DecisionSetSchema>;
export declare const OrderSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    clientOrderId: z.ZodString;
    decisionId: z.ZodOptional<z.ZodString>;
    runId: z.ZodOptional<z.ZodString>;
    broker: z.ZodDefault<z.ZodEnum<["paper", "live"]>>;
    brokerOrderId: z.ZodOptional<z.ZodString>;
    symbol: z.ZodString;
    side: z.ZodEnum<["buy", "sell"]>;
    qty: z.ZodNumber;
    type: z.ZodDefault<z.ZodEnum<["market", "limit"]>>;
    limitPriceCents: z.ZodOptional<z.ZodNumber>;
    tif: z.ZodDefault<z.ZodEnum<["day", "gtc"]>>;
    status: z.ZodDefault<z.ZodEnum<["pending", "accepted", "partially_filled", "filled", "canceled", "rejected", "expired"]>>;
    rejectReason: z.ZodOptional<z.ZodString>;
    submittedAt: z.ZodOptional<z.ZodNumber>;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    type: "market" | "limit";
    status: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
    clientOrderId: string;
    broker: "paper" | "live";
    side: "buy" | "sell";
    qty: number;
    tif: "day" | "gtc";
    updatedAt?: number | undefined;
    id?: string | undefined;
    runId?: string | undefined;
    decisionId?: string | undefined;
    brokerOrderId?: string | undefined;
    limitPriceCents?: number | undefined;
    rejectReason?: string | undefined;
    submittedAt?: number | undefined;
}, {
    symbol: string;
    clientOrderId: string;
    side: "buy" | "sell";
    qty: number;
    type?: "market" | "limit" | undefined;
    status?: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired" | undefined;
    updatedAt?: number | undefined;
    id?: string | undefined;
    runId?: string | undefined;
    decisionId?: string | undefined;
    broker?: "paper" | "live" | undefined;
    brokerOrderId?: string | undefined;
    limitPriceCents?: number | undefined;
    tif?: "day" | "gtc" | undefined;
    rejectReason?: string | undefined;
    submittedAt?: number | undefined;
}>;
export type Order = z.infer<typeof OrderSchema>;
export declare const FillSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    orderId: z.ZodString;
    qty: z.ZodNumber;
    priceCents: z.ZodNumber;
    feeCents: z.ZodDefault<z.ZodNumber>;
    filledAt: z.ZodNumber;
    barDate: z.ZodString;
}, "strip", z.ZodTypeAny, {
    qty: number;
    orderId: string;
    priceCents: number;
    feeCents: number;
    filledAt: number;
    barDate: string;
    id?: string | undefined;
}, {
    qty: number;
    orderId: string;
    priceCents: number;
    filledAt: number;
    barDate: string;
    id?: string | undefined;
    feeCents?: number | undefined;
}>;
export type Fill = z.infer<typeof FillSchema>;
export declare const PositionSchema: z.ZodObject<{
    symbol: z.ZodString;
    qty: z.ZodNumber;
    avgCostCents: z.ZodNumber;
    realizedPnlCents: z.ZodNumber;
    openedAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    updatedAt: number;
    qty: number;
    avgCostCents: number;
    realizedPnlCents: number;
    openedAt: number;
}, {
    symbol: string;
    updatedAt: number;
    qty: number;
    avgCostCents: number;
    realizedPnlCents: number;
    openedAt: number;
}>;
export type Position = z.infer<typeof PositionSchema>;
export declare const AgentRunSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    trigger: z.ZodEnum<["scheduled", "manual"]>;
    status: z.ZodDefault<z.ZodEnum<["running", "succeeded", "failed", "skipped"]>>;
    startedAt: z.ZodNumber;
    finishedAt: z.ZodOptional<z.ZodNumber>;
    model: z.ZodOptional<z.ZodString>;
    settingsSnapshot: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    error: z.ZodOptional<z.ZodString>;
    tokenUsage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        inputTokens?: number | undefined;
        outputTokens?: number | undefined;
    }, {
        inputTokens?: number | undefined;
        outputTokens?: number | undefined;
    }>>;
    skipReason: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    status: "running" | "succeeded" | "failed" | "skipped";
    trigger: "manual" | "scheduled";
    startedAt: number;
    model?: string | undefined;
    id?: string | undefined;
    createdAt?: number | undefined;
    finishedAt?: number | undefined;
    settingsSnapshot?: Record<string, unknown> | undefined;
    error?: string | undefined;
    tokenUsage?: {
        inputTokens?: number | undefined;
        outputTokens?: number | undefined;
    } | undefined;
    skipReason?: string | undefined;
}, {
    trigger: "manual" | "scheduled";
    startedAt: number;
    status?: "running" | "succeeded" | "failed" | "skipped" | undefined;
    model?: string | undefined;
    id?: string | undefined;
    createdAt?: number | undefined;
    finishedAt?: number | undefined;
    settingsSnapshot?: Record<string, unknown> | undefined;
    error?: string | undefined;
    tokenUsage?: {
        inputTokens?: number | undefined;
        outputTokens?: number | undefined;
    } | undefined;
    skipReason?: string | undefined;
}>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export declare const ResearchArtifactSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    runId: z.ZodString;
    symbol: z.ZodOptional<z.ZodString>;
    source: z.ZodEnum<["news", "fundamentals", "macro", "options", "prices"]>;
    provider: z.ZodString;
    fetchedAt: z.ZodNumber;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    summary: z.ZodOptional<z.ZodString>;
    citations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    provider: string;
    runId: string;
    source: "options" | "news" | "fundamentals" | "macro" | "prices";
    fetchedAt: number;
    payload: Record<string, unknown>;
    symbol?: string | undefined;
    id?: string | undefined;
    summary?: string | undefined;
    citations?: string[] | undefined;
}, {
    provider: string;
    runId: string;
    source: "options" | "news" | "fundamentals" | "macro" | "prices";
    fetchedAt: number;
    payload: Record<string, unknown>;
    symbol?: string | undefined;
    id?: string | undefined;
    summary?: string | undefined;
    citations?: string[] | undefined;
}>;
export type ResearchArtifact = z.infer<typeof ResearchArtifactSchema>;
export declare const AgentMessageSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    runId: z.ZodString;
    symbol: z.ZodOptional<z.ZodString>;
    seq: z.ZodNumber;
    role: z.ZodEnum<["system", "human", "ai", "tool"]>;
    content: z.ZodString;
    toolName: z.ZodOptional<z.ZodString>;
    toolArgs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    toolResult: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    createdAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    runId: string;
    seq: number;
    role: "system" | "human" | "ai" | "tool";
    content: string;
    symbol?: string | undefined;
    id?: string | undefined;
    createdAt?: number | undefined;
    toolName?: string | undefined;
    toolArgs?: Record<string, unknown> | undefined;
    toolResult?: Record<string, unknown> | undefined;
}, {
    runId: string;
    seq: number;
    role: "system" | "human" | "ai" | "tool";
    content: string;
    symbol?: string | undefined;
    id?: string | undefined;
    createdAt?: number | undefined;
    toolName?: string | undefined;
    toolArgs?: Record<string, unknown> | undefined;
    toolResult?: Record<string, unknown> | undefined;
}>;
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
//# sourceMappingURL=domain.d.ts.map