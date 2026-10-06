/**
 * Simple event emitter for run progress updates.
 * Used to stream progress to the UI via SSE.
 */
import { EventEmitter } from 'events';
class RunProgressEmitter extends EventEmitter {
    emit(event, data) {
        return super.emit(event, data);
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    off(event, listener) {
        return super.off(event, listener);
    }
}
export const runProgress = new RunProgressEmitter();
export function emitProgress(runId, phase, message, extra) {
    runProgress.emit('progress', {
        runId,
        phase,
        message,
        timestamp: Date.now(),
        ...extra,
    });
}
//# sourceMappingURL=runProgress.js.map