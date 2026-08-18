import { Request, Response, NextFunction } from 'express';
import { getSettings, updateSettings } from '../config/settingsService.js';

export function getSettingsHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    const data = getSettings();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

export function patchSettingsHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const data = updateSettings(req.body);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}
