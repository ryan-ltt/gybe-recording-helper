// ─── SHOWS (by year) ───────────────────────────────────────────────────────
const ERAS_TOGGLES = ['erasRecordingsOnly', 'erasSetlistsOnly', 'erasShowLineage',
    'erasHidePhoneOnly', 'erasLosslessOnly', 'erasShowSpectra'];

function restoreErasToggles() {
    ERAS_TOGGLES.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = localStorage.getItem(id) === '1';
    });
    // the spectrogram view needs its own data file; fetch it, then redraw with it
    if (document.getElementById('erasShowSpectra')?.checked) loadRecordingSpectra().then(buildEras);
}

function onErasToggle(el) {
    localStorage.setItem(el.id, el.checked ? '1' : '0');
    if (el.id === 'erasShowSpectra' && el.checked) {
        loadRecordingSpectra().then(data => {
            if (!data) el.checked = false;   // load failed (an error banner says so)
            buildEras();
        });
        return;
    }
    buildEras();
}

function eraShowSpectra() {
    return document.getElementById('erasShowSpectra')?.checked && !!RECORDING_SPECTRA;
}

// The "all" card and one card per year. Only the headers are built here; a
// card's show rows are rendered the first time it's opened (see toggleEra),
// so the ~1,000 shows aren't all rendered twice on every page load.
let eraGroups = {};   // card id ('yall', 'y1997', …) → shows in it, after the switches

function eraShowLineage() {
    return document.getElementById('erasShowLineage').checked;
}

function buildEras() {
    const container = document.getElementById('erasContainer');

    // Cards open now (and their filter text) stay open through the rebuild,
    // e.g. after flipping a switch or logging in.
    const reopen = {};
    container.querySelectorAll('.era-body.open').forEach(body => {
        reopen[body.id.slice(5)] = body.querySelector('.era-filter input')?.value || '';
    });

    const recordingsOnly = document.getElementById('erasRecordingsOnly').checked;
    const setlistsOnly = document.getElementById('erasSetlistsOnly').checked;
    const hidePhoneOnly = document.getElementById('erasHidePhoneOnly')?.checked;
    const losslessOnly = document.getElementById('erasLosslessOnly')?.checked;
    const showFilter = s => (!recordingsOnly || s.recordings.length > 0) && (!setlistsOnly || s.songs.length > 0)
        && (!hidePhoneOnly || !showIsPhoneOnly(s)) && (!losslessOnly || showHasLossless(s));
    const visible = shows.filter(showFilter);
    eraGroups = { yall: visible };
    for (const show of visible) (eraGroups['y' + show.date.slice(0, 4)] ||= []).push(show);

    const card = (id, title) => {
        const n = eraGroups[id].length;
        return `<div class="era-block">
            <div class="era-header" onclick="toggleEra('${id}')">
                <div><div class="era-title">${title}</div></div>
                <div style="display:flex;align-items:center;gap:16px;">
                    <div class="era-meta">${n} show${n !== 1 ? 's' : ''}</div>
                    <div class="era-toggle" id="toggle-${id}">+</div>
                </div>
            </div>
            <div class="era-body" id="body-${id}">
                <div class="era-filter">
                    <input type="text" placeholder="filter by date, city, venue..." oninput="renderEra('${id}')">
                </div>
                <div class="era-shows" id="shows-${id}"></div>
            </div>
        </div>`;
    };
    const years = Object.keys(eraGroups).filter(id => id !== 'yall').sort();
    container.innerHTML = card('yall', 'all') + years.map(id => card(id, id.slice(1))).join('');

    for (const [id, filter] of Object.entries(reopen)) {
        if (!eraGroups[id]) continue;
        const input = document.querySelector(`#body-${id} .era-filter input`);
        if (input) input.value = filter;
        toggleEra(id);
    }
}

// Render (or re-render) one card's rows.
function renderEra(id) {
    const showsDiv = document.getElementById('shows-' + id);
    if (!showsDiv) return;
    const filter = document.querySelector(`#body-${id} .era-filter input`)?.value || '';
    showsDiv.innerHTML = renderEraShowList(eraGroups[id] || [], filter, id + '-', eraShowLineage());
    showsDiv.dataset.rendered = '1';
}

function renderEraShowList(eraShows, filter, prefix = '', showLineage = false) {
    const f = (filter || '').toLowerCase().trim();
    const filtered = f ? eraShows.filter(s => s.date.includes(f) || s.venue.toLowerCase().includes(f)) : eraShows;
    if (filtered.length === 0) return '<p style="font-family:Monaco, \'JetBrains Mono\', monospace;font-size:12px;color:inherit;">no shows match.</p>';
    return filtered.map(s => {
        const bestId = BEST_RECORDINGS[s.date];   // lineage view lists the best recording first
        const recsHtml = showLineage ? '' : s.recordings.map((r, i) => `<a ${recLinkAttrs(s.date, r)}>[${i+1}]</a>`).join('');
        const lineageHtml = showLineage && s.recordings.length > 0
            ? `<div class="rec-lineage-list" onclick="event.stopPropagation()">${[...s.recordings]
                .sort((a, b) => {
                    const isBest = r => r.id === bestId ? 1 : 0;
                    const hasInfo = r => (r.source && r.source !== 'unknown') || (r.lineage && r.lineage !== 'unknown') ? 1 : 0;
                    return (isBest(b) - isBest(a)) || (hasInfo(b) - hasInfo(a));
                })
                .map((r, i) => {
                const lineage = r.lineage && r.lineage !== 'unknown' ? r.lineage : '';
                const source  = r.source  && r.source  !== 'unknown' ? r.source  : '';
                const infoLines = [];
                if (source)  infoLines.push(`<span class="muted">source:</span> ${source}`);
                if (lineage && (lineage.length <= 80 || !source)) infoLines.push(`<span class="muted">lineage:</span> ${lineage}`);
                const info = infoLines.length ? infoLines.join('<br>') : '<span class="muted">unknown</span>';
                return `<div class="rec-lineage-row"><a ${recLinkAttrs(s.date, r)}>[${i+1}]</a><span class="rec-lineage">${info}</span></div>`;
              }).join('')}</div>`
            : '';
        const mainSongs = [], soundcheckSongs = [];
        const songLengths = s.song_lengths || [];
        s.songs.forEach((song, i) => {
            if (/\(soundcheck\)/i.test(song)) soundcheckSongs.push(song);
            else mainSongs.push(songLengths[i] ? `${song} <span class="song-len">${formatDuration(songLengths[i])}</span>` : song);
        });
        let setlistText = '';
        if (soundcheckSongs.length > 0) {
            setlistText += `<span class="muted" style="font-size:10px;display:block;margin-bottom:2px;">soundcheck</span>` +
                soundcheckSongs.map(song => `<span class="dim">${song.replace(/\s*\(soundcheck\)/i, '')}</span>`).join('<br>') +
                `<br><span class="muted" style="font-size:10px;display:block;margin-top:6px;margin-bottom:2px;">setlist</span>`;
        }
        setlistText += mainSongs.join('<br>');
        if (s.length && s.songs.length) setlistText += `<br><span class="song-len" title="length of the preferred recording on archive.org">total ${formatDuration(s.length)}</span>`;
        if (s.note) setlistText += `<br><span class="muted" style="padding-left:16px;font-size:11px;white-space:pre-line;">${s.note}</span>`;
        const id = 'sl-' + prefix + s.date.replace(/\W/g, '-');
        const td = trackingData[s.date] || { attended: false, listened: false };
        const isPast = s.date.replace(/[a-z]$/, '') <= new Date().toISOString().slice(0, 10);
        const listenedBtn = s.recordings.length > 0 ? `<button class="track-btn${td.listened ? ' active' : ''}" data-tbtn="${s.date}-listened" onclick="toggleTracking('${s.date}','listened')">listened</button>` : '';
        const attendedBtn = isPast ? `<button class="track-btn${td.attended ? ' active' : ''}" data-tbtn="${s.date}-attended" onclick="toggleTracking('${s.date}','attended')">attended</button>` : '';
        const trackBtns = currentUser ? `
            <span class="track-btns" onclick="event.stopPropagation()">
                ${listenedBtn}
                ${attendedBtn}
            </span>` : '';
        const hasSetlist = s.songs.length > 0;
        let noteSection = '';
        if (currentUser) {
            // notes save themselves (note-autosave.js)
            const note = (field, label, first) => `<div class="note-wrap${first && !hasSetlist ? ' note-wrap-first' : ''}" onclick="event.stopPropagation()">
                <div class="note-label muted">${label} <span class="note-status" aria-live="polite"></span></div>
                <textarea class="note-input" rows="1" data-note-date="${s.date}" data-note-field="${field}" placeholder="add a note..."
                    oninput="noteInput(this)" onblur="noteFlush(this)">${escapeHtml(td[field])}</textarea>
            </div>`;
            const parts = [];
            if (td.attended) parts.push(note('attended_notes', 'attended note', true));
            if (td.listened) parts.push(note('listened_notes', 'listened note', !td.attended));
            noteSection = parts.join('');
        }
        const hasExpandable = hasSetlist || !!noteSection;
        return `<div class="era-show-row" data-date="${s.date}"${hasExpandable ? ` data-setlist="${id}" onclick="toggleShowSetlist('${id}')" style="cursor:pointer;"` : ''}>
            <span class="era-show-date">${s.date.replace(/[a-z]$/, '')}</span>
            <span class="era-show-venue">${s.venue}${s.length ? `<span class="song-len era-show-length">${formatDuration(s.length)}</span>` : ''}${phoneOnlyFlag(s)}</span>
            <span class="era-show-recs" onclick="event.stopPropagation()">${recsHtml}</span>
            ${trackBtns}
            <span class="era-show-toggle"${hasExpandable ? ` id="tgl-${id}"` : ' style="visibility:hidden"'}>+</span>
        </div>
        ${lineageHtml}
        ${eraShowSpectra() ? renderSpectraList(s) : ''}
        ${hasExpandable ? `<div class="era-show-setlist" id="${id}">${hasSetlist ? setlistText : ''}${noteSection}</div>` : ''}`;
    }).join('');
}

function toggleShowSetlist(id) {
    const el = document.getElementById(id);
    const tgl = document.getElementById('tgl-' + id);
    const isOpen = el.classList.toggle('open');
    tgl.textContent = isOpen ? '−' : '+';
    if (isOpen) el.querySelectorAll('textarea').forEach(noteAutosize);
}

// Called by note-autosave.js. Returns whether the note was saved.
async function saveNoteValue(date, field, value) {
    if (!currentUser || !sbClient) return false;
    const note = value.trim() || null;
    if (!trackingData[date]) trackingData[date] = { attended: false, listened: false, listened_notes: '', attended_notes: '' };
    const previous = trackingData[date][field];
    trackingData[date][field] = note || '';
    const td = trackingData[date];
    const { error } = await sbClient.from('show_tracking').upsert(
        { user_id: currentUser.id, show_date: date, attended: td.attended, listened: td.listened, listened_notes: td.listened_notes || null, attended_notes: td.attended_notes || null },
        { onConflict: 'user_id,show_date' }
    );
    if (error) {
        trackingData[date][field] = previous;
        notifyError(`couldn't save note: ${error.message}`);
        return false;
    }
    return true;
}

function toggleEra(id) {
    const body = document.getElementById('body-' + id);
    const toggle = document.getElementById('toggle-' + id);
    const isOpen = body.classList.toggle('open');
    toggle.textContent = isOpen ? '−' : '+';
    if (isOpen && !document.getElementById('shows-' + id).dataset.rendered) renderEra(id);
}

// Jump to one show from elsewhere (e.g. the length tab): open its year, expand its
// setlist, scroll to it and flash the row.
function openShowInEras(date) {
    setTabQuery('shows', new URLSearchParams({ show: date }));
    switchTab('shows');
    if (!showByDate[date]) { notifyError(`no show on ${date} in the list.`); return; }
    const year = date.slice(0, 4);
    const body = document.getElementById('body-y' + year);
    if (!body) { notifyError(`${date} is hidden by the recordings-only / setlists-only switches.`); return; }
    if (!body.classList.contains('open')) toggleEra('y' + year);
    const filter = body.querySelector('.era-filter input');
    if (filter && filter.value) {
        filter.value = '';
        renderEra('y' + year);
    }
    const row = body.querySelector(`.era-show-row[data-date="${date}"]`);
    if (!row) { notifyError(`${date} is hidden by the recordings-only / setlists-only switches.`); return; }
    const setlistId = row.dataset.setlist;
    if (setlistId && !document.getElementById(setlistId).classList.contains('open')) toggleShowSetlist(setlistId);
    row.scrollIntoView({ block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth;   // restart the animation if it's already running
    row.classList.add('flash');
}


// ─── TRACKING (shows tab) ───────────────────────────────────────────────────
async function loadTrackingThenBuild() {
    const { data } = await sbClient.from('show_tracking').select('show_date,attended,listened,listened_notes,attended_notes').eq('user_id', currentUser.id);
    trackingData = {};
    if (data) for (const row of data) trackingData[row.show_date] = { attended: row.attended, listened: row.listened, listened_notes: row.listened_notes || '', attended_notes: row.attended_notes || '' };
    trackingLoaded = true;
    buildEras();
    updateErasTrackSection();
    if (finderOpts.hideListened) findShows();   // the listened set just changed
    if (localStorage.getItem('discoverUseAccount') === '1') {
        const cb = document.getElementById('discoverUseAccount');
        if (cb) { cb.checked = true; toggleAccountListened(); }
    }
}

function updateErasTrackSection() {
    const section = document.getElementById('erasTrackSection');
    if (!section) return;
    section.style.display = currentUser ? 'block' : 'none';
    const loggedOut = document.getElementById('erasTrackLoggedOut');
    if (loggedOut) loggedOut.style.display = currentUser ? 'none' : 'block';
    if (currentUser) renderTrackStats();
}

function renderTrackStats() {
    const statsEl = document.getElementById('trackStats');
    if (!statsEl) return;
    const showsWithRecs = shows.filter(s => s.recordings.length > 0);
    const attended = shows.filter(s => trackingData[s.date]?.attended).length;
    const listened = showsWithRecs.filter(s => trackingData[s.date]?.listened).length;
    statsEl.textContent = `${attended} / ${shows.length} attended · ${listened} / ${showsWithRecs.length} listened`;
}

async function toggleTracking(date, field) {
    if (!currentUser) return;
    if (!trackingData[date]) trackingData[date] = { attended: false, listened: false };
    const setState = value => {
        trackingData[date][field] = value;
        document.querySelectorAll(`[data-tbtn="${date}-${field}"]`).forEach(btn => btn.classList.toggle('active', value));
        renderTrackStats();
    };
    const previous = !!trackingData[date][field];
    setState(!previous);
    const td2 = trackingData[date];
    const { error } = await sbClient.from('show_tracking').upsert({
        user_id: currentUser.id,
        show_date: date,
        attended: td2.attended,
        listened: td2.listened,
        attended_notes: td2.attended_notes || null,
        listened_notes: td2.listened_notes || null,
    }, { onConflict: 'user_id,show_date' });
    if (error) {
        setState(previous);
        notifyError(`couldn't update ${date}: ${error.message}`);
    }
}

function loadTrackFile(input) {
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
        document.getElementById('trackImportInput').value = dates.join('\n');
    };
    reader.readAsText(file);
    input.value = '';
}

async function bulkImportTracking() {
    if (!currentUser) { alert('log in first'); return; }
    const field = document.getElementById('trackImportField').value;
    const raw = document.getElementById('trackImportInput').value;
    const resultEl = document.getElementById('trackImportResult');
    const lines = [...new Set(raw.split('\n').map(l => l.trim()).filter(Boolean))];
    const matched = [], unmatched = [];
    for (const line of lines) {
        if (showByDate[line]) matched.push(line);
        else unmatched.push(line);
    }
    if (matched.length === 0) {
        resultEl.textContent = 'no matching dates found.';
        return;
    }
    const rows = matched.map(date => {
        const existing = trackingData[date] || { attended: false, listened: false };
        return {
            user_id: currentUser.id, show_date: date,
            attended: existing.attended, listened: existing.listened,
            attended_notes: existing.attended_notes || null, listened_notes: existing.listened_notes || null,
            [field]: true,
        };
    });
    const setButtons = (date, value) =>
        document.querySelectorAll(`[data-tbtn="${date}-${field}"]`).forEach(btn => btn.classList.toggle('active', value));
    const previous = {};
    for (const row of rows) {
        if (!trackingData[row.show_date]) trackingData[row.show_date] = { attended: false, listened: false };
        previous[row.show_date] = !!trackingData[row.show_date][field];
        trackingData[row.show_date][field] = true;
        setButtons(row.show_date, true);
    }
    renderTrackStats();
    resultEl.textContent = 'importing…';
    const { error } = await sbClient.from('show_tracking').upsert(rows, { onConflict: 'user_id,show_date' });
    if (error) {
        for (const [date, value] of Object.entries(previous)) {
            trackingData[date][field] = value;
            setButtons(date, value);
        }
        renderTrackStats();
        resultEl.textContent = `import failed: ${error.message}`;
        return;
    }
    let msg = `imported ${matched.length} show${matched.length !== 1 ? 's' : ''}.`;
    if (unmatched.length > 0) msg += ` unrecognized: ${unmatched.join(', ')}`;
    resultEl.textContent = msg;
}

