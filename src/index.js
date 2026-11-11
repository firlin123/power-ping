// @ts-check
/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite/client" />

import { withAuth } from "./auth.js";
import { handlePing, handlePingAPI } from "./ping.js";
import { handleInitDB, handleExportDB, handleImportDB } from "./db.js";
import { handleIndex } from "./render.js";

/**
 * @typedef {Object} AppEnv
 * @property {D1Database} DB
 * @property {string} SECRET_KEY
 */

/** @type {ExportedHandler<AppEnv>} */
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (path === "/ping") {
            // Temporary leave the old path while I update the device
            return await withAuth(request, env, handlePing);
        } else if (path === "/api/ping") {
            return await handlePingAPI(request, env);
        } else if (path === "/api/db/init") {
            return await handleInitDB(request, env);
        } else if (path === "/api/db/export") {
            return await handleExportDB(request, env);
        } else if (path === "/api/db/import") {
            return await handleImportDB(request, env);
        } else if (path === "/") {
            return await handleIndex(env);
        } else {
            return new Response("Not Found", { status: 404 });
        }
    },
};
