import { z } from 'zod';
import { SetSecretRequestSchema } from '@atn-trd/shared';
import { listSecretStatus, setSecret, clearSecret } from '../config/settingsService.js';
import { ValidationError } from '../lib/errors.js';
function requireName(req) {
    const { name } = req.params;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new ValidationError('Secret name is required');
    }
    return name;
}
export function getSecretsHandler(_req, res, next) {
    try {
        res.json({ ok: true, data: listSecretStatus() });
    }
    catch (err) {
        next(err);
    }
}
export function putSecretHandler(req, res, next) {
    try {
        const name = requireName(req);
        let body;
        try {
            body = SetSecretRequestSchema.parse(req.body);
        }
        catch (err) {
            if (err instanceof z.ZodError)
                throw new ValidationError('Invalid secret value', err.issues);
            throw err;
        }
        setSecret(name, body.value);
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
}
export function deleteSecretHandler(req, res, next) {
    try {
        clearSecret(requireName(req));
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=secrets.js.map