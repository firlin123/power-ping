// @ts-check
/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite/client" />

/**
 * @typedef {Object} AppEnv
 * @property {D1Database} DB
 * @property {string} SECRET_KEY
 */

/**
 * @typedef {Object} PPRequestBody
 * @property {string} secret
 * @property {number} uptime
 */

/**
 * @typedef {Object} PPRangeBase
 * @property {number} start_time
 * @property {number} end_time
 */

/**
 * @typedef {Object} PPRangeID
 * @property {number} id
 */

/** @typedef {PPRangeBase & PPRangeID} PPRange */

/**
 * @typedef {Object} PPOutagePAN
 * @property {true} powerAvailableNow
 */

/**
 * @typedef {Object} PPOutageNormal
 * @property {number | "???"} start_time
 * @property {number | "???"} end_time
 * @property {string} duration
 * @property {string} started
 * @property {string} lastedAfter
 * @property {boolean} ongoing
 */

/** @typedef {PPOutagePAN | PPOutageNormal} PPOutage*/

/**
 * Middleware for Authorization using POST data
 * 
 * @param {Request} request 
 * @param {AppEnv} env 
 * @param {(env: AppEnv, uptime: number) => Promise<Response>} handler
 * @returns {Promise<Response>}
 */
async function withAuth(request, env, handler) {
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

/**
 * Handle Ping
 * 
 * @param {AppEnv} env 
 * @param {number} uptime 
 * @returns {Promise<Response>}
 */
async function handlePing(env, uptime) {
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

/**
 * Handle DB Initialization
 * 
 * @param {AppEnv} env 
 * @param {number} _ 
 * @returns {Promise<Response>}
 */
async function handleInitDb(env, _) {
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

/**
 * Handle Index
 * 
 * @param {AppEnv} env 
 * @returns {Promise<Response>}
 */
async function handleIndex(env) {
    const now = Math.floor(Date.now() / 1000);

    // Query all power outage ranges in ascending order
    /** @type {D1Result<PPRangeBase>} */
    const ranges = await env.DB.prepare(`
        SELECT start_time, end_time FROM ranges ORDER BY start_time ASC;
    `).all();

    // Early bail if DB query failed or empty
    if (!ranges.success || !ranges.results) {
        return new Response("Error fetching power outages", { status: 500 });
    }

    const results = ranges.results;
    /** @type {Array<PPOutage>} */
    const outages = [];

    for (let i = 0; i <= results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        if (!prev && !curr) {
            continue;
        }
        /** @type {boolean} */
        const isLast = /** @type {any} */ (!curr && prev);

        const outageStart = prev ? prev.end_time : "???";
        const outageEnd = curr ? curr.start_time : isLast ? now : "???";
        const nextStart = curr ? curr.end_time : "???";

        let duration = "???";
        if (outageStart !== "???" && outageEnd !== "???") {
            const delta = outageEnd - outageStart;
            duration = formatDuration(delta);

            // Only if it's the *last* outage AND under 10 minutes → "Power Available Now"
            if (isLast && delta <= 10 * 60) {
                outages.push({ powerAvailableNow: true });
                continue;
            }
        }

        let started = "???";
        if (outageStart !== "???") {
            const deltaAgo = now - outageStart;
            started = `${formatDuration(deltaAgo)} ago`;
        }

        let lastedAfter = "???";
        if (outageEnd !== "???" && nextStart !== "???") {
            const deltaNext = nextStart - outageEnd;
            lastedAfter = formatDuration(deltaNext);
        }

        outages.push({
            start_time: outageStart,
            end_time: outageEnd,
            duration,
            started,
            lastedAfter,
            ongoing: isLast,
        });
    }

    const tableRows = outages
        .map((outage) => {
            if ('powerAvailableNow' in outage) {
                return `
                    <tr class="power-available-now">
                        <td colspan="5" style="text-align: center; font-weight: bold;">
                            Power Available Now
                        </td>
                    </tr>`;
            }

            if (outage.ongoing) {
                return `
                    <tr class="outage-ongoing">
                        <td ${outage.start_time !== "???"
                        ? `data-timestamp="${outage.start_time}"`
                        : ""
                    }>${outage.start_time === "???" ? "???" : ""}</td>
                        <td>now</td>
                        <td>${outage.duration}</td>
                        <td>${outage.lastedAfter}</td>
                        <td>${outage.started}</td>
                    </tr>`;
            }

            return `
                <tr>
                    <td ${outage.start_time !== "???"
                    ? `data-timestamp="${outage.start_time}"`
                    : ""
                }>${outage.start_time === "???" ? "???" : ""}</td>
                    <td ${outage.end_time !== "???"
                    ? `data-timestamp="${outage.end_time}"`
                    : ""
                }>${outage.end_time === "???" ? "???" : ""}</td>
                    <td>${outage.duration}</td>
                    <td>${outage.lastedAfter}</td>
                    <td>${outage.started}</td>
                </tr>`;
        })
        .reverse().join("");

    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Power Outages</title>
            <style>
                :root { color-scheme: light dark; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                        Helvetica, Arial, sans-serif;
                    margin: 10px auto;
                    padding: 0;
                    background-color: #fafafa;
                    color: #222;
                    max-width: 900px;
                }
                h1 {
                    text-align: center;
                    font-size: 1.8rem;
                    margin-top: 10px;
                }
                table {
                    border-collapse: collapse;
                    width: 100%;
                    margin-top: 20px;
                    font-size: 0.95rem;
                }
                th, td {
                    border: 1px solid #ccc;
                    padding: 8px;
                    text-align: left;
                    word-wrap: break-word;
                }
                th { background-color: #f0f0f0; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                .table-container { overflow-x: auto; }

                .power-available-now td {
                    background-color: #e8ffe8;
                    font-size: 1rem;
                    color: #2a662a;
                }

                .outage-ongoing td {
                    background-color: #ffe8e8;
                    color: #a22;
                    font-weight: bold;
                }

                @media (max-width: 600px) {
                    body { font-size: 14px; }
                    h1 { font-size: 1.4rem; }
                    th, td { padding: 6px; font-size: 13px; }
                    table { min-width: 500px; }
                }
            </style>
        </head>
        <body>
            <h1>Power Outages</h1>
            ${outages.length
            ? `<div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Start time</th>
                                        <th>End time</th>
                                        <th>Duration</th>
                                        <th>Lasted after</th>
                                        <th>Started ago</th>
                                    </tr>
                                </thead>
                                <tbody>${tableRows}</tbody>
                            </table>
                        </div>`
            : "<p>No outages to display (power is continuous or just active recently).</p>"
        }
            <script>
                document.addEventListener("DOMContentLoaded", () => {
                    document.querySelectorAll("td[data-timestamp]").forEach(td => {
                        const options = {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hourCycle: 'h23',
                        };
                        const timestamp = new Date(
                            parseInt(td.getAttribute("data-timestamp"), 10) * 1000
                        );
                        td.textContent = new Intl.DateTimeFormat('en-GB', options).format(timestamp);
                    });
                });
            </script>
        </body>
        </html>
    `;

    return new Response(html, { headers: { "Content-Type": "text/html" } });


}

const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;
const SEC_PER_DAY = 86400;
const SEC_PER_YEAR = 31536000;

/**
 * Formats duration to human readable format
 * 
 * @param {number} deltaSeconds 
 * @returns {string}
 */
function formatDuration(deltaSeconds) {
    if (typeof deltaSeconds !== "number" || deltaSeconds < 0) return "???";

    if (deltaSeconds < SEC_PER_DAY) {
        // under 1 day -> HH:MM:SS
        const hh = Math.floor(deltaSeconds / SEC_PER_HOUR);
        const mm = Math.floor((deltaSeconds % SEC_PER_HOUR) / SEC_PER_MIN);
        const ss = Math.round(deltaSeconds % SEC_PER_MIN);
        return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    } else if (deltaSeconds < 2 * SEC_PER_DAY) {
        // 1 - 2 days -> show hours and minutes
        const d = Math.floor(deltaSeconds / SEC_PER_DAY);
        const rem = deltaSeconds % SEC_PER_DAY;
        const hh = Math.floor(rem / SEC_PER_HOUR);
        const mm = Math.floor((rem % SEC_PER_HOUR) / SEC_PER_MIN);
        return `${d} day${d !== 1 ? "s" : ""} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    } else if (deltaSeconds < SEC_PER_YEAR) {
        // 2 days - 1 year
        const d = Math.floor(deltaSeconds / SEC_PER_DAY);
        const h = Math.floor((deltaSeconds % SEC_PER_DAY) / SEC_PER_HOUR);
        return `${d} days${h > 0 ? ` ${h} hour${h !== 1 ? "s" : ""}` : ""}`;
    } else {
        // >= 1 year
        const y = Math.floor(deltaSeconds / SEC_PER_YEAR);
        const remDays = Math.floor((deltaSeconds % SEC_PER_YEAR) / SEC_PER_DAY);
        return `${y} year${y !== 1 ? "s" : ""}${remDays ? ` ${remDays} day${remDays !== 1 ? "s" : ""}` : ""}`;
    }
}

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