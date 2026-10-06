import { getSettings, updateSettings } from '../config/settingsService.js';
export function getSettingsHandler(_req, res, next) {
    try {
        res.json({ ok: true, data: getSettings() });
    }
    catch (err) {
        next(err);
    }
}
export function patchSettingsHandler(req, res, next) {
    try {
        res.json({ ok: true, data: updateSettings(req.body) });
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=settings.js.map