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
 * Middleware for Authorization using POST data
 * 
 * @param {Request} request 
 * @param {AppEnv} env 
 * @param {(env: AppEnv, uptime: number) => Promise<Response>} handler
 * @returns {Promise<Response>}
 */
export async function withAuth(request, env, handler) {
    if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        /** @type {PPRequestBody} */
        const body = await request.json();
        const secret = body.secret;

        if (secret !== env.SECRET_KEY) {
            return new Response("Unauthorized", { status: 401 });
        }

        return handler(env, body.uptime);
    } catch (err) {
        return new Response("Invalid Request", { status: 400 });
    }
}
