/**
 * Simple event emitter for run progress updates.
 * Used to stream progress to the UI via SSE.
 */
import { EventEmitter } from 'events';
export interface RunProgressEvent {
    runId: string;
    phase: 'starting' | 'screener' | 'analyst' | 'finbert' | 'portfolio-manager' | 'risk' | 'orders' | 'complete';
    symbol?: string;
    tool?: string;
    message: string;
    timestamp: number;
}
declare class RunProgressEmitter extends EventEmitter {
    emit(event: 'progress', data: RunProgressEvent): boolean;
    on(event: 'progress', listener: (data: RunProgressEvent) => void): this;
    off(event: 'progress', listener: (data: RunProgressEvent) => void): this;
}
export declare const runProgress: RunProgressEmitter;
export declare function emitProgress(runId: string, phase: RunProgressEvent['phase'], message: string, extra?: {
    symbol?: string;
    tool?: string;
}): void;
export {};
//# sourceMappingURL=runProgress.d.ts.map