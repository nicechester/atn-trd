import { EventEmitter } from "node:events";
import { type Settings, type PatchSettingsRequest, type SecretStatus } from "@atn-trd/shared";
export declare const settingsEvents: EventEmitter<[never]>;
export declare function getSettings(): Settings;
export declare function invalidateSettingsCache(): void;
export declare function updateSettings(patch: PatchSettingsRequest): Settings;
export declare function getSecret(name: string): string | undefined;
export declare function setSecret(name: string, value: string): void;
export declare function clearSecret(name: string): void;
export declare function listSecretStatus(): SecretStatus[];
export declare function resolveSecret(name: string): string | undefined;
//# sourceMappingURL=settingsService.d.ts.map