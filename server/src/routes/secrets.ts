import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SetSecretRequestSchema } from '@atn-trd/shared';
import { listSecretStatus, setSecret, clearSecret } from '../config/settingsService.js';
import { ValidationError } from '../lib/errors.js';

function requireName(req: Request): string {
  const { name } = req.params;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('Secret name is required');
  }
  return name;
}

export function getSecretsHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    const data = listSecretStatus();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

export function putSecretHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const name = requireName(req);
    console.log(`[DEBUG] putSecretHandler - Setting secret '${name}'`);

    let body: { value: string };
    try {
      body = SetSecretRequestSchema.parse(req.body);
      console.log(`[DEBUG] putSecretHandler - Parsed body, value length: ${body.value.length}`);
    } catch (err) {
      console.log(`[DEBUG] putSecretHandler - Validation error:`, err instanceof z.ZodError ? err.issues : String(err));
      if (err instanceof z.ZodError) {
        throw new ValidationError('Invalid secret value', err.issues);
      }
      throw err;
    }

    console.log(`[DEBUG] putSecretHandler - Calling setSecret('${name}', ...)`);
    setSecret(name, body.value);
    console.log(`[DEBUG] putSecretHandler - setSecret succeeded, sending response`);
    res.json({ ok: true });
  } catch (err) {
    console.log(`[DEBUG] putSecretHandler - Error:`, err instanceof Error ? err.message : String(err));
    next(err);
  }
}

export function deleteSecretHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const name = requireName(req);
    clearSecret(name);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
