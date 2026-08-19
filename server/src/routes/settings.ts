import { Request, Response, NextFunction } from 'express';
import { getSettings, updateSettings } from '../config/settingsService.js';

export function getSettingsHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    console.log(`[DEBUG] getSettingsHandler - Fetching settings`);
    const data = getSettings();
    console.log(`[DEBUG] getSettingsHandler - Retrieved settings, dataSources:`,
      Object.entries(data.dataSources).map(([id, cfg]) => `${id}:${cfg.provider}`).join(', ')
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.log(`[DEBUG] getSettingsHandler - Error:`, err instanceof Error ? err.message : String(err));
    next(err);
  }
}

export function patchSettingsHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    console.log(`[DEBUG] patchSettingsHandler - Updating settings with patch:`, JSON.stringify(req.body).substring(0, 200));
    console.log(`[DEBUG] patchSettingsHandler - Patch keys:`, Object.keys(req.body).join(', '));

    const data = updateSettings(req.body);
    console.log(`[DEBUG] patchSettingsHandler - Update succeeded`);
    console.log(`[DEBUG] patchSettingsHandler - New settings, dataSources:`,
      Object.entries(data.dataSources).map(([id, cfg]) => `${id}:${cfg.provider}`).join(', ')
    );
    res.json({ ok: true, data });
  } catch (err) {
    console.log(`[DEBUG] patchSettingsHandler - Error:`, err instanceof Error ? err.message : String(err));
    next(err);
  }
}
