// ─── DISCOVER ─────────────────────────────────────────────────────────────
let seedIdx = null;            // single seed show index
let listenedDates = new Set(); // dates from uploaded list

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
        dates.forEach(d => listenedDates.add(d));
        document.getElementById('listenedCount').textContent = `${listenedDates.size} shows`;
        document.getElementById('downloadBtn').style.display = 'inline-block';
    };
    reader.readAsText(file);
    input.value = '';
}

function addListenedDates() {
    const raw = document.getElementById('listenedPaste').value;
    const errEl = document.getElementById('listenedPasteError');
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const notFound = [];
    for (const line of lines) {
        const m = line.match(/(\d{4}-\d{2}-\d{2})/);
        if (!m) { notFound.push(line); continue; }
        listenedDates.add(m[1]);
    }
    document.getElementById('listenedPaste').value = '';
    document.getElementById('listenedCount').textContent = `${listenedDates.size} shows`;
    document.getElementById('downloadBtn').style.display = 'inline-block';
    errEl.textContent = notFound.length ? `not found: ${notFound.join(', ')}` : '';
}

function downloadListened() {
    const blob = new Blob([JSON.stringify([...listenedDates], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gybe-listened.json';
    a.click();
}


function clearDiscover() {
    seedIdx = null;
    listenedDates.clear();
    renderSeedDisplay();
    document.getElementById('showSearch').value = '';
    document.getElementById('listenedPaste').value = '';
    document.getElementById('listenedPasteError').textContent = '';
    document.getElementById('listenedCount').textContent = '';
    document.getElementById('downloadBtn').style.display = 'none';
    document.getElementById('discoverResults').innerHTML = '';
    const gd = document.getElementById('discoverGraph');
    gd.innerHTML = '';
    gd.style.display = 'none';
    const gc = document.getElementById('discoverGraphCard');
    gc.innerHTML = '';
    gc.style.display = 'none';
    document.getElementById('discoverGraphControls').style.display = 'none';
}

function discoverShows() {
    const resultsDiv = document.getElementById('discoverResults');
    const graphDiv = document.getElementById('discoverGraph');
    const recordingsOnly = document.getElementById('discoverRecordingsOnly').checked;
    const discoverMode = document.querySelector('input[name="discoverMode"]:checked').value;
    const discoverView = document.querySelector('input[name="discoverView"]:checked').value;

    if (seedIdx === null && listenedDates.size === 0) {
        resultsDiv.innerHTML = '<p class="no-results">pick a seed show or upload a listened list.</p>';
        return;
    }

    const seedSongs = seedIdx !== null ? showSongSets[seedIdx] : new Set();

    const excludeDates = new Set(listenedDates);
    if (seedIdx !== null) excludeDates.add(shows[seedIdx].date);

    const candidates = [];
    for (let i = 0; i < shows.length; i++) {
        const show = shows[i];
        if (excludeDates.has(show.date)) continue;
        if (recordingsOnly && show.recordings.length === 0) continue;

        if (seedSongs.size === 0) {
            candidates.push({ idx: i, jaccard: 0, shared: 0 });
            continue;
        }

        const candidateSongs = showSongSets[i];
        if (candidateSongs.size === 0) {
            candidates.push({ idx: i, jaccard: 0, shared: 0 });
            continue;
        }

        let intersection = 0;
        for (const s of candidateSongs) { if (seedSongs.has(s)) intersection++; }
        const overlap = intersection / Math.sqrt(seedSongs.size * candidateSongs.size);
        candidates.push({ idx: i, jaccard: overlap, shared: intersection });
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
        resultsDiv.innerHTML = '';
        renderDiscoverGraph(candidates, discoverMode);
        return;
    }

    graphDiv.style.display = 'none';
    document.getElementById('discoverGraphControls').style.display = 'none';
    const prefix = seedSongs.size === 0
        ? 'shows not in your listened list'
        : discoverMode === 'similar' ? 'most similar to your seed' : 'most different from your seed';
    let html = `<h2>${prefix} (${candidates.length} found)</h2>`;
    for (const { idx, jaccard, shared } of candidates) {
        let label = '';
        if (seedSongs.size > 0) {
            if (discoverMode === 'similar') {
                const pct = Math.round(jaccard * 100);
                label = `${pct}% similar · ${shared} song${shared !== 1 ? 's' : ''} in common`;
            } else {
                const pct = Math.round((1 - jaccard) * 100);
                label = `${pct}% different${shared > 0 ? ` · ${shared} song${shared > 1 ? 's' : ''} in common` : ''}`;
            }
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

function renderDiscoverGraph(candidates, discoverMode) {
    const graphDiv = document.getElementById('discoverGraph');
    graphDiv.innerHTML = '';
    graphDiv.style.display = 'block';

    const W = graphDiv.clientWidth || 700;
    const H = 600;

    // Build node list: seed + candidates
    const nodeShows = [];
    if (seedIdx !== null) nodeShows.push({ idx: seedIdx, jaccard: 1, shared: showSongSets[seedIdx].size, isSeed: true });
    for (const c of candidates) nodeShows.push({ ...c, isSeed: false });

    // All candidates become nodes. Compute one edge per candidate: seed → candidate.
    // The slider controls visibility; no threshold is applied here.
    const filteredNodes = nodeShows;
    const edges = [];
    if (seedIdx !== null) {
        for (let i = 1; i < filteredNodes.length; i++) {
            edges.push({ source: 0, target: i, weight: filteredNodes[i].jaccard });
        }
    } else {
        // No seed: compute edges between all pairs, keep only those with overlap >= 0.5
        for (let i = 0; i < filteredNodes.length; i++) {
            for (let j = i + 1; j < filteredNodes.length; j++) {
                const a = showSongSets[filteredNodes[i].idx];
                const b = showSongSets[filteredNodes[j].idx];
                if (a.size === 0 || b.size === 0) continue;
                let intersection = 0;
                for (const s of a) { if (b.has(s)) intersection++; }
                const w = intersection / Math.sqrt(a.size * b.size);
                if (w >= 0.5) edges.push({ source: i, target: j, weight: w });
            }
        }
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
        .attr('fill', d => eraColor(shows[d.idx].date))
        .attr('stroke', d => d.isSeed ? 'black' : '#fff')
        .attr('stroke-width', d => d.isSeed ? 2.5 : 1.5)
        .attr('visibility', d => (d.isSeed || d.jaccard >= INITIAL_THRESHOLD) ? 'visible' : 'hidden')
        .style('cursor', 'pointer')

    // Tooltip
    const tooltip = d3.select(graphDiv).append('div').attr('class', 'graph-tooltip').style('display', 'none');

    node.on('mouseover', (event, d) => {
        const show = shows[d.idx];
        tooltip.style('display', 'block')
            .html(`<strong>${show.date}</strong>${show.venue ? '<br>' + show.venue : ''}`);
    }).on('mousemove', (event) => {
        const rect = graphDiv.getBoundingClientRect();
        let tx = event.clientX - rect.left + 12;
        let ty = event.clientY - rect.top - 20;
        if (tx + 200 > W) tx = event.clientX - rect.left - 220;
        tooltip.style('left', tx + 'px').style('top', ty + 'px');
    }).on('mouseout', () => {
        tooltip.style('display', 'none');
    });

    // Click → show card overlay
    node.on('click', (event, d) => {
        event.stopPropagation();
        const show = shows[d.idx];
        const cardDiv = document.getElementById('discoverGraphCard');
        let label = '';
        if (!d.isSeed && seedIdx !== null) {
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
