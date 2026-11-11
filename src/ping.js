// @ts-check
/// <reference types="@cloudflare/workers-types" />

/**
 * @typedef {import("./index.js").AppEnv} AppEnv
 */

/**
 * @typedef {Object} PPRange
 * @property {number} id
 * @property {number} start_time
 * @property {number} end_time
 */

/**
 * Handle Ping from device
 * 
 * @param {AppEnv} env 
 * @param {number} uptime 
 * @returns {Promise<Response>}
 */
export async function handlePing(env, uptime) {
    // Current UNIX timestamp in seconds (float)
    const currTimeRaw = Date.now() / 1000;
    // Current UNIX timestamp in seconds (int)
    const currTime = Math.floor(currTimeRaw);
    // Boot time UNIX timestamp in seconds
    const bootTime = Math.round(currTimeRaw - (typeof uptime === "number" && uptime >= 0 ? uptime : 0));

    // Fetch the latest range from the database
    /** @type {PPRange | null} */
    const latestRange = await env.DB.prepare(`
        SELECT id, start_time, end_time FROM ranges 
        ORDER BY end_time DESC 
        LIMIT 1;
    `).first();

    if (latestRange) {
        const startTime = latestRange.start_time;
        const endTime = latestRange.end_time;

        // If bootTime is within current range (+/- 10 minutes) or now is within 10 minutes of the range
        if ((bootTime >= (startTime - 10 * 60) && bootTime <= (endTime + 10 * 60)) || (currTime - endTime <= 10 * 60)) {
            if (bootTime < startTime) {
                // Update the start_time and end_time of the latest range
                await env.DB.prepare(`
                    UPDATE ranges SET start_time = ?, end_time = ? WHERE id = ?;
                `).bind(bootTime, currTime, latestRange.id).run();
                return new Response("Ping updated range!", { status: 200 });
            }
            // Update the end_time of the latest range
            await env.DB.prepare(`
                UPDATE ranges SET end_time = ? WHERE id = ?;
            `).bind(currTime, latestRange.id).run();
            return new Response("Ping updated range!", { status: 200 });
        }
    }

    // If no range exists or gap is too large, start a new range
    await env.DB.prepare(`
        INSERT INTO ranges (start_time, end_time) VALUES (?, ?);
    `).bind(bootTime, currTime).run();
    return new Response("Ping created new range!", { status: 200 });
}
