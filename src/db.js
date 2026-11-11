// @ts-check
/// <reference types="@cloudflare/workers-types" />

import { isAuthorized } from "./auth.js";

/**
 * @typedef {import("./index.js").AppEnv} AppEnv
 */

/**
 * @typedef {Object} PPRangeItem
 * @property {number} [id]
 * @property {number} start_time
 * @property {number} end_time
 */

/**
 * Handle Export Database
 *
 * @param {Request} request
 * @param {AppEnv} env
 * @returns {Promise<Response>}
 */
export async function handleExportDB(request, env) {
    if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    if (!isAuthorized(request, env)) {
        return new Response("Unauthorized", { status: 401 });
    }

    try {
        /** @type {D1Result<PPRangeItem>} */
        const queryResult = await env.DB.prepare(`
            SELECT id, start_time, end_time FROM ranges ORDER BY start_time ASC;
        `).all();

        if (!queryResult.success) {
            return new Response("Database query failed", { status: 500 });
        }

        const ranges = queryResult.results || [];
        const payload = {
            version: 1,
            exported_at: Math.floor(Date.now() / 1000),
            count: ranges.length,
            ranges
        };

        return new Response(JSON.stringify(payload, null, 2), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": `attachment; filename="power-ping-export-${Math.floor(Date.now() / 1000)}.json"`
            }
        });
    } catch (err) {
        return new Response(`Export failed: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
    }
}

/**
 * Handle Import Database
 *
 * @param {Request} request
 * @param {AppEnv} env
 * @returns {Promise<Response>}
 */
export async function handleImportDB(request, env) {
    if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    if (!isAuthorized(request, env)) {
        return new Response("Unauthorized", { status: 401 });
    }

    /** @type {any} */
    let body;
    try {
        body = await request.json();
    } catch {
        return new Response("Invalid JSON payload", { status: 400 });
    }

    /** @type {any} */
    let items;
    if (Array.isArray(body)) {
        items = body;
    } else if (body && typeof body === "object") {
        if (Array.isArray(body.ranges)) {
            items = body.ranges;
        } else if (Array.isArray(body.data)) {
            items = body.data;
        }
    }

    if (!items || !Array.isArray(items)) {
        return new Response("Invalid request: expected a JSON array of ranges or an object with a 'ranges' array", { status: 400 });
    }

    // Filter and sanitize valid items
    /** @type {Array<PPRangeItem>} */
    const validItems = [];
    for (const item of items) {
        if (
            item &&
            typeof item.start_time === "number" &&
            typeof item.end_time === "number" &&
            !isNaN(item.start_time) &&
            !isNaN(item.end_time)
        ) {
            validItems.push({
                id: (typeof item.id === "number" && !isNaN(item.id)) ? item.id : undefined,
                start_time: Math.round(item.start_time),
                end_time: Math.round(item.end_time)
            });
        }
    }

    if (items.length > 0 && validItems.length === 0) {
        return new Response("No valid range objects found (must contain start_time and end_time numbers)", { status: 400 });
    }

    try {
        // Ensure table exists
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS ranges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL
            );
        `).run();

        const url = new URL(request.url);
        const isReplace = (
            (body && typeof body === "object" && (body.mode === "replace" || body.mode === "overwrite" || body.clear === true)) ||
            url.searchParams.get("mode") === "replace"
        );

        if (isReplace) {
            await env.DB.prepare("DELETE FROM ranges;").run();
        }

        // Build batch insert statements
        const statements = [];
        for (const item of validItems) {
            if (item.id !== undefined) {
                statements.push(
                    env.DB.prepare(`
                        INSERT OR REPLACE INTO ranges (id, start_time, end_time) 
                        VALUES (?, ?, ?);
                    `).bind(item.id, item.start_time, item.end_time)
                );
            } else {
                statements.push(
                    env.DB.prepare(`
                        INSERT INTO ranges (start_time, end_time) 
                        VALUES (?, ?);
                    `).bind(item.start_time, item.end_time)
                );
            }
        }

        // Execute in chunks of 50 statements
        const BATCH_SIZE = 50;
        for (let i = 0; i < statements.length; i += BATCH_SIZE) {
            const chunk = statements.slice(i, i + BATCH_SIZE);
            await env.DB.batch(chunk);
        }

        const responsePayload = {
            success: true,
            imported: validItems.length,
            total_received: items.length,
            mode: isReplace ? "replace" : "merge"
        };

        return new Response(JSON.stringify(responsePayload, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" }
        });
    } catch (err) {
        return new Response(`Import failed: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
    }
}

/**
 * Handle Database Initialization
 *
 * @param {Request} request
 * @param {AppEnv} env
 * @returns {Promise<Response>}
 */
export async function handleInitDB(request, env) {
    if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    if (!isAuthorized(request, env)) {
        return new Response("Unauthorized", { status: 401 });
    }

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
