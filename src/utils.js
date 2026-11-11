// @ts-check

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
export function formatDuration(deltaSeconds) {
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
