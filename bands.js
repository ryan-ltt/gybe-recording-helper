let BAND_SHOWS = [];
let BANDS = [];

async function init() {
    const res = await fetch('bands.json');
    const data = await res.json();
    BANDS = data.bands;

    const picker = document.getElementById('bandPicker');
    for (const band of BANDS) {
        const opt = document.createElement('option');
        opt.value = band.slug;
        opt.textContent = band.name;
        picker.appendChild(opt);
    }

    const params = new URLSearchParams(location.search);
    const slugFromUrl = params.get('band');
    const slugFromStorage = localStorage.getItem('lastBand');
    const defaultSlug = (slugFromUrl && BANDS.find(b => b.slug === slugFromUrl))
        ? slugFromUrl
        : (slugFromStorage && BANDS.find(b => b.slug === slugFromStorage))
            ? slugFromStorage
            : BANDS[0]?.slug;

    if (defaultSlug) {
        picker.value = defaultSlug;
        await loadBand(defaultSlug);
    }
}

async function loadBand(slug) {
    const band = BANDS.find(b => b.slug === slug);
    if (!band) return;

    history.replaceState(null, '', '?band=' + slug);
    localStorage.setItem('lastBand', slug);

    const container = document.getElementById('bandsContainer');
    container.innerHTML = '<p style="font-family:Monaco,monospace;font-size:12px;">loading...</p>';

    const [dataRes, lastUpdateText] = await Promise.all([
        fetch(band.data_file).catch(() => null),
        fetch(`.${slug}-last-update`).then(r => r.ok ? r.text() : null).catch(() => null),
    ]);

    if (!dataRes || !dataRes.ok) {
        container.innerHTML = `<p style="font-family:Monaco,monospace;font-size:12px;color:#c00;">Could not load ${band.data_file}</p>`;
        return;
    }
    BAND_SHOWS = await dataRes.json();

    const el = document.getElementById('bandsLastUpdated');
    el.textContent = lastUpdateText ? `updated ${lastUpdateText.trim()}` : '';

    buildBandEras();
}

function onBandChange(slug) {
    loadBand(slug);
}

function buildBandEras() {
    const container = document.getElementById('bandsContainer');
    container.innerHTML = '';

    const recordingsOnly = document.getElementById('bandsRecordingsOnly').checked;
    const setlistsOnly = document.getElementById('bandsSetlistsOnly').checked;
    const showFilter = s => (!recordingsOnly || (s.recordings || []).length > 0)
                         && (!setlistsOnly || (s.songs || []).length > 0)
                         && !s.setlist_pending;

    const byYear = {};
    for (const show of BAND_SHOWS) {
        if (!showFilter(show)) continue;
        const y = show.date.slice(0, 4);
        if (!byYear[y]) byYear[y] = [];
        byYear[y].push(show);
    }

    const allShows = BAND_SHOWS.filter(showFilter);
    if (allShows.length === 0) {
        container.innerHTML = '<p style="font-family:Monaco,monospace;font-size:12px;">no shows match.</p>';
        return;
    }

    const allBlock = document.createElement('div');
    allBlock.className = 'era-block';
    allBlock.innerHTML = `
        <div class="era-header" onclick="toggleBandEra('bands-body-yall','bands-toggle-yall')">
            <div class="era-title">all</div>
            <div style="display:flex;align-items:center;gap:16px;">
                <div class="era-meta">${allShows.length} show${allShows.length !== 1 ? 's' : ''}</div>
                <div class="era-toggle" id="bands-toggle-yall">+</div>
            </div>
        </div>
        <div class="era-body" id="bands-body-yall">
            <div class="era-filter">
                <input type="text" placeholder="filter by date, venue..." oninput="filterAllBandShows(this.value)">
            </div>
            <div class="era-shows" id="bands-shows-all">
                ${renderBandShowList(allShows, '', 'all-')}
            </div>
        </div>`;
    container.appendChild(allBlock);

    for (const year of Object.keys(byYear).sort()) {
        const yearShows = byYear[year];
        const block = document.createElement('div');
        block.className = 'era-block';
        const bodyId = 'bands-body-y' + year;
        const toggleId = 'bands-toggle-y' + year;
        block.innerHTML = `
            <div class="era-header" onclick="toggleBandEra('${bodyId}','${toggleId}')">
                <div class="era-title">${year}</div>
                <div style="display:flex;align-items:center;gap:16px;">
                    <div class="era-meta">${yearShows.length} show${yearShows.length !== 1 ? 's' : ''}</div>
                    <div class="era-toggle" id="${toggleId}">+</div>
                </div>
            </div>
            <div class="era-body" id="${bodyId}">
                <div class="era-filter">
                    <input type="text" placeholder="filter by date, venue..." oninput="filterBandShows('${bodyId}', this.value)">
                </div>
                <div class="era-shows" id="${bodyId}-shows">
                    ${renderBandShowList(yearShows, '', year + '-')}
                </div>
            </div>`;
        container.appendChild(block);
    }
}

function renderBandShowList(eraShows, filter, prefix) {
    const f = (filter || '').toLowerCase().trim();
    const filtered = f
        ? eraShows.filter(s => s.date.includes(f) || (s.venue || '').toLowerCase().includes(f))
        : eraShows;

    if (filtered.length === 0) {
        return '<p style="font-family:Monaco,monospace;font-size:12px;color:inherit;">no shows match.</p>';
    }

    return filtered.map(s => {
        const id = 'bsl-' + prefix + s.date.replace(/\W/g, '-');
        const recs = s.recordings || [];
        const recsHtml = recs.map((r, i) => `<a href="${r.url}" target="_blank" rel="noopener">[${i + 1}]</a>`).join('');
        const songs = s.songs || [];
        const hasSetlist = songs.length > 0;
        const setlistText = songs.join('<br>');
        const sfLink = s.setlistfm_url
            ? `<a href="${s.setlistfm_url}" target="_blank" rel="noopener" style="color:#888;font-size:10px;text-decoration:none;border-bottom:1px dotted #888;margin-left:6px;" onclick="event.stopPropagation()">setlist.fm</a>`
            : '';

        return `<div class="era-show-row"${hasSetlist ? ` onclick="toggleBandSetlist('${id}')" style="cursor:pointer;"` : ''}>
            <span class="era-show-date">${s.date}</span>
            <span class="era-show-venue">${s.venue || ''}${sfLink}</span>
            <span class="era-show-recs" onclick="event.stopPropagation()">${recsHtml}</span>
            <span class="era-show-toggle"${hasSetlist ? ` id="tgl-${id}"` : ' style="visibility:hidden"'}>+</span>
        </div>
        ${hasSetlist ? `<div class="era-show-setlist" id="${id}">${setlistText}</div>` : ''}`;
    }).join('');
}

function toggleBandEra(bodyId, toggleId) {
    const body = document.getElementById(bodyId);
    const toggle = document.getElementById(toggleId);
    const open = body.classList.toggle('open');
    toggle.textContent = open ? '−' : '+';
}

function toggleBandSetlist(id) {
    const el = document.getElementById(id);
    const tgl = document.getElementById('tgl-' + id);
    const open = el.classList.toggle('open');
    tgl.textContent = open ? '−' : '+';
}

function filterAllBandShows(filterText) {
    const recordingsOnly = document.getElementById('bandsRecordingsOnly').checked;
    const setlistsOnly = document.getElementById('bandsSetlistsOnly').checked;
    const showFilter = s => (!recordingsOnly || (s.recordings || []).length > 0)
                         && (!setlistsOnly || (s.songs || []).length > 0)
                         && !s.setlist_pending;
    const allShows = BAND_SHOWS.filter(showFilter);
    document.getElementById('bands-shows-all').innerHTML = renderBandShowList(allShows, filterText, 'all-');
}

function filterBandShows(bodyId, filterText) {
    const showsEl = document.getElementById(bodyId + '-shows');
    const body = document.getElementById(bodyId);
    const year = bodyId.replace('bands-body-y', '');
    const yearShows = BAND_SHOWS.filter(s => s.date.startsWith(year) && !s.setlist_pending);
    showsEl.innerHTML = renderBandShowList(yearShows, filterText, year + '-');
}

init();
