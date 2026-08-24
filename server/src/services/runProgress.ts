/**
 * Simple event emitter for run progress updates.
 * Used to stream progress to the UI via SSE.
 */

import { EventEmitter } from 'events';

export interface RunProgressEvent {
  runId: string;
  phase: 'starting' | 'screener' | 'analyst' | 'portfolio-manager' | 'risk' | 'orders' | 'complete';
  symbol?: string;
  tool?: string;
  message: string;
  timestamp: number;
}

class RunProgressEmitter extends EventEmitter {
  emit(event: 'progress', data: RunProgressEvent): boolean {
    return super.emit(event, data);
  }

  on(event: 'progress', listener: (data: RunProgressEvent) => void): this {
    return super.on(event, listener);
  }

  off(event: 'progress', listener: (data: RunProgressEvent) => void): this {
    return super.off(event, listener);
  }
}

export const runProgress = new RunProgressEmitter();

export function emitProgress(
  runId: string,
  phase: RunProgressEvent['phase'],
  message: string,
  extra?: { symbol?: string; tool?: string }
): void {
  runProgress.emit('progress', {
    runId,
    phase,
    message,
    timestamp: Date.now(),
    ...extra,
  });
}
