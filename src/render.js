// @ts-check
/// <reference types="@cloudflare/workers-types" />

import { formatDuration } from "./utils.js";

/**
 * @typedef {import("./index.js").AppEnv} AppEnv
 */

/**
 * @typedef {Object} PPRangeBase
 * @property {number} start_time
 * @property {number} end_time
 */

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

/** @typedef {PPOutagePAN | PPOutageNormal} PPOutage */

/**
 * Handle Index Page
 * 
 * @param {AppEnv} env 
 * @returns {Promise<Response>}
 */
export async function handleIndex(env) {
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
                            ⚡ Power Available Now
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
                        <td>Ongoing (now)</td>
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

    const dataPayload = JSON.stringify({
        serverTime: now,
        ranges: results,
        outages: outages
    }).replace(/</g, '\\u003c');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Power Outage Calendar</title>
    <link rel="stylesheet" href="/style.css" />
</head>
<body>
    <div class="app-container">
        <!-- Header Card with Live Status -->
        <header class="header-card">
            <div class="header-title-group">
                <h1>⚡ Power Outage Calendar</h1>
                <p id="live-status-sub">Loading power monitoring timeline...</p>
            </div>
            <div id="live-status-badge" class="live-status-pill online">
                <span class="status-dot"></span>
                <span id="live-status-text">Checking Status...</span>
            </div>
        </header>

        <!-- Summary Statistics Grid -->
        <section class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Current State</div>
                <div class="stat-value" id="stat-state">—</div>
                <div class="stat-sub" id="stat-state-sub">—</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Outages</div>
                <div class="stat-value" id="stat-count">0</div>
                <div class="stat-sub" id="stat-count-sub">in selected view</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Blackout Time</div>
                <div class="stat-value" id="stat-duration">0h 0m</div>
                <div class="stat-sub" id="stat-duration-sub">outage duration</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Power Availability</div>
                <div class="stat-value" id="stat-availability">—%</div>
                <div class="stat-sub" id="stat-availability-sub">power uptime ratio</div>
            </div>
        </section>

        <!-- Calendar View Controls -->
        <nav class="calendar-controls">
            <div class="view-switcher">
                <button class="control-btn" data-view="day">☀️ Day</button>
                <button class="control-btn active" data-view="week">📅 Week</button>
                <button class="control-btn" data-view="month">🗓 Month</button>
                <button class="control-btn" data-view="year">🌍 Year</button>
            </div>

            <div class="nav-group">
                <button class="control-btn" id="nav-prev" title="Previous period">‹ Prev</button>
                <button class="control-btn" id="nav-today">Today</button>
                <button class="control-btn" id="nav-next" title="Next period">Next ›</button>
            </div>

            <div class="period-indicator" id="period-label">Loading...</div>

            <div class="legend">
                <div class="legend-item">
                    <span class="legend-swatch blackout"></span>
                    <span>Blackout</span>
                </div>
                <div class="legend-item">
                    <span class="legend-swatch power-on"></span>
                    <span>Power On</span>
                </div>
                <div class="legend-item">
                    <span class="legend-swatch now-line"></span>
                    <span>Now</span>
                </div>
            </div>
        </nav>

        <!-- Main Calendar View -->
        <main class="calendar-container" id="calendar-view">
            <p style="text-align: center; color: var(--text-muted); padding: 40px;">Rendering calendar view...</p>
        </main>

        <!-- Raw Data Table (Collapsed) -->
        <details class="raw-table-details">
            <summary>📋 Raw Outages Table</summary>
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
            : "<p style='padding: 12px 0;'>No outages recorded yet.</p>"
        }
        </details>
    </div>

    <!-- Floating Tooltip -->
    <div id="calendar-tooltip" class="calendar-tooltip"></div>

    <!-- Preloaded Data Payload -->
    <script id="outage-data" type="application/json">${dataPayload}</script>
    <script src="/app.js" defer></script>
</body>
</html>`;

    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
