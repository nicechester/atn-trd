import { Request, Response, NextFunction } from 'express';
import { getSettings, updateSettings } from '../config/settingsService.js';

export function getSettingsHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.json({ ok: true, data: getSettings() });
  } catch (err) {
    next(err);
  }
}

export function patchSettingsHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    res.json({ ok: true, data: updateSettings(req.body) });
  } catch (err) {
    next(err);
  }
}
