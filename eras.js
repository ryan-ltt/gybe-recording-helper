// ─── SHOWS (by year) ───────────────────────────────────────────────────────
function buildEras() {
    const container = document.getElementById('erasContainer');
    container.innerHTML = '';

    // Group shows by year
    const recordingsOnly = document.getElementById('erasRecordingsOnly').checked;
    const byYear = {};
    for (const show of shows) {
        if (recordingsOnly && show.recordings.length === 0) continue;
        const y = show.date.slice(0, 4);
        if (!byYear[y]) byYear[y] = [];
        byYear[y].push(show);
    }

    // "All" card — shows every show regardless of year
    const allShows = shows.filter(s => !recordingsOnly || s.recordings.length > 0);
    const allBlock = document.createElement('div');
    allBlock.className = 'era-block';
    allBlock.innerHTML = `
        <div class="era-header" onclick="toggleEra('yall')">
            <div><div class="era-title">all</div></div>
            <div style="display:flex;align-items:center;gap:16px;">
                <div class="era-meta">${allShows.length} show${allShows.length !== 1 ? 's' : ''}</div>
                <div class="era-toggle" id="toggle-yall">+</div>
            </div>
        </div>
        <div class="era-body" id="body-yall">
            <div class="era-filter">
                <input type="text" placeholder="filter by date, city, venue..." oninput="filterAllShows(this.value)">
            </div>
            <div class="era-shows" id="shows-yall">
                ${renderEraShowList(allShows, '', 'yall-')}
            </div>
        </div>`;
    container.appendChild(allBlock);

    for (const year of Object.keys(byYear).sort()) {
        const yearShows = byYear[year];
        const block = document.createElement('div');
        block.className = 'era-block';
        block.innerHTML = `
            <div class="era-header" onclick="toggleEra('y${year}')">
                <div><div class="era-title">${year}</div></div>
                <div style="display:flex;align-items:center;gap:16px;">
                    <div class="era-meta">${yearShows.length} show${yearShows.length !== 1 ? 's' : ''}</div>
                    <div class="era-toggle" id="toggle-y${year}">+</div>
                </div>
            </div>
            <div class="era-body" id="body-y${year}">
                <div class="era-filter">
                    <input type="text" placeholder="filter by date, city, venue..." oninput="filterEraShows('y${year}', this.value)">
                </div>
                <div class="era-shows" id="shows-y${year}">
                    ${renderEraShowList(yearShows, '', 'y${year}-')}
                </div>
            </div>`;
        container.appendChild(block);
    }
}

function renderEraShowList(eraShows, filter, prefix = '') {
    const f = (filter || '').toLowerCase().trim();
    const filtered = f ? eraShows.filter(s => s.date.includes(f) || s.venue.toLowerCase().includes(f)) : eraShows;
    if (filtered.length === 0) return '<p style="font-family:Monaco, \'JetBrains Mono\', monospace;font-size:12px;color:inherit;">no shows match.</p>';
    return filtered.map(s => {
        const bestId = BEST_RECORDINGS[s.date];
        const recsHtml = s.recordings.map((r, i) => `<a href="${r.url}" target="_blank"${bestId === r.id ? ' style="font-weight:bold"' : ''}>[${i+1}]</a>`).join('');
        const mainSongs = [], soundcheckSongs = [];
        for (const song of s.songs) {
            if (/\(soundcheck\)/i.test(song)) soundcheckSongs.push(song);
            else mainSongs.push(song);
        }
        let setlistText = '';
        if (soundcheckSongs.length > 0) {
            setlistText += `<span class="muted" style="font-size:10px;display:block;margin-bottom:2px;">soundcheck</span>` +
                soundcheckSongs.map(song => `<span class="dim">${song.replace(/\s*\(soundcheck\)/i, '')}</span>`).join('<br>') +
                `<br><span class="muted" style="font-size:10px;display:block;margin-top:6px;margin-bottom:2px;">setlist</span>`;
        }
        setlistText += mainSongs.join('<br>');
        if (s.note) setlistText += `<br><span class="muted" style="padding-left:16px;font-size:11px;white-space:pre-line;">${s.note}</span>`;
        const id = 'sl-' + prefix + s.date.replace(/\W/g, '-');
        const td = trackingData[s.date] || { attended: false, listened: false };
        const isPast = s.date.replace(/[a-z]$/, '') <= new Date().toISOString().slice(0, 10);
        const listenedBtn = s.recordings.length > 0 ? `<button class="track-btn${td.listened ? ' active' : ''}" id="tbtn-${s.date}-listened" onclick="toggleTracking('${s.date}','listened')">listened</button>` : '';
        const attendedBtn = isPast ? `<button class="track-btn${td.attended ? ' active' : ''}" id="tbtn-${s.date}-attended" onclick="toggleTracking('${s.date}','attended')">attended</button>` : '';
        const trackBtns = currentUser ? `
            <span class="track-btns" onclick="event.stopPropagation()">
                ${listenedBtn}
                ${attendedBtn}
            </span>` : '';
        const hasSetlist = s.songs.length > 0;
        let noteSection = '';
        if (currentUser) {
            const esc = t => (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const noteStyle = 'flex:1;border:none;padding:2px 0;font-family:Monaco,\'JetBrains Mono\',monospace;font-size:11px;color:inherit;background:transparent;outline:none;resize:none;overflow:hidden;line-height:1.6;';
            const btnStyle = 'font-family:Monaco,\'JetBrains Mono\',monospace;font-size:10px;padding:2px 8px;border:1px solid #ccc;background:white;cursor:pointer;color:inherit;flex-shrink:0;';
            const parts = [];
            if (td.attended) parts.push(`<div style="margin-top:${hasSetlist?'8px':'0'};padding-top:${hasSetlist?'6px':'0'};border-top:${hasSetlist?'1px solid #eee':'none'};" onclick="event.stopPropagation()"><div class="muted" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:10px;margin-bottom:3px;">attended note</div><div style="display:flex;align-items:flex-start;gap:6px;"><textarea id="anote-${s.date}" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" placeholder="add a note..." style="${noteStyle}">${esc(td.attended_notes)}</textarea><button onclick="saveEraNote('${s.date}','attended_notes',document.getElementById('anote-${s.date}').value)" style="${btnStyle}">save</button></div></div>`);
            if (td.listened) parts.push(`<div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee;" onclick="event.stopPropagation()"><div class="muted" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:10px;margin-bottom:3px;">listened note</div><div style="display:flex;align-items:flex-start;gap:6px;"><textarea id="lnote-${s.date}" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" placeholder="add a note..." style="${noteStyle}">${esc(td.listened_notes)}</textarea><button onclick="saveEraNote('${s.date}','listened_notes',document.getElementById('lnote-${s.date}').value)" style="${btnStyle}">save</button></div></div>`);
            noteSection = parts.join('');
        }
        const hasExpandable = hasSetlist || !!noteSection;
        return `<div class="era-show-row"${hasExpandable ? ` onclick="toggleShowSetlist('${id}')" style="cursor:pointer;"` : ''}>
            <span class="era-show-date">${s.date.replace(/[a-z]$/, '')}</span>
            <span class="era-show-venue">${s.venue}</span>
            <span class="era-show-recs" onclick="event.stopPropagation()">${recsHtml}</span>
            ${trackBtns}
            <span class="era-show-toggle"${hasExpandable ? ` id="tgl-${id}"` : ' style="visibility:hidden"'}>+</span>
        </div>
        ${hasExpandable ? `<div class="era-show-setlist" id="${id}">${hasSetlist ? setlistText : ''}${noteSection}</div>` : ''}`;
    }).join('');
}

function toggleShowSetlist(id) {
    const el = document.getElementById(id);
    const tgl = document.getElementById('tgl-' + id);
    const isOpen = el.classList.toggle('open');
    tgl.textContent = isOpen ? '−' : '+';
    if (isOpen) {
        el.querySelectorAll('textarea').forEach(ta => {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        });
    }
}

async function saveEraNote(date, field, value) {
    if (!currentUser || !sbClient) return;
    const note = value.trim() || null;
    if (!trackingData[date]) trackingData[date] = { attended: false, listened: false, listened_notes: '', attended_notes: '' };
    trackingData[date][field] = note || '';
    const td = trackingData[date];
    await sbClient.from('show_tracking').upsert(
        { user_id: currentUser.id, show_date: date, attended: td.attended, listened: td.listened, listened_notes: td.listened_notes || null, attended_notes: td.attended_notes || null },
        { onConflict: 'user_id,show_date' }
    );
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = 'saved';
    setTimeout(() => { btn.textContent = orig; }, 1500);
}

function toggleEra(id) {
    const body = document.getElementById('body-' + id);
    const toggle = document.getElementById('toggle-' + id);
    const isOpen = body.classList.toggle('open');
    toggle.textContent = isOpen ? '−' : '+';
}

function filterAllShows(value) {
    const showsDiv = document.getElementById('shows-yall');
    const recordingsOnly = document.getElementById('erasRecordingsOnly').checked;
    const allShows = shows.filter(s => !recordingsOnly || s.recordings.length > 0);
    showsDiv.innerHTML = renderEraShowList(allShows, value, 'yall-');
}

function filterEraShows(id, value) {
    const showsDiv = document.getElementById('shows-' + id);
    const year = id.slice(1); // strip leading 'y'
    const recordingsOnly = document.getElementById('erasRecordingsOnly').checked;
    const yearShows = shows.filter(s => s.date.startsWith(year) && (!recordingsOnly || s.recordings.length > 0));
    showsDiv.innerHTML = renderEraShowList(yearShows, value, id + '-');
}


// ─── TRACKING (shows tab) ───────────────────────────────────────────────────
async function loadTrackingThenBuild() {
    const { data } = await sbClient.from('show_tracking').select('show_date,attended,listened,listened_notes,attended_notes').eq('user_id', currentUser.id);
    trackingData = {};
    if (data) for (const row of data) trackingData[row.show_date] = { attended: row.attended, listened: row.listened, listened_notes: row.listened_notes || '', attended_notes: row.attended_notes || '' };
    trackingLoaded = true;
    buildEras();
    updateErasTrackSection();
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
    trackingData[date][field] = !trackingData[date][field];
    const btn = document.getElementById(`tbtn-${date}-${field}`);
    if (btn) btn.classList.toggle('active', trackingData[date][field]);
    renderTrackStats();
    const td2 = trackingData[date];
    await sbClient.from('show_tracking').upsert({
        user_id: currentUser.id,
        show_date: date,
        attended: td2.attended,
        listened: td2.listened,
        attended_notes: td2.attended_notes || null,
        listened_notes: td2.listened_notes || null,
    }, { onConflict: 'user_id,show_date' });
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
        return { user_id: currentUser.id, show_date: date, attended: existing.attended, listened: existing.listened, [field]: true };
    });
    for (const row of rows) {
        if (!trackingData[row.show_date]) trackingData[row.show_date] = { attended: false, listened: false };
        trackingData[row.show_date][field] = true;
        const btn = document.getElementById(`tbtn-${row.show_date}-${field}`);
        if (btn) btn.classList.add('active');
    }
    renderTrackStats();
    await sbClient.from('show_tracking').upsert(rows, { onConflict: 'user_id,show_date' });
    let msg = `imported ${matched.length} show${matched.length !== 1 ? 's' : ''}.`;
    if (unmatched.length > 0) msg += ` unrecognized: ${unmatched.join(', ')}`;
    resultEl.textContent = msg;
}

