// ─── Length tab ────────────────────────────────────────────────────────────
// Two views over setlists.json: per-song play counts and lengths, and show
// lengths. Song lengths are human timings (song_lengths, from
// human-song-lengths.csv via track_lengths.py), so "timed" is usually < "played";
// show lengths are recording lengths.

let statsRows = null;          // [{song, plays: [...], timed: [...]}]
let statsSort = { key: 'played', dir: -1 };
let statsOpenSong = null;
let lengthView = 'songs';      // 'songs' | 'shows'
let statsChartPoints = null;   // what #statsChart currently plots, for redraw on resize

const statsTile = (label, value) =>
    `<div class="stats-tile"><div class="stats-tile-value">${value}</div><div class="stats-tile-label">${label}</div></div>`;

// One performance (or show) in a longest/shortest list; opens it on the shows tab.
const statsPerfRow = t => {
    const open = JSON.stringify(t.show.date);
    return `<li tabindex="0" role="link" title="open in shows" onclick='openShowInEras(${open})' onkeydown='if (event.key === "Enter") openShowInEras(${open})'>`
        + `<span class="stats-perf-len">${formatDuration(t.len)}</span><span class="stats-perf-date">${t.date}</span>`
        + `<span class="muted stats-perf-venue" title="${t.show.venue}">${t.show.venue}</span></li>`;
};

const statsLists = byLenDesc => byLenDesc.length ? `<div class="stats-lists">
    <div><div class="stats-list-title">longest</div><ol class="stats-perfs">${byLenDesc.slice(0, 5).map(statsPerfRow).join('')}</ol></div>
    <div><div class="stats-list-title">shortest</div><ol class="stats-perfs">${byLenDesc.slice(-5).reverse().map(statsPerfRow).join('')}</ol></div>
</div>` : '';

function setLengthView(view, btn) {
    lengthView = view;
    btn.closest('.opt-tabs').querySelectorAll('.opt-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderStatsTab();
}

function buildStatsRows() {
    const today = new Date().toISOString().slice(0, 10);
    const bySong = {};
    for (const song of CANONICAL_SONGS) bySong[song] = { song, plays: [], timed: [] };
    for (const show of shows) {
        const date = show.date.replace(/[a-z]$/, '');
        if (date > today) continue;
        const seen = new Set();
        show.songs.forEach((raw, i) => {
            if (/\(soundcheck\)/i.test(raw)) return;
            const canon = normalizeSong(raw);
            if (!canon || !bySong[canon] || seen.has(canon)) return;
            seen.add(canon);
            bySong[canon].plays.push({ date, show });
            const len = show.song_lengths && show.song_lengths[i];
            if (len) bySong[canon].timed.push({ date, show, len });
        });
    }
    return Object.values(bySong).filter(r => r.plays.length > 0);
}

function statsMedian(values) {
    if (!values.length) return null;
    const v = [...values].sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

function statsSummary(r) {
    const lens = r.timed.map(t => t.len);
    const dates = r.plays.map(p => p.date).sort();
    return {
        song: r.song,
        played: r.plays.length,
        first: dates[0],
        last: dates[dates.length - 1],
        typical: statsMedian(lens),
        shortest: lens.length ? Math.min(...lens) : null,
        longest: lens.length ? Math.max(...lens) : null,
        timed: lens.length,
    };
}

const STATS_COLUMNS = [
    { key: 'song',     label: 'song',      cls: 'stats-song' },
    { key: 'played',   label: 'played',    num: true },
    { key: 'first',    label: 'first' },
    { key: 'last',     label: 'last' },
    { key: 'typical',  label: 'typical',   num: true, dur: true, title: 'median length across timed performances' },
    { key: 'shortest', label: 'shortest',  num: true, dur: true },
    { key: 'longest',  label: 'longest',   num: true, dur: true },
    { key: 'timed',    label: 'timed',     num: true, title: 'performances with a trusted length' },
];

function renderStatsTab() {
    if (!shows.length) return;          // setlists.json not loaded yet; index.js calls back
    if (!statsRows) statsRows = buildStatsRows();
    const filterRow = document.getElementById('statsFilterRow');
    statsChartPoints = null;
    if (lengthView === 'shows') {
        filterRow.style.display = 'none';
        renderShowLengths();
    } else if (statsOpenSong) {
        filterRow.style.display = 'none';
        renderStatsSong(statsOpenSong);
    } else {
        filterRow.style.display = '';
        renderStatsTable();
    }
}

function renderStatsTable() {
    const el = document.getElementById('statsContent');
    const q = (document.getElementById('statsFilter')?.value || '').toLowerCase().trim();
    const rows = statsRows.map(statsSummary).filter(r => !q || r.song.includes(q));
    const { key, dir } = statsSort;
    rows.sort((a, b) => {
        const x = a[key], y = b[key];
        if (x == null && y == null) return a.song.localeCompare(b.song);
        if (x == null) return 1;            // blanks always last
        if (y == null) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || a.song.localeCompare(b.song);
    });

    const head = STATS_COLUMNS.map(c => {
        const arrow = c.key === key ? (dir > 0 ? ' ▲' : ' ▼') : '';
        return `<th class="${c.num ? 'num' : ''}"${c.title ? ` title="${c.title}"` : ''} onclick="sortStats('${c.key}')">${c.label}${arrow}</th>`;
    }).join('');
    const body = rows.map(r => `<tr onclick='openStatsSong(${JSON.stringify(r.song)})'>${STATS_COLUMNS.map(c => {
        const v = r[c.key];
        const text = v == null ? '<span class="muted">—</span>' : c.dur ? formatDuration(v) : v;
        return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${text}</td>`;
    }).join('')}</tr>`).join('');

    el.innerHTML = rows.length
        ? `<div class="stats-table-wrap"><table class="stats-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
           <p class="stats-note">song lengths are timed by hand. shows since 2010 include outro drone in the last song</p>`
        : '<p class="no-results">no songs match.</p>';
}

function sortStats(key) {
    statsSort = statsSort.key === key
        ? { key, dir: -statsSort.dir }
        : { key, dir: key === 'song' || key === 'first' ? 1 : -1 };
    renderStatsTable();
}

function openStatsSong(song) {
    statsOpenSong = song;
    renderStatsTab();
    document.getElementById('tab-lengths').scrollIntoView({ block: 'start' });
}

function closeStatsSong() {
    statsOpenSong = null;
    renderStatsTab();
}

function renderStatsSong(song) {
    const r = statsRows.find(x => x.song === song);
    if (!r) return closeStatsSong();
    const s = statsSummary(r);
    const el = document.getElementById('statsContent');
    const byLen = [...r.timed].sort((a, b) => b.len - a.len);

    el.innerHTML = `
        <div class="versions-breadcrumb"><a onclick="closeStatsSong()">← all songs</a></div>
        <h2 style="margin-top:0;">${song}</h2>
        <div class="stats-tiles">
            ${statsTile('played', s.played)}
            ${statsTile('first', s.first)}
            ${statsTile('last', s.last)}
            ${statsTile('typical length', s.typical ? formatDuration(s.typical) : '—')}
        </div>
        ${r.timed.length >= 2
            ? `<div class="stats-chart-title">length of each timed performance <span class="muted">(${r.timed.length} of ${s.played})</span></div>
               <div class="stats-chart" id="statsChart"></div>`
            : `<p class="stats-note">not enough timed performances to chart.</p>`}
        ${statsLists(byLen)}`;
    if (r.timed.length >= 2) drawStatsChart(document.getElementById('statsChart'), r.timed);
}

// ─── Show lengths ──────────────────────────────────────────────────────────
// A show's length is its recording's length on archive.org (the preferred
// recording if one is set): intro tape, tuning, encore break and, since 2010,
// the outro drone included. An incomplete recording shows up short.
function renderShowLengths() {
    const today = new Date().toISOString().slice(0, 10);
    const points = shows.filter(s => s.length && s.date.replace(/[a-z]$/, '') <= today)
        .map(s => ({ date: s.date.replace(/[a-z]$/, ''), show: s, len: s.length }));
    const el = document.getElementById('statsContent');
    if (!points.length) {
        el.innerHTML = '<p class="no-results">no show lengths yet.</p>';
        return;
    }
    const lens = points.map(p => p.len);
    const byLen = [...points].sort((a, b) => b.len - a.len);

    const byYear = {};
    for (const p of points) (byYear[p.date.slice(0, 4)] = byYear[p.date.slice(0, 4)] || []).push(p.len);
    const yearRows = Object.keys(byYear).sort().map(y => {
        const v = byYear[y];
        return `<tr><td>${y}</td><td class="num">${v.length}</td><td class="num">${formatDuration(statsMedian(v))}</td>`
            + `<td class="num">${formatDuration(Math.min(...v))}</td><td class="num">${formatDuration(Math.max(...v))}</td></tr>`;
    }).join('');

    el.innerHTML = `
        <div class="stats-tiles">
            ${statsTile('shows', points.length)}
            ${statsTile('typical show', formatDuration(statsMedian(lens)))}
            ${statsTile('longest', formatDuration(byLen[0].len))}
            ${statsTile('shortest', formatDuration(byLen[byLen.length - 1].len))}
        </div>
        <div class="stats-chart-title">length of each show <span class="muted">(${points.length} shows with a recording)</span></div>
        <div class="stats-chart" id="statsChart"></div>
        ${statsLists(byLen)}
        <div class="stats-list-title" style="margin-top:18px;">by year</div>
        <div class="stats-table-wrap"><table class="stats-table stats-table-static">
            <thead><tr><th>year</th><th class="num">shows</th><th class="num">typical</th><th class="num">shortest</th><th class="num">longest</th></tr></thead>
            <tbody>${yearRows}</tbody>
        </table></div>
        <p class="stats-note">a show's length is the length of its recording on archive.org (the preferred recording if one is set), so it includes the intro, tuning, the encore break and (since 2010) the outro drone. an incomplete recording shows up short.</p>`;
    drawStatsChart(document.getElementById('statsChart'), points);
}

// Length over time: one dot per timed performance. Single series, so no legend;
// the chart title names it. Hover uses a nearest-point layer so small dots don't
// have to be hit dead-centre.
function drawStatsChart(container, points) {
    statsChartPoints = points;
    const W = container.clientWidth || 700, H = 260;
    const m = { top: 12, right: 16, bottom: 28, left: 44 };
    const data = points.map(p => ({ ...p, t: new Date(p.date + 'T00:00:00') })).sort((a, b) => a.t - b.t);

    const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.t)).nice()
        .range([m.left, W - m.right]);
    // ticks on whole-minute steps (d3's "nice" seconds give 8m, 17m, 25m)
    const maxMin = d3.max(data, d => d.len) * 1.08 / 60;
    const stepMin = maxMin > 120 ? 30 : maxMin > 40 ? 10 : 5;
    const topMin = Math.ceil(maxMin / stepMin) * stepMin;
    const y = d3.scaleLinear()
        .domain([0, topMin * 60])
        .range([H - m.bottom, m.top]);

    const svg = d3.select(container).append('svg')
        .attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H)
        .attr('role', 'img')
        .attr('aria-label', `length of each timed performance, ${data.length} points`);

    const yTicks = d3.range(0, topMin + 1, stepMin).map(mins => mins * 60);
    svg.append('g').attr('class', 'stats-grid')
        .selectAll('line').data(yTicks).join('line')
        .attr('x1', m.left).attr('x2', W - m.right)
        .attr('y1', d => y(d)).attr('y2', d => y(d));
    svg.append('g').attr('class', 'stats-axis')
        .attr('transform', `translate(${m.left},0)`)
        .call(d3.axisLeft(y).tickValues(yTicks).tickSize(0).tickPadding(8)
            .tickFormat(d => {
                const mins = Math.round(d / 60);
                return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? String(mins % 60).padStart(2, '0') : ''}`;
            }))
        .call(g => g.select('.domain').remove());
    svg.append('g').attr('class', 'stats-axis')
        .attr('transform', `translate(0,${H - m.bottom})`)
        .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(W / 90))).tickSizeOuter(0).tickPadding(6));

    const dots = svg.append('g').selectAll('circle').data(data).join('circle')
        .attr('class', 'stats-dot')
        .attr('cx', d => x(d.t)).attr('cy', d => y(d.len)).attr('r', 4);

    const tip = document.createElement('div');
    tip.className = 'graph-tooltip stats-tooltip';
    tip.style.display = 'none';
    container.style.position = 'relative';
    container.appendChild(tip);

    const delaunay = d3.Delaunay.from(data, d => x(d.t), d => y(d.len));
    const nearest = e => {
        const [px, py] = d3.pointer(e);
        const i = delaunay.find(px, py);
        return Math.hypot(x(data[i].t) - px, y(data[i].len) - py) <= 24 ? i : -1;
    };
    svg.on('click', e => {
        const i = nearest(e);
        if (i >= 0) openShowInEras(data[i].show.date);
    });
    svg.on('pointermove', e => {
        const i = nearest(e);
        if (i < 0) return hide();
        const d = data[i];
        svg.style('cursor', 'pointer');
        dots.classed('active', (_, j) => j === i).attr('r', (_, j) => j === i ? 6 : 4);
        tip.replaceChildren();
        const v = document.createElement('strong'); v.textContent = formatDuration(d.len);
        const dt = document.createElement('div'); dt.textContent = d.date;
        const vn = document.createElement('div'); vn.className = 'muted'; vn.textContent = d.show.venue;
        const hint = document.createElement('div'); hint.className = 'stats-tooltip-hint'; hint.textContent = 'click to open show';
        tip.append(v, dt, vn, hint);
        tip.style.display = 'block';
        // beside the point, flipping sides so it never covers the point itself
        const scale = container.clientWidth / W;      // svg scales with its container
        const px0 = x(d.t) * scale, py0 = y(d.len) * scale;
        const right = px0 + 14 + tip.offsetWidth <= container.clientWidth;
        tip.style.left = `${right ? px0 + 14 : px0 - 14 - tip.offsetWidth}px`;
        const above = py0 - tip.offsetHeight - 10 >= 0;
        tip.style.top = `${above ? py0 - tip.offsetHeight - 10 : py0 + 10}px`;
    }).on('pointerleave', hide);

    function hide() {
        svg.style('cursor', null);
        tip.style.display = 'none';
        dots.classed('active', false).attr('r', 4);
    }
}

window.addEventListener('resize', () => {
    const el = document.getElementById('statsChart');
    if (el && statsChartPoints && document.getElementById('tab-lengths').classList.contains('active')) {
        el.replaceChildren();
        drawStatsChart(el, statsChartPoints);
    }
});
