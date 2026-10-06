import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rawDataDir = process.env.ATN_DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');
export const DATA_DIR = path.resolve(rawDataDir);
