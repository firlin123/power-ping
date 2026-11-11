// @ts-check
/// <reference types="@cloudflare/workers-types" />

/**
 * @typedef {import("./index.js").AppEnv} AppEnv
 */

/**
 * Handle DB Initialization
 * 
 * @param {AppEnv} env 
 * @param {number} _ 
 * @returns {Promise<Response>}
 */
export async function handleInitDb(env, _) {
    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ranges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time INTEGER NOT NULL,
            end_time INTEGER NOT NULL
        );
    `;

    const result = await env.DB.prepare(createTableSQL).run();

    if (result.success) {
        return new Response("Database initialized successfully!", { status: 200 });
    } else {
        return new Response("Error initializing database", { status: 500 });
    }
}
