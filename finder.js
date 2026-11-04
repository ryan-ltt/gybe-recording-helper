let songSortMode = localStorage.getItem('songSortMode') || 'alpha';

function setSongSortMode(mode) {
    songSortMode = mode;
    localStorage.setItem('songSortMode', mode);
    _syncSortToggles();
    buildAlbumSections();
    if (document.getElementById('tab-best-versions').classList.contains('active')) {
        renderVersionsTab();
    }
}

function _syncSortToggles() {
    ['sortToggle', 'sortToggleVersions'].forEach(id => {
        const chk = document.getElementById(id);
        if (chk) chk.checked = songSortMode === 'album';
    });
}

function toggleSongSort() {
    setSongSortMode(songSortMode === 'album' ? 'alpha' : 'album');
}

function _makeSongTag(song) {
    const idx = CANONICAL_SONGS.indexOf(song);
    const cls = 'song-tag' + (selected.has(song) ? ' selected' : '');
    return `<div class="${cls}" data-song-idx="${idx}" onclick="toggleSongByIdx(${idx})">${song}</div>`;
}

function buildAlbumSections() {
    const container = document.getElementById('albumSections');
    let html = '';

    const alphaGrid = document.getElementById('alphaSongGrid');
    if (songSortMode === 'alpha') {
        const albumBtns = ALBUMS.map((album, albumIdx) => {
            const validSongs = album.songs.filter(s => CANONICAL_SONGS.includes(s));
            if (validSongs.length === 0) return '';
            return `<button class="album-btn" data-album-idx="${albumIdx}" onclick="toggleAlbumByIdx(${albumIdx})">${album.name} <span class="muted" style="font-size:11px;">(${album.year})</span></button>`;
        }).join('');
        html = `<div class="song-grid" style="margin-bottom:0;">${albumBtns}</div>`;
        const songTags = CANONICAL_SONGS.map(_makeSongTag).join('');
        if (alphaGrid) alphaGrid.innerHTML = `<div class="song-grid">${songTags}</div>`;
    } else {
        if (alphaGrid) alphaGrid.innerHTML = '';
        const songsInAlbums = new Set();

        ALBUMS.forEach((album, albumIdx) => {
            const validSongs = album.songs.filter(s => CANONICAL_SONGS.includes(s));
            if (validSongs.length === 0) return;
            validSongs.forEach(s => songsInAlbums.add(s));
            const songTags = validSongs.map(_makeSongTag).join('');
            html += `<div class="album-section">
                <button class="album-btn" data-album-idx="${albumIdx}" onclick="toggleAlbumByIdx(${albumIdx})">${album.name} <span class="muted" style="font-size:11px;">(${album.year})</span></button>
                <div class="song-grid" style="margin:6px 0 16px 0;">${songTags}</div>
            </div>`;
        });

        const otherSongs = CANONICAL_SONGS.filter(s => !songsInAlbums.has(s));
        if (otherSongs.length > 0) {
            const songTags = otherSongs.map(_makeSongTag).join('');
            html += `<div class="album-section">
                <div class="album-btn" style="cursor:default;">other / live only</div>
                <div class="song-grid" style="margin:6px 0 16px 0;">${songTags}</div>
            </div>`;
        }
    }

    container.innerHTML = html;
    _syncSortToggles();
    syncSongTags();
    filterSongs();          // keep the filter applied after a re-render
    initYearSlider();
}

// Sets the slider's range once the shows are loaded. Later calls leave the
// chosen years alone (re-rendering the song list used to reset them).
let yearSliderReady = false;
function initYearSlider() {
    if (!shows.length || yearSliderReady) return;
    yearSliderReady = true;
    const years = shows.map(s => parseInt(s.date.slice(0, 4)));
    const minY = Math.min(...years);
    const maxY = Math.max(...years);
    const minEl = document.getElementById('yearMin');
    const maxEl = document.getElementById('yearMax');
    minEl.min = minY; minEl.max = maxY; minEl.value = minY;
    maxEl.min = minY; maxEl.max = maxY; maxEl.value = maxY;
    minEl.addEventListener('pointerdown', () => { minEl.style.zIndex = 2; maxEl.style.zIndex = 1; });
    maxEl.addEventListener('pointerdown', () => { maxEl.style.zIndex = 2; minEl.style.zIndex = 1; });
    updateYearLabel();
    updateOptsSummary();
}

function yearRange() {
    return [parseInt(document.getElementById('yearMin').value), parseInt(document.getElementById('yearMax').value)];
}

function updateYearLabel() {
    const [minVal, maxVal] = yearRange();
    document.getElementById('yearRangeLabel').textContent = minVal === maxVal ? String(minVal) : `${minVal} – ${maxVal}`;
    // fill the track between the thumbs (thumb centres run from 7px to width-7px)
    const [lo, hi] = yearSliderBounds();
    const span = Math.max(1, hi - lo);
    const fill = document.getElementById('yearSliderFill');
    fill.style.left = `calc(7px + (100% - 14px) * ${(minVal - lo) / span})`;
    fill.style.right = `calc(7px + (100% - 14px) * ${(hi - maxVal) / span})`;
}

function onYearSlider() {
    const minEl = document.getElementById('yearMin');
    const maxEl = document.getElementById('yearMax');
    if (parseInt(minEl.value) > parseInt(maxEl.value)) {
        // whichever thumb is being dragged pushes the other
        if (document.activeElement === minEl) maxEl.value = minEl.value; else minEl.value = maxEl.value;
    }
    updateYearLabel();
    onFinderChange();
}

// ─── SONG FINDER ──────────────────────────────────────────────────────────
// Results update live: every change to the songs or options re-runs the
// search (it's cheap) and rewrites the URL. Results render 25 at a time.
let selected = new Set();
let selectedOrder = []; // drag-reorderable ordered list
let dragSrcIdx = null;
let songPositions = {}; // song → 'first' | 'last'
const finderOpts = { mode: 'any', order: 'unordered', sort: 'desc', recordingsOnly: false, hideListened: false };
const FINDER_PAGE = 25;
let finderMatches = [];   // [{idx, label}] for the current search
let finderShown = 0;      // how many of them are rendered
let finderHighlight = null;

function onFinderChange() {
    renderSelectedList();
    updateOptsSummary();
    findShows();
}

function setOptTab(btn, key, value) {
    finderOpts[key] = value;
    btn.closest('.opt-tabs').querySelectorAll('.opt-tab').forEach(b => b.classList.toggle('active', b === btn));
    onFinderChange();
}

const OPT_LABELS = {
    mode: { any: 'any song', all: 'all songs' },
    order: { unordered: 'any order', ordered: 'in order', 'back-to-back': 'back-to-back' },
    sort: { desc: 'newest first', asc: 'oldest first' },
};

// The collapsed options line. Anything changed from the default is bold, and
// "reset options" shows only when something has changed.
function updateOptsSummary() {
    const el = document.getElementById('finderOptsSummary');
    if (!el) return;
    const parts = [];   // [text, changed]
    for (const key of ['mode', 'order', 'sort']) {
        parts.push([OPT_LABELS[key][finderOpts[key]], finderOpts[key] !== FINDER_OPT_VALUES[key][0]]);
    }
    if (yearSliderReady) {
        const [lo, hi] = yearSliderBounds();
        const [min, max] = yearRange();
        const all = min === lo && max === hi;
        parts.push([all ? 'all years' : (min === max ? String(min) : `${min}–${max}`), !all]);
    }
    if (finderOpts.recordingsOnly) parts.push(['with recordings', true]);
    if (finderOpts.hideListened) parts.push(['hiding listened', true]);
    el.innerHTML = parts.map(([text, changed]) => changed ? `<span class="opt-changed">${text}</span>` : text).join(' · ');
    document.getElementById('finderReset').hidden = !parts.some(([, changed]) => changed);
}

// "only shows with recordings" / "hide shows I've listened to" switches
function setFinderFlag(key, on) {
    finderOpts[key] = on;
    const box = document.getElementById(key === 'recordingsOnly' ? 'recordingsOnly' : 'finderHideListened');
    if (box) box.checked = on;
}

function setFinderOpt(key, value) {
    finderOpts[key] = value;
    document.querySelectorAll(`.opt-tab[data-opt="${key}"]`)
        .forEach(b => b.classList.toggle('active', b.dataset.value === value));
}

function resetFinderOpts() {
    for (const [key, values] of Object.entries(FINDER_OPT_VALUES)) setFinderOpt(key, values[0]);
    setFinderFlag('recordingsOnly', false);
    setFinderFlag('hideListened', false);
    const [lo, hi] = yearSliderBounds();
    document.getElementById('yearMin').value = lo;
    document.getElementById('yearMax').value = hi;
    updateYearLabel();
    onFinderChange();
}

function filterSongs() {
    const f = document.getElementById('songSearch').value.toLowerCase().trim();
    const matches = song => !f || song.toLowerCase().includes(f) || (ALIAS_MAP[song] || []).some(a => a.includes(f));
    if (songSortMode === 'alpha') {
        document.querySelectorAll('#alphaSongGrid .song-tag').forEach(tag => {
            tag.style.display = matches(CANONICAL_SONGS[parseInt(tag.dataset.songIdx)]) ? '' : 'none';
        });
    } else {
        document.querySelectorAll('#albumSections .album-section').forEach(section => {
            let anyVisible = false;
            section.querySelectorAll('.song-tag').forEach(tag => {
                const visible = matches(CANONICAL_SONGS[parseInt(tag.dataset.songIdx)]);
                tag.style.display = visible ? '' : 'none';
                if (visible) anyVisible = true;
            });
            section.style.display = anyVisible ? '' : 'none';
        });
    }
}

// Song tags and album buttons reflect `selected`.
function syncSongTags() {
    document.querySelectorAll('#albumSections .song-tag, #alphaSongGrid .song-tag').forEach(tag => {
        tag.classList.toggle('selected', selected.has(CANONICAL_SONGS[parseInt(tag.dataset.songIdx)]));
    });
    document.querySelectorAll('.album-btn[data-album-idx]').forEach(btn => {
        const albumSongs = ALBUMS[parseInt(btn.dataset.albumIdx)].songs.filter(s => CANONICAL_SONGS.includes(s));
        btn.classList.toggle('album-btn-active', albumSongs.length > 0 && albumSongs.every(s => selected.has(s)));
    });
}

function setSongSelected(song, on) {
    if (on && !selected.has(song)) {
        selected.add(song);
        selectedOrder.push(song);
    } else if (!on && selected.has(song)) {
        selected.delete(song);
        selectedOrder.splice(selectedOrder.indexOf(song), 1);
        delete songPositions[song];
    }
}

function toggleSongByIdx(idx) {
    const song = CANONICAL_SONGS[idx];
    setSongSelected(song, !selected.has(song));
    syncSongTags();
    onFinderChange();
}

function toggleAlbumByIdx(albumIdx) {
    const songs = ALBUMS[albumIdx].songs.filter(s => CANONICAL_SONGS.includes(s));
    const allSelected = songs.every(s => selected.has(s));
    for (const song of songs) setSongSelected(song, !allSelected);
    syncSongTags();
    onFinderChange();
}

function removeSelectedSong(song) {
    setSongSelected(song, false);
    syncSongTags();
    onFinderChange();
}

function togglePosition(song, pos) {
    if (songPositions[song] === pos) delete songPositions[song];
    else songPositions[song] = pos;
    onFinderChange();
}

function moveSelected(from, to) {
    const moved = selectedOrder.splice(from, 1)[0];
    selectedOrder.splice(to, 0, moved);
    onFinderChange();
}

function renderSelectedList() {
    const div = document.getElementById('selectedList');
    document.getElementById('finderClear').hidden = selectedOrder.length === 0;
    if (selectedOrder.length === 0) {
        div.innerHTML = '<span class="finder-empty">no songs selected.</span>';
        return;
    }
    const numbered = finderOpts.order === 'ordered' || finderOpts.order === 'back-to-back';
    const canDrag = numbered && selectedOrder.length > 1;
    const help = `<span class="help-icon" tabindex="0">?<span class="help-tooltip"><b>opener / closer:</b> only show sets that start or end with that song.${canDrag ? '<br><br><b>drag</b> songs to change the order they must be played in.' : ''}</span></span>`;
    div.innerHTML = `<span class="selected-label">selected:</span>` + selectedOrder.map((s, i) => {
        const label = numbered ? `${i + 1}. ${s}` : s;
        const pos = songPositions[s];
        const posBtns = `<button class="pos-btn${pos === 'first' ? ' pos-active' : ''}" data-idx="${i}" data-pos="first" title="only sets that open with ${s}" aria-pressed="${pos === 'first'}">opener</button>`
            + `<button class="pos-btn${pos === 'last' ? ' pos-active' : ''}" data-idx="${i}" data-pos="last" title="only sets that close with ${s}" aria-pressed="${pos === 'last'}">closer</button>`;
        const remove = `<button class="sel-remove" data-idx="${i}" title="remove ${s}" aria-label="remove ${s}">×</button>`;
        return `<span class="sel-chip" draggable="${canDrag}" data-idx="${i}">${label}${posBtns}${remove}</span>`;
    }).join('') + help;

    div.querySelectorAll('.pos-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            togglePosition(selectedOrder[parseInt(btn.dataset.idx)], btn.dataset.pos);
        });
    });
    div.querySelectorAll('.sel-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            removeSelectedSong(selectedOrder[parseInt(btn.dataset.idx)]);
        });
    });
    if (!canDrag) return;
    div.querySelectorAll('.sel-chip[draggable="true"]').forEach(el => {
        el.addEventListener('dragstart', e => {
            dragSrcIdx = parseInt(el.dataset.idx);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => el.style.opacity = '0.4', 0);
        });
        el.addEventListener('dragend', () => { el.style.opacity = ''; });
        el.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.style.outline = '2px solid #0066cc';
        });
        el.addEventListener('dragleave', () => { el.style.outline = ''; });
        el.addEventListener('drop', e => {
            e.preventDefault();
            el.style.outline = '';
            const targetIdx = parseInt(el.dataset.idx);
            const from = dragSrcIdx;
            dragSrcIdx = null;
            if (from === null || from === targetIdx) return;
            moveSelected(from, targetIdx);
        });

        el.addEventListener('touchstart', e => {
            if (e.target.closest('button')) return;
            dragSrcIdx = parseInt(el.dataset.idx);
            el.style.opacity = '0.4';
        }, { passive: true });
        el.addEventListener('touchend', e => {
            el.style.opacity = '';
            div.querySelectorAll('.sel-chip').forEach(t => { t.style.outline = ''; });
            if (dragSrcIdx === null) return;
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.sel-chip');
            const from = dragSrcIdx;
            dragSrcIdx = null;
            if (target && target !== el) moveSelected(from, parseInt(target.dataset.idx));
        });
        el.addEventListener('touchmove', e => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            const touch = e.touches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.sel-chip');
            div.querySelectorAll('.sel-chip').forEach(t => { t.style.outline = ''; });
            if (target && target !== el) target.style.outline = '2px solid #0066cc';
        }, { passive: false });
    });
}

function clearAll() {
    selected.clear();
    selectedOrder = [];
    songPositions = {};
    syncSongTags();
    onFinderChange();
}

// "hide shows I've listened to" only makes sense when logged in.
function updateFinderAccountOptions() {
    const row = document.getElementById('finderHideListenedRow');
    if (!row) return;
    row.hidden = !currentUser;
    if (!currentUser && finderOpts.hideListened) {
        setFinderFlag('hideListened', false);
        onFinderChange();
    }
}

// ─── Search in the URL ────────────────────────────────────────────────────
// Each search is written to the hash (#song-finder?songs=moya,glacier&mode=all)
// so it can be shared or bookmarked; defaults are left out to keep links short.
// "hide listened" is personal, so it isn't part of the link.
const FINDER_OPT_VALUES = {
    mode: ['any', 'all'],
    order: ['unordered', 'ordered', 'back-to-back'],
    sort: ['desc', 'asc'],
};

function yearSliderBounds() {
    const el = document.getElementById('yearMin');
    return [parseInt(el.min), parseInt(el.max)];
}

function finderParams() {
    const p = new URLSearchParams();
    if (!selectedOrder.length) return p;
    p.set('songs', selectedOrder.join(','));
    for (const key of Object.keys(FINDER_OPT_VALUES)) {
        if (finderOpts[key] !== FINDER_OPT_VALUES[key][0]) p.set(key, finderOpts[key]);
    }
    if (finderOpts.recordingsOnly) p.set('recordings', '1');
    for (const [song, pos] of Object.entries(songPositions)) p.append(pos, song);
    const [lo, hi] = yearSliderBounds();
    const [min, max] = yearRange();
    if (min !== lo || max !== hi) p.set('years', `${min}-${max}`);
    return p;
}

function restoreFinderFromParams(params) {
    const songs = (params.get('songs') || '').split(',').filter(s => CANONICAL_SONGS.includes(s));
    if (!songs.length) return;
    selected = new Set(songs);
    selectedOrder = [...selected];
    songPositions = {};
    for (const pos of ['first', 'last']) {
        for (const s of params.getAll(pos)) if (selected.has(s)) songPositions[s] = pos;
    }
    for (const [key, values] of Object.entries(FINDER_OPT_VALUES)) {
        setFinderOpt(key, values.includes(params.get(key)) ? params.get(key) : values[0]);
    }
    setFinderFlag('recordingsOnly', params.get('recordings') === '1');
    initYearSlider();
    const [lo, hi] = yearSliderBounds();
    const years = (params.get('years') || '').match(/^(\d{4})-(\d{4})$/);
    const clamp = y => Math.min(hi, Math.max(lo, parseInt(y)));
    document.getElementById('yearMin').value = years ? clamp(years[1]) : lo;
    document.getElementById('yearMax').value = years ? clamp(years[2]) : hi;
    updateYearLabel();
    syncSongTags();
    onFinderChange();
}

// ─── Matching ─────────────────────────────────────────────────────────────
function matchesPositions(show) {
    const entries = Object.entries(songPositions);
    if (entries.length === 0) return true;
    if (show.songs.length === 0) return false;
    const firstCanon = normalizeSong(show.songs[0]);
    const lastCanon = normalizeSong(show.songs[show.songs.length - 1]);
    for (const [song, pos] of entries) {
        const lookupSongs = PART_OF[song] ? [song, PART_OF[song]] : [song];
        if (pos === 'first') {
            if (!lookupSongs.includes(firstCanon)) return false;
        } else {
            if (!lookupSongs.includes(lastCanon)) return false;
        }
    }
    return true;
}

function findShows() {
    const resultsDiv = document.getElementById('finderResults');
    setTabQuery('song-finder', finderParams());
    finderMatches = [];
    finderShown = 0;
    if (selectedOrder.length === 0 || !shows.length) {
        resultsDiv.innerHTML = '';
        return;
    }
    const query = [...selectedOrder];
    const { mode, order: orderMode, sort: sortDir, recordingsOnly, hideListened } = finderOpts;
    const [minYear, maxYear] = yearRange();
    const keep = show => {
        const y = parseInt(show.date.slice(0, 4));
        return y >= minYear && y <= maxYear
            && (!recordingsOnly || show.recordings.length > 0)
            && (!hideListened || !trackingData[show.date]?.listened)
            && matchesPositions(show);
    };

    // Build highlight set: include parent songs so they highlight in results too
    finderHighlight = new Set(selected);
    for (const song of selected) {
        if (PART_OF[song]) finderHighlight.add(PART_OF[song]);
    }

    let heading, emptyMsg;
    if (orderMode === 'ordered' || orderMode === 'back-to-back') {
        const label = orderMode === 'back-to-back' ? 'songs back-to-back' : 'songs in order';
        const results = [];
        for (let i = 0; i < shows.length; i++) {
            if (!keep(shows[i])) continue;
            const canonSongs = shows[i].songs.map(normalizeSong);
            let matches = false;
            if (orderMode === 'ordered') {
                // subsequence check: query songs appear in order, gaps allowed
                let qi = 0;
                for (const canon of canonSongs) {
                    if (canon === query[qi]) qi++;
                    if (qi === query.length) { matches = true; break; }
                }
            } else {
                // back-to-back: query songs appear consecutively in order
                outer: for (let j = 0; j <= canonSongs.length - query.length; j++) {
                    for (let k = 0; k < query.length; k++) {
                        if (canonSongs[j + k] !== query[k]) continue outer;
                    }
                    matches = true;
                    break;
                }
            }
            if (matches) results.push(i);
        }
        results.sort((a, b) => sortDir === 'asc' ? a - b : b - a);
        finderMatches = results.map(idx => ({ idx, label }));
        heading = `shows with ${label}`;
        emptyMsg = `no shows found with those songs ${orderMode === 'back-to-back' ? 'back-to-back' : 'in that order'}.`;
    } else {
        const scores = {};
        for (const song of query) {
            // Expand: if this song is a part of another, also count shows with the parent
            const lookupSongs = PART_OF[song] ? [song, PART_OF[song]] : [song];
            const counted = new Set();
            for (const lookupSong of lookupSongs) {
                for (const idx of (showIndex[lookupSong] || [])) {
                    if (!counted.has(idx)) {
                        counted.add(idx);
                        scores[idx] = (scores[idx] || 0) + 1;
                    }
                }
            }
        }
        const dateSort = sortDir === 'asc' ? (a, b) => +a[0] - +b[0] : (a, b) => +b[0] - +a[0];
        const minScore = mode === 'all' ? query.length : 1;
        finderMatches = Object.entries(scores)
            .sort((a, b) => b[1] - a[1] || dateSort(a, b))
            .filter(([idx, score]) => score >= minScore && keep(shows[idx]))
            .map(([idx, score]) => ({
                idx: +idx,
                label: score === query.length ? `all ${score} songs` : `${score} / ${query.length} songs`,
            }));
        heading = mode === 'all' ? 'shows containing all songs' : 'shows ranked by match';
        emptyMsg = mode === 'all' ? 'no shows found containing all selected songs.' : 'no shows found with these songs.';
    }

    if (finderMatches.length === 0) {
        const narrowed = [];
        if (Object.keys(songPositions).length) narrowed.push('opener/closer');
        const [lo, hi] = yearSliderBounds();
        if (minYear !== lo || maxYear !== hi) narrowed.push('years');
        if (recordingsOnly) narrowed.push('recordings only');
        if (hideListened) narrowed.push('hide listened');
        resultsDiv.innerHTML = `<p class="no-results">${emptyMsg}${narrowed.length ? ` try loosening: ${narrowed.join(', ')}.` : ''}</p>`;
        return;
    }
    resultsDiv.innerHTML = `<h2>${heading} (${finderMatches.length} found)</h2><div id="finderCards"></div><div id="finderMoreWrap"></div>`;
    showMoreFinderResults();
}

function showMoreFinderResults() {
    const cards = document.getElementById('finderCards');
    const next = finderMatches.slice(finderShown, finderShown + FINDER_PAGE);
    cards.insertAdjacentHTML('beforeend', next.map(m => renderShowCard(shows[m.idx], m.label, finderHighlight)).join(''));
    finderShown += next.length;
    const left = finderMatches.length - finderShown;
    document.getElementById('finderMoreWrap').innerHTML = left > 0
        ? `<button class="clear-btn finder-more" onclick="showMoreFinderResults()">${left > FINDER_PAGE
            ? `show ${FINDER_PAGE} more <span class="muted">(${left} left)</span>`
            : `show the last ${left}`}</button>`
        : '';
}
