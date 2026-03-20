// ─── DISCOVER ─────────────────────────────────────────────────────────────
let seedIdx = null;            // single seed show index
let accountListenedDates = new Set(); // dates pulled from user's account

function showLabel(show) {
    return `${show.date} - ${show.venue}`;
}

function onShowSearch() {
    const q = document.getElementById('showSearch').value.toLowerCase().trim();
    const dropdown = document.getElementById('showDropdown');
    if (!q) { dropdown.style.display = 'none'; return; }

    const matches = [];
    for (let i = 0; i < shows.length; i++) {
        if (matches.length >= 40) break;
        const s = shows[i];
        if (s.date.includes(q) || s.venue.toLowerCase().includes(q)) {
            matches.push(i);
        }
    }

    if (matches.length === 0) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = matches.map(i => {
        const cls = seedIdx === i ? ' selected-show' : '';
        return `<div class="show-dropdown-item${cls}" onmousedown="setSeed(${i})">${showLabel(shows[i])}</div>`;
    }).join('');
    dropdown.style.display = 'block';
}

function closeDropdown() {
    setTimeout(() => { document.getElementById('showDropdown').style.display = 'none'; }, 150);
}

function setSeed(idx) {
    seedIdx = idx;
    renderSeedDisplay();
    document.getElementById('showSearch').value = '';
    document.getElementById('showDropdown').style.display = 'none';
}

function clearSeed() {
    seedIdx = null;
    renderSeedDisplay();
}

function renderSeedDisplay() {
    const div = document.getElementById('seedDisplay');
    if (seedIdx === null) { div.innerHTML = ''; return; }
    div.innerHTML = `<div class="seed-tag">${showLabel(shows[seedIdx])}<span class="remove" onclick="clearSeed()">×</span></div>`;
}

function getTextareaDates(text) {
    const dates = new Set();
    for (const line of text.split(/\r?\n/)) {
        const m = line.trim().match(/(\d{4}-\d{2}-\d{2}[a-z]?)/);
        if (m) dates.add(m[1]);
    }
    return dates;
}

function updateListenedCount() {
    const count = getTextareaDates(document.getElementById('listenedPaste').value).size;
    document.getElementById('listenedCount').textContent = count > 0 ? `${count} shows` : '';
    document.getElementById('downloadBtn').style.display = count > 0 ? 'inline-block' : 'none';
}

function loadListened(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const text = e.target.result.trim();
        let dates = [];
        try {
            const parsed = JSON.parse(text);
            dates = Array.isArray(parsed) ? parsed : Object.keys(parsed);
        } catch {
            dates = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        }
        const textarea = document.getElementById('listenedPaste');
        const existing = textarea.value.trim();
        textarea.value = existing ? existing + '\n' + dates.join('\n') : dates.join('\n');
        updateListenedCount();
    };
    reader.readAsText(file);
    input.value = '';
}

function toggleAccountListened() {
    const cb = document.getElementById('discoverUseAccount');
    const checked = cb.checked;
    localStorage.setItem('discoverUseAccount', checked ? '1' : '0');
    const textarea = document.getElementById('listenedPaste');
    if (checked && typeof trackingData !== 'undefined') {
        accountListenedDates = new Set(
            Object.entries(trackingData).filter(([, td]) => td.listened).map(([date]) => date)
        );
        const existing = getTextareaDates(textarea.value);
        const toAdd = [...accountListenedDates].filter(d => !existing.has(d));
        const existingText = textarea.value.trim();
        textarea.value = existingText ? existingText + '\n' + toAdd.join('\n') : toAdd.join('\n');
    } else {
        const lines = textarea.value.split(/\r?\n/).filter(line => {
            const m = line.trim().match(/(\d{4}-\d{2}-\d{2}[a-z]?)/);
            return !m || !accountListenedDates.has(m[1]);
        });
        textarea.value = lines.join('\n').trim();
        accountListenedDates.clear();
    }
    updateListenedCount();
}

function downloadListened() {
    const dates = [...getTextareaDates(document.getElementById('listenedPaste').value)];
    const blob = new Blob([JSON.stringify(dates, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gybe-listened.json';
    a.click();
}


function clearDiscover() {
    seedIdx = null;
    accountListenedDates.clear();
    renderSeedDisplay();
    document.getElementById('showSearch').value = '';
    document.getElementById('listenedPaste').value = '';
    const useAccountCb = document.getElementById('discoverUseAccount');
    if (useAccountCb) useAccountCb.checked = false;
    document.getElementById('listenedPasteError').textContent = '';
    updateListenedCount();
    document.getElementById('discoverResults').innerHTML = '';
    const gd = document.getElementById('discoverGraph');
    gd.innerHTML = '';
    gd.style.display = 'none';
    const gc = document.getElementById('discoverGraphCard');
    gc.innerHTML = '';
    gc.style.display = 'none';
    document.getElementById('discoverGraphControls').style.display = 'none';
}

function renderAvgSetlist(avgSetlist) {
    const sorted = [...avgSetlist.weights.entries()].sort((a, b) => b[1] - a[1]);
    const rows = sorted.map(([song, w]) => {
        const pct = Math.round(w * 100);
        const barWidth = Math.round(w * 80);
        return `<div style="display:flex;align-items:center;gap:8px;padding:2px 0;">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${song}</span>
            <div class="avg-setlist-bar-track" style="width:80px;height:6px;border-radius:3px;flex-shrink:0;">
                <div style="width:${barWidth}px;height:100%;background:currentColor;border-radius:3px;opacity:0.6;"></div>
            </div>
            <span style="width:3ch;text-align:right;flex-shrink:0;">${pct}%</span>
        </div>`;
    }).join('');
    return `<details style="margin-bottom:16px;font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;">
        <summary style="cursor:pointer;user-select:none;margin-bottom:8px;">average setlist (${avgSetlist.total} shows, ${sorted.length} songs)</summary>
        <div style="max-height:300px;overflow-y:auto;padding-right:4px;">${rows}</div>
    </details>`;
}

function randomShow() {
    const resultsDiv = document.getElementById('discoverResults');
    const graphDiv = document.getElementById('discoverGraph');
    const recordingsOnly = document.getElementById('discoverRecordingsOnly').checked;
    const excludeDates = getTextareaDates(document.getElementById('listenedPaste').value);

    graphDiv.style.display = 'none';
    document.getElementById('discoverGraphControls').style.display = 'none';
    document.getElementById('discoverGraphCard').style.display = 'none';

    const pool = shows.filter(s =>
        !excludeDates.has(s.date) && (!recordingsOnly || s.recordings.length > 0)
    );

    if (pool.length === 0) {
        resultsDiv.innerHTML = '<p class="no-results">no shows to pick from.</p>';
        return;
    }

    const pick = pool[Math.floor(Math.random() * pool.length)];
    resultsDiv.innerHTML = `<h2>random pick</h2>${renderShowCard(pick, '', null)}`;
}

function buildAvgSetlist(excludeDates) {
    const songCounts = new Map();
    let total = 0;
    for (let i = 0; i < shows.length; i++) {
        if (!excludeDates.has(shows[i].date)) continue;
        total++;
        for (const s of showSongSets[i]) songCounts.set(s, (songCounts.get(s) || 0) + 1);
    }
    if (total === 0) return null;
    const weights = new Map();
    let totalWeight = 0;
    for (const [song, count] of songCounts) {
        const w = count / total;
        weights.set(song, w);
        totalWeight += w;
    }
    return { weights, totalWeight, total };
}

function discoverShows() {
    const resultsDiv = document.getElementById('discoverResults');
    const graphDiv = document.getElementById('discoverGraph');
    const recordingsOnly = document.getElementById('discoverRecordingsOnly').checked;
    const discoverMode = document.querySelector('input[name="discoverMode"]:checked').value;
    const discoverView = document.querySelector('input[name="discoverView"]:checked').value;

    const excludeDates = getTextareaDates(document.getElementById('listenedPaste').value);
    if (seedIdx !== null) excludeDates.add(shows[seedIdx].date);

    if (seedIdx === null && excludeDates.size === 0) {
        resultsDiv.innerHTML = '<p class="no-results">pick a seed show or add shows to your listened list.</p>';
        return;
    }

    // Determine seed: real show or average setlist from listened shows
    let seedSongs = null;       // Set for real seed
    let avgSetlist = null;      // { weights, totalWeight, total } for virtual seed
    const isVirtualSeed = seedIdx === null;

    if (!isVirtualSeed) {
        seedSongs = showSongSets[seedIdx];
    } else {
        avgSetlist = buildAvgSetlist(excludeDates);
        if (!avgSetlist) {
            resultsDiv.innerHTML = '<p class="no-results">no shows found.</p>';
            return;
        }
    }

    const candidates = [];
    for (let i = 0; i < shows.length; i++) {
        const show = shows[i];
        if (excludeDates.has(show.date)) continue;
        if (recordingsOnly && show.recordings.length === 0) continue;

        const candidateSongs = showSongSets[i];

        if (isVirtualSeed) {
            if (candidateSongs.size === 0) { candidates.push({ idx: i, jaccard: 0, shared: 0 }); continue; }
            let weightedIntersection = 0, shared = 0;
            for (const s of candidateSongs) {
                if (avgSetlist.weights.has(s)) { weightedIntersection += avgSetlist.weights.get(s); shared++; }
            }
            const overlap = weightedIntersection / Math.sqrt(avgSetlist.totalWeight * candidateSongs.size);
            candidates.push({ idx: i, jaccard: overlap, shared });
        } else {
            if (candidateSongs.size === 0) { candidates.push({ idx: i, jaccard: 0, shared: 0 }); continue; }
            let intersection = 0;
            for (const s of candidateSongs) { if (seedSongs.has(s)) intersection++; }
            const overlap = intersection / Math.sqrt(seedSongs.size * candidateSongs.size);
            candidates.push({ idx: i, jaccard: overlap, shared: intersection });
        }
    }

    if (discoverMode === 'similar') {
        candidates.sort((a, b) => b.jaccard - a.jaccard || shows[b.idx].date.localeCompare(shows[a.idx].date));
    } else {
        candidates.sort((a, b) => a.jaccard - b.jaccard || shows[b.idx].date.localeCompare(shows[a.idx].date));
    }

    if (candidates.length === 0) {
        resultsDiv.innerHTML = '<p class="no-results">no shows found.</p>';
        graphDiv.style.display = 'none';
        document.getElementById('discoverGraphControls').style.display = 'none';
        return;
    }

    if (discoverView === 'graph') {
        resultsDiv.innerHTML = isVirtualSeed ? renderAvgSetlist(avgSetlist) : '';
        renderDiscoverGraph(candidates, discoverMode, isVirtualSeed ? avgSetlist.total : null);
        return;
    }

    graphDiv.style.display = 'none';
    document.getElementById('discoverGraphControls').style.display = 'none';

    const prefix = isVirtualSeed
        ? (discoverMode === 'similar' ? 'most similar to your average setlist' : 'most different from your average setlist')
        : (discoverMode === 'similar' ? 'most similar to your seed' : 'most different from your seed');
    const avgSetlistHtml = isVirtualSeed ? renderAvgSetlist(avgSetlist) : '';
    let html = `<h2>${prefix} (${candidates.length} found)</h2>${avgSetlistHtml}`;

    for (const { idx, jaccard, shared } of candidates) {
        let label = '';
        if (discoverMode === 'similar') {
            const pct = Math.round(jaccard * 100);
            label = `${pct}% similar · ${shared} song${shared !== 1 ? 's' : ''} in common`;
        } else {
            const pct = Math.round((1 - jaccard) * 100);
            label = `${pct}% different${shared > 0 ? ` · ${shared} song${shared > 1 ? 's' : ''} in common` : ''}`;
        }
        html += renderShowCard(shows[idx], label, null);
    }
    resultsDiv.innerHTML = html;
}

// ─── DISCOVER GRAPH ────────────────────────────────────────────────────────
function eraColor(date) {
    const y = parseInt(date.slice(0, 4));
    if (y <= 1999) return '#e74c3c'; // red
    if (y <= 2003) return '#e67e22'; // orange
    if (y <= 2012) return '#f1c40f'; // yellow
    if (y <= 2016) return '#27ae60'; // green
    if (y <= 2019) return '#16a085'; // teal
    if (y <= 2023) return '#2980b9'; // blue
    return '#8e44ad';                // purple
}

function renderDiscoverGraph(candidates, discoverMode, virtualSeedCount = null) {
    const graphDiv = document.getElementById('discoverGraph');
    graphDiv.innerHTML = '';
    graphDiv.style.display = 'block';

    const W = graphDiv.clientWidth || 700;
    const H = 600;

    // Build node list: seed (real or virtual) + candidates
    const nodeShows = [];
    if (seedIdx !== null) {
        nodeShows.push({ idx: seedIdx, jaccard: 1, shared: showSongSets[seedIdx].size, isSeed: true, isVirtual: false });
    } else if (virtualSeedCount !== null) {
        nodeShows.push({ idx: null, jaccard: 1, shared: 0, isSeed: true, isVirtual: true, virtualSeedCount });
    }
    for (const c of candidates) nodeShows.push({ ...c, isSeed: false, isVirtual: false });

    // One edge per candidate connecting to the seed node
    const filteredNodes = nodeShows;
    const edges = [];
    for (let i = 1; i < filteredNodes.length; i++) {
        edges.push({ source: 0, target: i, weight: filteredNodes[i].jaccard });
    }

    const svg = d3.select(graphDiv).append('svg')
        .attr('width', W).attr('height', H);

    const g = svg.append('g');

    // Zoom/pan
    svg.call(d3.zoom().scaleExtent([0.3, 4]).on('zoom', e => g.attr('transform', e.transform)));

    const INITIAL_THRESHOLD = 0.5;

    // Edge lines
    const link = g.append('g').selectAll('line').data(edges).join('line')
        .attr('stroke', '#ccc')
        .attr('stroke-width', d => 1 + d.weight * 2)
        .attr('visibility', d => d.weight >= INITIAL_THRESHOLD ? 'visible' : 'hidden');

    // Nodes
    const node = g.append('g').selectAll('circle').data(filteredNodes).join('circle')
        .attr('r', d => d.isSeed ? 12 : 8)
        .attr('fill', d => d.isVirtual ? '#aaa' : eraColor(shows[d.idx].date))
        .attr('stroke', d => d.isSeed ? 'black' : '#fff')
        .attr('stroke-width', d => d.isSeed ? 2.5 : 1.5)
        .attr('visibility', d => (d.isSeed || d.jaccard >= INITIAL_THRESHOLD) ? 'visible' : 'hidden')
        .style('cursor', d => d.isVirtual ? 'default' : 'pointer');

    // Tooltip
    const tooltip = d3.select(graphDiv).append('div').attr('class', 'graph-tooltip').style('display', 'none');

    node.on('mouseover', (event, d) => {
        const html = d.isVirtual
            ? `<strong>avg. setlist</strong><br>${d.virtualSeedCount} listened shows`
            : `<strong>${shows[d.idx].date}</strong>${shows[d.idx].venue ? '<br>' + shows[d.idx].venue : ''}`;
        tooltip.style('display', 'block').html(html);
    }).on('mousemove', (event) => {
        const rect = graphDiv.getBoundingClientRect();
        let tx = event.clientX - rect.left + 12;
        let ty = event.clientY - rect.top - 20;
        if (tx + 200 > W) tx = event.clientX - rect.left - 220;
        tooltip.style('left', tx + 'px').style('top', ty + 'px');
    }).on('mouseout', () => {
        tooltip.style('display', 'none');
    });

    // Click → show card overlay (not for virtual seed)
    node.on('click', (event, d) => {
        if (d.isVirtual) return;
        event.stopPropagation();
        const show = shows[d.idx];
        const cardDiv = document.getElementById('discoverGraphCard');
        let label = '';
        if (!d.isSeed) {
            if (discoverMode === 'similar') {
                const pct = Math.round(d.jaccard * 100);
                label = `${pct}% similar · ${d.shared} song${d.shared !== 1 ? 's' : ''} in common`;
            } else {
                const pct = Math.round((1 - d.jaccard) * 100);
                label = `${pct}% different${d.shared > 0 ? ` · ${d.shared} song${d.shared > 1 ? 's' : ''} in common` : ''}`;
            }
        }
        const highlightSet = (!d.isSeed && seedIdx !== null) ? showSongSets[seedIdx] : null;
        cardDiv.innerHTML = renderShowCard(show, label, highlightSet);
        cardDiv.style.display = 'block';
    });

    svg.on('click', () => {
        const cardDiv = document.getElementById('discoverGraphCard');
        cardDiv.innerHTML = '';
        cardDiv.style.display = 'none';
    });

    // Similarity threshold slider
    function applyThreshold(pct) {
        const t = pct / 100;
        node.attr('visibility', d => (d.isSeed || d.jaccard >= t) ? 'visible' : 'hidden');
        link.attr('visibility', e => {
            const srcOk = e.source.isSeed || e.source.jaccard >= t;
            const tgtOk = e.target.isSeed || e.target.jaccard >= t;
            return (srcOk && tgtOk) ? 'visible' : 'hidden';
        });
    }

    const controls = document.getElementById('discoverGraphControls');
    controls.style.display = 'block';
    const slider = document.getElementById('discoverThreshold');
    const label = document.getElementById('discoverThresholdLabel');
    slider.value = 50;
    label.textContent = '50%';
    slider.oninput = () => {
        label.textContent = slider.value + '%';
        applyThreshold(parseInt(slider.value));
    };

    // Force simulation
    const sim = d3.forceSimulation(filteredNodes)
        .force('link', d3.forceLink(edges).id((d, i) => i).strength(1.0).distance(d => 20 + (1 - d.weight) * 350))
        .force('charge', d3.forceManyBody().strength(-15))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collision', d3.forceCollide(16))
        .on('tick', () => {
            link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            node.attr('cx', d => d.x).attr('cy', d => d.y);
        })
        ;

    // Legend
    const legendData = [
        { label: '1997–1999', color: '#e74c3c' },
        { label: '2000–2003', color: '#e67e22' },
        { label: '2010–2012', color: '#f1c40f' },
        { label: '2013–2016', color: '#27ae60' },
        { label: '2017–2019', color: '#16a085' },
        { label: '2022–2023', color: '#2980b9' },
        { label: '2024–2026', color: '#8e44ad' },
    ];
    const legend = svg.append('g').attr('transform', 'translate(10, 10)');
    legendData.forEach((d, i) => {
        const row = legend.append('g').attr('transform', `translate(0, ${i * 18})`);
        row.append('circle').attr('r', 6).attr('cx', 6).attr('cy', 6).attr('fill', d.color);
        row.append('text').attr('x', 16).attr('y', 11)
            .style('font-family', "Monaco, 'JetBrains Mono', monospace")
            .style('font-size', '11px').text(d.label);
    });
}


// When graph view is selected, force "recordings only" + "most similar" and disable both
document.querySelectorAll('input[name="discoverView"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const cb = document.getElementById('discoverRecordingsOnly');
        const modeRadios = document.querySelectorAll('input[name="discoverMode"]');
        if (radio.value === 'graph' && radio.checked) {
            cb.checked = true;
            cb.disabled = true;
            cb.parentElement.classList.add('disabled-label');
            modeRadios.forEach(r => {
                r.disabled = true;
                if (r.value === 'similar') r.checked = true;
                r.parentElement.classList.add('disabled-label');
            });
        } else {
            cb.disabled = false;
            cb.parentElement.classList.remove('disabled-label');
            modeRadios.forEach(r => {
                r.disabled = false;
                r.parentElement.classList.remove('disabled-label');
            });
        }
    });
});
