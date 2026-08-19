/** Macro connector selection (FRED only in v1). */

import type { DataSource, DataSourceResult } from '../types.js';
import { FredMacroDataSource, type MacroPayload, type MacroQuery } from './fredMacro.js';

export * from './fredMacro.js';

export type MacroProvider = 'fred';

export type MacroDataSource = DataSource<MacroQuery, DataSourceResult<MacroPayload>>;

export function createMacroDataSource(_provider: MacroProvider = 'fred'): MacroDataSource {
  return new FredMacroDataSource();
}
