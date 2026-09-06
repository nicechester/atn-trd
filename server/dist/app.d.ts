import express, { Express } from 'express';
interface AppOptions {
    staticRoot?: string;
    viteDevMiddleware?: express.Handler;
}
export declare function createApp(options?: AppOptions): Express;
export {};
//# sourceMappingURL=app.d.ts.map