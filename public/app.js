// @ts-check
(function() {
    /** @type {{ serverTime: number, ranges: Array<{start_time: number, end_time: number}>, outages: Array<any> }} */
    let rawData;
    try {
        const rawText = document.getElementById("outage-data")?.textContent || "{}";
        rawData = JSON.parse(rawText);
    } catch (e) {
        console.error("Failed to parse outage data", e);
        return;
    }

    const nowSeconds = rawData.serverTime || Math.floor(Date.now() / 1000);

    // Normalize and merge consecutive ranges
    function normalizeRanges(ranges) {
        if (!ranges || !ranges.length) return [];
        const sorted = [...ranges].sort((a, b) => a.start_time - b.start_time);
        const merged = [{ start_time: sorted[0].start_time, end_time: sorted[0].end_time }];
        for (let i = 1; i < sorted.length; i++) {
            const last = merged[merged.length - 1];
            const cur = sorted[i];
            if (cur.start_time <= last.end_time) {
                last.end_time = Math.max(last.end_time, cur.end_time);
            } else {
                merged.push({ start_time: cur.start_time, end_time: cur.end_time });
            }
        }
        return merged;
    }

    const mergedRanges = normalizeRanges(rawData.ranges);

    // Compute structured outages
    const allOutages = [];
    let isPowerOnNow = false;
    let lastRange = null;

    if (mergedRanges.length > 0) {
        for (let i = 0; i < mergedRanges.length - 1; i++) {
            const start = mergedRanges[i].end_time;
            const end = mergedRanges[i + 1].start_time;
            if (end > start) {
                allOutages.push({
                    start,
                    end,
                    duration: end - start,
                    ongoing: false
                });
            }
        }

        lastRange = mergedRanges[mergedRanges.length - 1];
        isPowerOnNow = (nowSeconds - lastRange.end_time) <= 10 * 60;

        if (!isPowerOnNow) {
            allOutages.push({
                start: lastRange.end_time,
                end: nowSeconds,
                duration: nowSeconds - lastRange.end_time,
                ongoing: true
            });
        }
    }

    // Format helpers
    function formatDurationSec(sec) {
        if (typeof sec !== "number" || sec < 0) return "0m";
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);

        if (d > 0) {
            return `${d}d ${h}h ${m}m`;
        } else if (h > 0) {
            return `${h}h ${m}m`;
        } else {
            return `${m}m`;
        }
    }

    function formatDateTime(unixSec) {
        if (!unixSec || unixSec === "???") return "???";
        const date = new Date(unixSec * 1000);
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).format(date);
    }

    function formatTimeOnly(unixSec) {
        if (!unixSec || unixSec === "???") return "???";
        const date = new Date(unixSec * 1000);
        return new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).format(date);
    }

    // Populate raw table timestamps
    document.querySelectorAll("td[data-timestamp]").forEach(td => {
        const ts = parseInt(td.getAttribute("data-timestamp") || "", 10);
        if (!isNaN(ts)) {
            td.textContent = formatDateTime(ts);
        }
    });

    // Live Status Card
    const liveBadge = document.getElementById("live-status-badge");
    const liveText = document.getElementById("live-status-text");
    const liveSub = document.getElementById("live-status-sub");
    const statState = document.getElementById("stat-state");
    const statStateSub = document.getElementById("stat-state-sub");

    if (liveBadge && liveText && liveSub && statState && statStateSub) {
        if (!mergedRanges.length) {
            liveBadge.className = "live-status-pill";
            liveText.textContent = "No Data";
            liveSub.textContent = "Waiting for first router ping";
            statState.textContent = "No Records";
            statStateSub.textContent = "Awaiting pings";
        } else if (isPowerOnNow) {
            liveBadge.className = "live-status-pill online";
            liveText.textContent = "Power Available Now";
            const uptimeDur = nowSeconds - lastRange.start_time;
            liveSub.textContent = `Power continuous since ${formatDateTime(lastRange.start_time)} (${formatDurationSec(uptimeDur)})`;
            statState.textContent = "Power ON";
            statState.style.color = "var(--power-on-text)";
            statStateSub.textContent = `Online for ${formatDurationSec(uptimeDur)}`;
        } else {
            liveBadge.className = "live-status-pill outage";
            liveText.textContent = "Blackout Ongoing";
            const outageDur = nowSeconds - lastRange.end_time;
            liveSub.textContent = `Outage started at ${formatDateTime(lastRange.end_time)} (${formatDurationSec(outageDur)} ago)`;
            statState.textContent = "Blackout";
            statState.style.color = "var(--accent-red)";
            statStateSub.textContent = `Ongoing for ${formatDurationSec(outageDur)}`;
        }
    }

    // App State: 'day' | 'week' | 'month' | 'year'
    let currentView = "week";
    const savedView = localStorage.getItem("pp_calendar_view");
    if (savedView && ["day", "week", "month", "year"].includes(savedView)) {
        currentView = savedView;
    }

    let referenceDate = new Date();

    function getMonday(d) {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.getFullYear(), date.getMonth(), diff, 0, 0, 0, 0);
    }

    const calendarEl = document.getElementById("calendar-view");
    const periodLabel = document.getElementById("period-label");
    const statCount = document.getElementById("stat-count");
    const statDuration = document.getElementById("stat-duration");
    const statAvailability = document.getElementById("stat-availability");
    const tooltipEl = document.getElementById("calendar-tooltip");

    // Tooltip listeners
    function showTooltip(e, htmlContent) {
        if (!tooltipEl) return;
        tooltipEl.innerHTML = htmlContent;
        tooltipEl.style.display = "block";
        moveTooltip(e);
    }

    function moveTooltip(e) {
        if (!tooltipEl) return;
        const padding = 15;
        let x = e.clientX + padding;
        let y = e.clientY + padding;
        const tipRect = tooltipEl.getBoundingClientRect();
        if (x + tipRect.width > window.innerWidth) {
            x = e.clientX - tipRect.width - padding;
        }
        if (y + tipRect.height > window.innerHeight) {
            y = e.clientY - tipRect.height - padding;
        }
        tooltipEl.style.left = `${Math.max(10, x)}px`;
        tooltipEl.style.top = `${Math.max(10, y)}px`;
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.style.display = "none";
    }

    window.addEventListener("scroll", hideTooltip, { passive: true });

    // Outages overlapping a specific day range
    function getDayOutages(dayStartSec, dayEndSec) {
        const dayDuration = dayEndSec - dayStartSec;
        const segments = [];

        for (const out of allOutages) {
            if (out.start < dayEndSec && out.end > dayStartSec) {
                const segStart = Math.max(out.start, dayStartSec);
                const segEnd = Math.min(out.end, dayEndSec);
                const duration = segEnd - segStart;
                if (duration > 0) {
                    segments.push({
                        original: out,
                        segStart,
                        segEnd,
                        duration,
                        startPercent: ((segStart - dayStartSec) / dayDuration) * 100,
                        widthPercent: (duration / dayDuration) * 100,
                        ongoing: out.ongoing && out.end === segEnd
                    });
                }
            }
        }
        return segments;
    }

    function updateStats(visibleDays) {
        if (!statCount || !statDuration || !statAvailability) return;
        let totalOutageSeconds = 0;
        let totalPeriodSeconds = 0;
        const uniqueOutages = new Set();

        for (const day of visibleDays) {
            const dayStart = day.startSec;
            const dayEnd = Math.min(day.endSec, nowSeconds);
            if (dayEnd > dayStart) {
                totalPeriodSeconds += (dayEnd - dayStart);
            }
            const segs = getDayOutages(day.startSec, day.endSec);
            for (const s of segs) {
                totalOutageSeconds += s.duration;
                uniqueOutages.add(s.original);
            }
        }

        statCount.textContent = String(uniqueOutages.size);
        statDuration.textContent = formatDurationSec(totalOutageSeconds);

        if (totalPeriodSeconds > 0) {
            const uptime = Math.max(0, totalPeriodSeconds - totalOutageSeconds);
            const percent = Math.min(100, Math.max(0, (uptime / totalPeriodSeconds) * 100));
            statAvailability.textContent = `${percent.toFixed(1)}%`;
        } else {
            statAvailability.textContent = "—%";
        }
    }

    // ==========================================
    // 1. DAY VIEW (Zoomed in on the selected day)
    // ==========================================
    function renderDayView() {
        const startOfDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() + 1, 0, 0, 0, 0);
        const startSec = Math.floor(startOfDay.getTime() / 1000);
        const endSec = Math.floor(endOfDay.getTime() / 1000);
        const isToday = startOfDay.toDateString() === new Date().toDateString();

        if (periodLabel) {
            periodLabel.textContent = new Intl.DateTimeFormat(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
                year: "numeric"
            }).format(startOfDay);
        }

        updateStats([{ date: startOfDay, startSec, endSec }]);

        const segments = getDayOutages(startSec, endSec);
        const totalDayOutage = segments.reduce((acc, s) => acc + s.duration, 0);

        let html = `<div class="day-view-container">`;

        // Day header summary
        html += `
            <div class="day-view-header">
                <div>
                    <div class="day-view-title">${isToday ? "Today — " : ""}${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(startOfDay)}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">24-hour detailed breakdown</div>
                </div>
                <div class="day-view-summary-badges">
                    ${totalDayOutage > 0 
                        ? `<span class="day-summary-badge blackout">⬛ Total Outage: ${formatDurationSec(totalDayOutage)}</span>`
                        : `<span class="day-summary-badge power-on">✓ Continuous Power (0m Outage)</span>`
                    }
                    <span class="day-summary-badge ${segments.length > 0 ? "blackout" : "power-on"}">
                        ${segments.length} Blackout${segments.length !== 1 ? "s" : ""}
                    </span>
                </div>
            </div>
        `;

        // Large 24-hour timeline bar
        html += `
            <div class="day-timeline-wrapper">
                <div class="day-timeline-hours">
        `;
        for (let h = 0; h <= 24; h += 2) {
            const pct = (h / 24) * 100;
            const label = `${String(h).padStart(2, "0")}:00`;
            html += `<div class="day-hour-mark" style="left: ${pct}%;">${label}</div>`;
        }
        html += `
                </div>
                <div class="day-track-bar">
                    <div class="day-grid-lines">
        `;
        for (let h = 0; h < 24; h++) {
            html += `<div class="day-grid-col"></div>`;
        }
        html += `   </div>`;

        // Blackout segments on the track
        for (const seg of segments) {
            const out = seg.original;
            const tooltipData = encodeURIComponent(JSON.stringify({
                start: out.start,
                end: out.end,
                duration: out.duration,
                ongoing: out.ongoing,
                segDuration: seg.duration
            }));

            const label = seg.widthPercent > 6 ? `${formatTimeOnly(seg.segStart)} - ${formatTimeOnly(seg.segEnd)} (${formatDurationSec(seg.duration)})` : "";
            html += `
                <div class="blackout-segment ${seg.ongoing ? "ongoing" : ""}" 
                     style="left: ${seg.startPercent}%; width: ${seg.widthPercent}%;"
                     data-tooltip="${tooltipData}">
                    ${label}
                </div>
            `;
        }

        // Current time indicator line if today
        if (isToday) {
            const nowPct = ((nowSeconds - startSec) / (endSec - startSec)) * 100;
            if (nowPct >= 0 && nowPct <= 100) {
                html += `<div class="now-marker-line" style="left: ${nowPct}%;" title="Current Time (${formatTimeOnly(nowSeconds)})"></div>`;
            }
        }

        html += `
                </div>
            </div>
        `;

        // Detailed Outages Log for the Day
        html += `
            <div class="day-outages-card">
                <h3>⚡ Recorded Blackouts for this Day</h3>
        `;

        if (segments.length === 0) {
            html += `<div class="day-no-outages">✓ No power outages recorded on this day. Power was continuous.</div>`;
        } else {
            html += `<div class="day-outage-list">`;
            segments.forEach((seg, idx) => {
                const out = seg.original;
                const isCrossDay = out.duration !== seg.duration;
                html += `
                    <div class="day-outage-item ${seg.ongoing ? "ongoing" : ""}">
                        <div class="day-outage-item-left">
                            <span class="day-outage-pill ${seg.ongoing ? "ongoing" : ""}">
                                ${seg.ongoing ? "🔴 ONGOING" : `OUTAGE #${idx + 1}`}
                            </span>
                            <span><strong>${formatTimeOnly(seg.segStart)}</strong> to <strong>${seg.ongoing ? "Now (" + formatTimeOnly(nowSeconds) + ")" : formatTimeOnly(seg.segEnd)}</strong></span>
                            ${isCrossDay ? `<span style="font-size: 0.78rem; color: var(--text-muted);">(Part of ${formatDurationSec(out.duration)} multi-day outage)</span>` : ""}
                        </div>
                        <div class="day-outage-duration">
                            ${formatDurationSec(seg.duration)}
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        }

        html += `</div></div>`;

        if (calendarEl) calendarEl.innerHTML = html;
        attachSegmentEvents();
    }

    // ==========================================
    // 2. WEEK VIEW (Columns as days, 24h vertical)
    // ==========================================
    function renderWeekView() {
        const monday = getMonday(referenceDate);
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i, 0, 0, 0, 0);
            const nextD = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
            days.push({
                date: d,
                startSec: Math.floor(d.getTime() / 1000),
                endSec: Math.floor(nextD.getTime() / 1000),
                isToday: d.toDateString() === new Date().toDateString()
            });
        }

        const endDay = days[days.length - 1].date;
        const fmtMonth = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
        if (periodLabel) {
            periodLabel.textContent = `${fmtMonth.format(monday)} – ${fmtMonth.format(endDay)}, ${endDay.getFullYear()}`;
        }

        updateStats(days);

        let html = `<div class="week-view">`;

        // Day column headers
        html += `<div class="week-header-row"><div class="week-time-gutter"></div>`;
        for (const day of days) {
            const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day.date);
            const segments = getDayOutages(day.startSec, day.endSec);
            const dayOutageSum = segments.reduce((acc, s) => acc + s.duration, 0);

            html += `
                <div class="week-day-col-header ${day.isToday ? "is-today" : ""}" 
                     data-timestamp="${day.startSec}" 
                     title="Click to zoom into ${dayFmt} (${day.date.getDate()})">
                    <div class="week-day-title">${dayFmt} ${day.date.getDate()} 🔍</div>
                    <div class="week-day-subtitle">${dayOutageSum > 0 ? `⬛ ${formatDurationSec(dayOutageSum)}` : "✓ OK"}</div>
                </div>
            `;
        }
        html += `</div>`;

        // Grid body
        html += `<div class="week-grid-body">`;

        // Hour gutter on the left
        html += `<div class="week-hour-labels">`;
        for (let h = 0; h <= 24; h += 2) {
            const pct = (h / 24) * 100;
            const label = `${String(h).padStart(2, "0")}:00`;
            html += `<div class="week-hour-label" style="top: ${pct}%;">${label}</div>`;
        }
        html += `</div>`;

        // Columns
        html += `<div class="week-day-columns">`;
        for (const day of days) {
            const segments = getDayOutages(day.startSec, day.endSec);

            html += `<div class="week-day-column" data-timestamp="${day.startSec}" title="Click to view day">`;

            // Horizontal hour grid lines
            html += `<div class="week-horizontal-lines">`;
            for (let h = 0; h < 24; h++) {
                html += `<div class="week-horizontal-hour"></div>`;
            }
            html += `</div>`;

            // Blackout vertical segments
            for (const seg of segments) {
                const out = seg.original;
                const tooltipData = encodeURIComponent(JSON.stringify({
                    start: out.start,
                    end: out.end,
                    duration: out.duration,
                    ongoing: out.ongoing,
                    segDuration: seg.duration
                }));

                const label = seg.widthPercent > 5 ? `⬛ ${formatDurationSec(seg.duration)}` : "";
                html += `
                    <div class="blackout-segment vertical ${seg.ongoing ? "ongoing" : ""}" 
                         style="top: ${seg.startPercent}%; height: ${seg.widthPercent}%;"
                         data-tooltip="${tooltipData}">
                        ${label}
                    </div>
                `;
            }

            // Current time horizontal indicator
            if (day.isToday) {
                const nowPct = ((nowSeconds - day.startSec) / (day.endSec - day.startSec)) * 100;
                if (nowPct >= 0 && nowPct <= 100) {
                    html += `<div class="now-marker-horizontal" style="top: ${nowPct}%;" title="Current time"></div>`;
                }
            }

            html += `</div>`;
        }
        html += `</div></div></div>`;

        if (calendarEl) calendarEl.innerHTML = html;
        attachSegmentEvents();

        // Clicking day header or column (including black portions) navigates to Day View!
        calendarEl?.querySelectorAll(".week-day-col-header, .week-day-column").forEach(el => {
            el.addEventListener("click", () => {
                const ts = parseInt(el.getAttribute("data-timestamp") || "", 10);
                if (!isNaN(ts)) {
                    hideTooltip();
                    referenceDate = new Date(ts * 1000);
                    setView("day");
                }
            });
        });
    }

    // ==========================================
    // 3. MONTH VIEW
    // ==========================================
    function renderMonthView() {
        const year = referenceDate.getFullYear();
        const month = referenceDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        if (periodLabel) {
            periodLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(firstDayOfMonth);
        }

        // Align to Monday start
        const startGrid = getMonday(firstDayOfMonth);
        const gridDays = [];
        let cur = new Date(startGrid);

        while (cur <= lastDayOfMonth || cur.getDay() !== 1) {
            const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 0, 0, 0, 0);
            gridDays.push({
                date: new Date(cur),
                startSec: Math.floor(cur.getTime() / 1000),
                endSec: Math.floor(next.getTime() / 1000),
                isCurrentMonth: cur.getMonth() === month,
                isToday: cur.toDateString() === new Date().toDateString()
            });
            cur.setDate(cur.getDate() + 1);
            if (gridDays.length >= 42) break; // safety
        }

        updateStats(gridDays.filter(d => d.isCurrentMonth));

        let html = `<div class="month-view">`;

        // Weekdays header
        html += `<div class="month-header-row">`;
        const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        for (const name of weekdayNames) {
            html += `<div>${name}</div>`;
        }
        html += `</div>`;

        // Days grid
        html += `<div class="month-grid">`;
        for (const day of gridDays) {
            const segments = getDayOutages(day.startSec, day.endSec);
            const dayOutageSum = segments.reduce((acc, s) => acc + s.duration, 0);

            let pillHtml = "";
            if (dayOutageSum > 0) {
                pillHtml = `<span class="month-outage-pill has-blackout">⬛ ${formatDurationSec(dayOutageSum)}</span>`;
            } else if (day.startSec <= nowSeconds && day.isCurrentMonth) {
                pillHtml = `<span class="month-outage-pill" style="color: var(--power-on-text)">✓</span>`;
            }

            html += `
                <div class="month-day-cell ${!day.isCurrentMonth ? "other-month" : ""} ${day.isToday ? "is-today" : ""}"
                     data-timestamp="${day.startSec}"
                     title="Click to zoom into ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(day.date)}">
                    <div class="month-cell-top">
                        <span class="month-day-number">${day.date.getDate()}</span>
                        ${pillHtml}
                    </div>
                    <div class="month-mini-bar">
            `;

            for (const seg of segments) {
                html += `<div class="month-mini-blackout" style="left: ${seg.startPercent}%; width: ${seg.widthPercent}%;"></div>`;
            }

            html += `
                    </div>
                </div>
            `;
        }
        html += `</div></div>`;

        if (calendarEl) calendarEl.innerHTML = html;

        // Click month cell to switch to Day View!
        calendarEl?.querySelectorAll(".month-day-cell").forEach(cell => {
            cell.addEventListener("click", () => {
                const ts = parseInt(cell.getAttribute("data-timestamp") || "", 10);
                if (!isNaN(ts)) {
                    referenceDate = new Date(ts * 1000);
                    setView("day");
                }
            });
        });
    }

    // ==========================================
    // 4. YEAR VIEW (Zoomed out: Whole Year)
    // ==========================================
    function renderYearView() {
        const year = referenceDate.getFullYear();
        if (periodLabel) {
            periodLabel.textContent = `Year ${year}`;
        }

        const yearDays = [];
        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];

        let html = `<div class="year-view"><div class="year-grid">`;

        for (let m = 0; m < 12; m++) {
            const firstDay = new Date(year, m, 1);
            const lastDay = new Date(year, m + 1, 0);
            const daysInMonth = lastDay.getDate();

            // First day day-of-week (1 for Monday, 7 for Sunday)
            let startDayOfWeek = firstDay.getDay();
            startDayOfWeek = startDayOfWeek === 0 ? 7 : startDayOfWeek;

            let monthOutageSec = 0;
            const monthDayCells = [];

            for (let d = 1; d <= daysInMonth; d++) {
                const curDate = new Date(year, m, d, 0, 0, 0, 0);
                const nextDate = new Date(year, m, d + 1, 0, 0, 0, 0);
                const startSec = Math.floor(curDate.getTime() / 1000);
                const endSec = Math.floor(nextDate.getTime() / 1000);
                const isToday = curDate.toDateString() === new Date().toDateString();

                const segs = getDayOutages(startSec, endSec);
                const dayOutageDuration = segs.reduce((acc, s) => acc + s.duration, 0);
                monthOutageSec += dayOutageDuration;

                yearDays.push({ date: curDate, startSec, endSec });

                monthDayCells.push({
                    dayNum: d,
                    startSec,
                    hasBlackout: dayOutageDuration > 0,
                    outageDuration: dayOutageDuration,
                    isToday,
                    isFuture: startSec > nowSeconds
                });
            }

            html += `
                <div class="year-month-card">
                    <div class="year-month-header">
                        <span>${monthNames[m]}</span>
                        <span class="year-month-badge ${monthOutageSec > 0 ? "blackout" : "power-on"}">
                            ${monthOutageSec > 0 ? `⬛ ${formatDurationSec(monthOutageSec)}` : (firstDay.getTime() / 1000 > nowSeconds ? "—" : "✓ OK")}
                        </span>
                    </div>
                    <div class="year-weekdays-row">
                        <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
                    </div>
                    <div class="year-month-days-grid">
            `;

            // Blank filler cells before start of month
            for (let b = 1; b < startDayOfWeek; b++) {
                html += `<div class="year-day-cell empty"></div>`;
            }

            // Month days
            for (const cell of monthDayCells) {
                const title = cell.hasBlackout 
                    ? `${monthNames[m]} ${cell.dayNum}: Outage ${formatDurationSec(cell.outageDuration)} (Click to view)` 
                    : `${monthNames[m]} ${cell.dayNum}: No outages (Click to view)`;

                html += `
                    <div class="year-day-cell ${cell.hasBlackout ? "has-blackout" : ""} ${cell.isToday ? "is-today" : ""}"
                         data-timestamp="${cell.startSec}"
                         title="${title}">
                        ${cell.dayNum}
                    </div>
                `;
            }

            html += `</div></div>`;
        }

        html += `</div></div>`;

        updateStats(yearDays);

        if (calendarEl) calendarEl.innerHTML = html;

        // Click any day in the year view to zoom into Day View!
        calendarEl?.querySelectorAll(".year-day-cell:not(.empty)").forEach(cell => {
            cell.addEventListener("click", () => {
                const ts = parseInt(cell.getAttribute("data-timestamp") || "", 10);
                if (!isNaN(ts)) {
                    referenceDate = new Date(ts * 1000);
                    setView("day");
                }
            });
        });
    }

    // Attach tooltip events to segments
    function attachSegmentEvents() {
        if (!calendarEl) return;
        calendarEl.querySelectorAll(".blackout-segment").forEach(el => {
            el.addEventListener("mouseenter", (e) => {
                try {
                    const data = JSON.parse(decodeURIComponent(el.getAttribute("data-tooltip") || "{}"));
                    const fullStart = formatDateTime(data.start);
                    const fullEnd = data.ongoing ? "Ongoing now" : formatDateTime(data.end);
                    const totalDur = formatDurationSec(data.duration);
                    const segDur = formatDurationSec(data.segDuration);

                    let content = `
                        <div class="tooltip-title">⚡ ${data.ongoing ? "Ongoing Blackout" : "Power Outage"}</div>
                        <div class="tooltip-row"><span>Started:</span><span class="tooltip-value">${fullStart}</span></div>
                        <div class="tooltip-row"><span>Ended:</span><span class="tooltip-value">${fullEnd}</span></div>
                        <div class="tooltip-row"><span>Duration:</span><span class="tooltip-value">${totalDur}</span></div>
                    `;
                    if (data.duration !== data.segDuration) {
                        content += `<div class="tooltip-row" style="border-top: 1px dashed #3f3f46; margin-top: 4px; padding-top: 4px;">
                            <span>On this day:</span><span class="tooltip-value">${segDur}</span>
                        </div>`;
                    }
                    showTooltip(e, content);
                } catch (err) {
                    console.error(err);
                }
            });

            el.addEventListener("mousemove", moveTooltip);
            el.addEventListener("mouseleave", hideTooltip);

            // Click handling
            el.addEventListener("click", (e) => {
                if (currentView === "week") {
                    const column = el.closest(".week-day-column");
                    const ts = column ? parseInt(column.getAttribute("data-timestamp") || "", 10) : NaN;
                    if (!isNaN(ts)) {
                        hideTooltip();
                        referenceDate = new Date(ts * 1000);
                        setView("day");
                    }
                    return;
                }

                // In day view, clicking can toggle or refresh the tooltip
                e.stopPropagation();
                try {
                    const data = JSON.parse(decodeURIComponent(el.getAttribute("data-tooltip") || "{}"));
                    const fullStart = formatDateTime(data.start);
                    const fullEnd = data.ongoing ? "Ongoing now" : formatDateTime(data.end);
                    const totalDur = formatDurationSec(data.duration);
                    showTooltip(e, `
                        <div class="tooltip-title">⚡ ${data.ongoing ? "Ongoing Blackout" : "Power Outage"}</div>
                        <div class="tooltip-row"><span>From:</span><span class="tooltip-value">${fullStart}</span></div>
                        <div class="tooltip-row"><span>To:</span><span class="tooltip-value">${fullEnd}</span></div>
                        <div class="tooltip-row"><span>Duration:</span><span class="tooltip-value">${totalDur}</span></div>
                    `);
                } catch (err) {}
            });
        });

        document.addEventListener("click", hideTooltip);
    }

    function renderCurrentView() {
        if (currentView === "day") {
            renderDayView();
        } else if (currentView === "week") {
            renderWeekView();
        } else if (currentView === "month") {
            renderMonthView();
        } else if (currentView === "year") {
            renderYearView();
        }
    }

    function setView(view) {
        currentView = view;
        localStorage.setItem("pp_calendar_view", view);
        document.querySelectorAll(".view-switcher .control-btn").forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-view") === view);
        });
        renderCurrentView();
    }

    // Navigation buttons
    document.getElementById("nav-prev")?.addEventListener("click", () => {
        if (currentView === "day") {
            referenceDate.setDate(referenceDate.getDate() - 1);
        } else if (currentView === "week") {
            referenceDate.setDate(referenceDate.getDate() - 7);
        } else if (currentView === "month") {
            referenceDate.setMonth(referenceDate.getMonth() - 1);
        } else if (currentView === "year") {
            referenceDate.setFullYear(referenceDate.getFullYear() - 1);
        }
        renderCurrentView();
    });

    document.getElementById("nav-next")?.addEventListener("click", () => {
        if (currentView === "day") {
            referenceDate.setDate(referenceDate.getDate() + 1);
        } else if (currentView === "week") {
            referenceDate.setDate(referenceDate.getDate() + 7);
        } else if (currentView === "month") {
            referenceDate.setMonth(referenceDate.getMonth() + 1);
        } else if (currentView === "year") {
            referenceDate.setFullYear(referenceDate.getFullYear() + 1);
        }
        renderCurrentView();
    });

    document.getElementById("nav-today")?.addEventListener("click", () => {
        referenceDate = new Date();
        renderCurrentView();
    });

    // View switch buttons
    document.querySelectorAll(".view-switcher .control-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const v = btn.getAttribute("data-view");
            if (v) setView(v);
        });
    });

    // Initialize
    setView(currentView);
})();
