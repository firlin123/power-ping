// @ts-check
/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite/client" />

import { withAuth } from "./auth.js";
import { handlePing } from "./ping.js";
import { handleInitDb } from "./db.js";
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
            return await withAuth(request, env, handlePing);
        } else if (path === "/init-db") {
            return await withAuth(request, env, handleInitDb);
        } else if (path === "/") {
            return await handleIndex(env);
        } else {
            return new Response("Not Found", { status: 404 });
        }
    },
};
