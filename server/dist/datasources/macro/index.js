/** Macro connector selection (FRED only in v1). */
import { FredMacroDataSource } from './fredMacro.js';
export * from './fredMacro.js';
export function createMacroDataSource(_provider = 'fred') {
    return new FredMacroDataSource();
}
//# sourceMappingURL=index.js.map