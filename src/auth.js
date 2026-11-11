// @ts-check
/// <reference types="@cloudflare/workers-types" />

/**
 * @typedef {import("./index.js").AppEnv} AppEnv
 */

/**
 * @typedef {Object} PPRequestBody
 * @property {string} secret
 * @property {number} uptime
 */

/**
 * Check if request is authorized
 *
 * @param {Request} request
 * @param {AppEnv} env
 * @returns {boolean}
 */
export function isAuthorized(request, env) {
    if (!env.SECRET_KEY) return false;

    try {
        const url = new URL(request.url);
        if (url.searchParams.get("secret") === env.SECRET_KEY) {
            return true;
        }
    } catch {}

    return false;
}
