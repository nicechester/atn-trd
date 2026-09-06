/** Macro connector selection (FRED only in v1). */
import type { DataSource, DataSourceResult } from '../types.js';
import { type MacroPayload, type MacroQuery } from './fredMacro.js';
export * from './fredMacro.js';
export type MacroProvider = 'fred';
export type MacroDataSource = DataSource<MacroQuery, DataSourceResult<MacroPayload>>;
export declare function createMacroDataSource(_provider?: MacroProvider): MacroDataSource;
//# sourceMappingURL=index.d.ts.map