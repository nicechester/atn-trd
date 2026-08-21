import { Request, Response } from 'express';
import { runProgress, type RunProgressEvent } from '../services/runProgress.js';

/**
 * GET /api/runs/progress/stream
 * SSE endpoint for real-time run progress updates.
 */
export function runProgressStreamHandler(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const listener = (event: RunProgressEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  runProgress.on('progress', listener);

  // Send heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    runProgress.off('progress', listener);
  });
}
