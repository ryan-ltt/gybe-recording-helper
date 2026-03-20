let songSortMode = localStorage.getItem('songSortMode') || 'alpha';

function setSongSortMode(mode) {
    songSortMode = mode;
    localStorage.setItem('songSortMode', mode);
    _syncSortToggles();
    buildAlbumSections();
    if (document.getElementById('tab-versions').classList.contains('active')) {
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
    return `<div class="${cls}" data-song-idx="${idx}" onclick="toggleSongByIdx(${idx}, this)">${song}</div>`;
}

function buildAlbumSections() {
    const container = document.getElementById('albumSections');
    let html = '';

    const alphaGrid = document.getElementById('alphaSongGrid');
    if (songSortMode === 'alpha') {
        const albumBtns = ALBUMS.map((album, albumIdx) => {
            const validSongs = album.songs.filter(s => CANONICAL_SONGS.includes(s));
            if (validSongs.length === 0) return '';
            const allSelected = validSongs.every(s => selected.has(s));
            const btnCls = 'album-btn' + (allSelected ? ' album-btn-active' : '');
            return `<button class="${btnCls}" data-album-idx="${albumIdx}" onclick="toggleAlbumByIdx(this)">${album.name} <span class="muted" style="font-size:11px;">(${album.year})</span></button>`;
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

            const allSelected = validSongs.length > 0 && validSongs.every(s => selected.has(s));
            const btnCls = 'album-btn' + (allSelected ? ' album-btn-active' : '');
            const songTags = validSongs.map(_makeSongTag).join('');

            html += `<div class="album-section">
                <button class="${btnCls}" data-album-idx="${albumIdx}" onclick="toggleAlbumByIdx(this)">${album.name} <span class="muted" style="font-size:11px;">(${album.year})</span></button>
                <div class="song-grid" style="margin:6px 0 16px 0;">${songTags}</div>
            </div>`;
        });

        const otherSongs = CANONICAL_SONGS.filter(s => !songsInAlbums.has(s));
        if (otherSongs.length > 0) {
            const songTags = otherSongs.map(_makeSongTag).join('');
            html += `<div class="album-section">
                <div class="album-section-label">other / live only</div>
                <div class="song-grid" style="margin:6px 0 16px 0;">${songTags}</div>
            </div>`;
        }
    }

    container.innerHTML = html;
    _syncSortToggles();
    initYearSlider();
}

function initYearSlider() {
    if (!shows.length) return;
    const years = shows.map(s => parseInt(s.date.slice(0, 4)));
    const minY = Math.min(...years);
    const maxY = Math.max(...years);
    const minEl = document.getElementById('yearMin');
    const maxEl = document.getElementById('yearMax');
    minEl.min = minY; minEl.max = maxY; minEl.value = minY;
    maxEl.min = minY; maxEl.max = maxY; maxEl.value = maxY;
    document.getElementById('yearRangeLabel').textContent = `${minY} – ${maxY}`;
    document.getElementById('yearRangeWrap').style.display = 'flex';
    minEl.addEventListener('pointerdown', () => { minEl.style.zIndex = 2; maxEl.style.zIndex = 1; });
    maxEl.addEventListener('pointerdown', () => { maxEl.style.zIndex = 2; minEl.style.zIndex = 1; });
}

function onYearSlider() {
    const minEl = document.getElementById('yearMin');
    const maxEl = document.getElementById('yearMax');
    let minVal = parseInt(minEl.value);
    let maxVal = parseInt(maxEl.value);
    if (minVal > maxVal) { minEl.value = maxVal; minVal = maxVal; }
    if (maxVal < minVal) { maxEl.value = minVal; maxVal = minVal; }
    document.getElementById('yearRangeLabel').textContent = minVal === maxVal ? String(minVal) : `${minVal} – ${maxVal}`;
}

function toggleAlbumByIdx(btn) {
    const albumIdx = parseInt(btn.dataset.albumIdx);
    const songs = ALBUMS[albumIdx].songs.filter(s => CANONICAL_SONGS.includes(s));
    const allSelected = songs.every(s => selected.has(s));
    if (allSelected) {
        for (const song of songs) {
            selected.delete(song);
            selectedOrder.splice(selectedOrder.indexOf(song), 1);
        }
        btn.classList.remove('album-btn-active');
    } else {
        for (const song of songs) {
            if (!selected.has(song)) {
                selected.add(song);
                selectedOrder.push(song);
            }
        }
        btn.classList.add('album-btn-active');
    }
    songs.forEach(song => {
        const idx = CANONICAL_SONGS.indexOf(song);
        const tag = document.querySelector(`#albumSections .song-tag[data-song-idx="${idx}"], #alphaSongGrid .song-tag[data-song-idx="${idx}"]`);
        if (tag) tag.classList.toggle('selected', selected.has(song));
    });
    renderSelectedList();
}

// ─── SONG FINDER ──────────────────────────────────────────────────────────
let selected = new Set();
let selectedOrder = []; // drag-reorderable ordered list
let dragSrcIdx = null;
let songPositions = {}; // song → 'first' | 'last'
const finderOpts = { mode: 'any', order: 'unordered', sort: 'desc', recordingsOnly: false };

function setOptTab(btn, key, value) {
    finderOpts[key] = value;
    btn.closest('.opt-tabs').querySelectorAll('.opt-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}


function filterSongs() {
    const f = document.getElementById('songSearch').value.toLowerCase().trim();
    if (songSortMode === 'alpha') {
        document.querySelectorAll('#alphaSongGrid .song-tag').forEach(tag => {
            const idx = parseInt(tag.dataset.songIdx);
            const song = CANONICAL_SONGS[idx];
            const matchesCanon = song.toLowerCase().includes(f);
            const matchesAlias = f && (ALIAS_MAP[song] || []).some(a => a.includes(f));
            tag.style.display = (!f || matchesCanon || matchesAlias) ? '' : 'none';
        });
    } else {
        document.querySelectorAll('#albumSections .album-section').forEach(section => {
            let anyVisible = false;
            section.querySelectorAll('.song-tag').forEach(tag => {
                const idx = parseInt(tag.dataset.songIdx);
                const song = CANONICAL_SONGS[idx];
                const matchesCanon = song.toLowerCase().includes(f);
                const matchesAlias = f && (ALIAS_MAP[song] || []).some(a => a.includes(f));
                const visible = !f || matchesCanon || matchesAlias;
                tag.style.display = visible ? '' : 'none';
                if (visible) anyVisible = true;
            });
            section.style.display = anyVisible ? '' : 'none';
        });
    }
}

function toggleSongByIdx(idx, el) {
    const song = CANONICAL_SONGS[idx];
    if (selected.has(song)) {
        selected.delete(song);
        selectedOrder.splice(selectedOrder.indexOf(song), 1);
        delete songPositions[song];
        el.classList.remove('selected');
    } else {
        selected.add(song);
        selectedOrder.push(song);
        el.classList.add('selected');
    }
    document.querySelectorAll('.album-btn[data-album-idx]').forEach(btn => {
        const aIdx = parseInt(btn.dataset.albumIdx);
        const albumSongs = ALBUMS[aIdx].songs.filter(s => CANONICAL_SONGS.includes(s));
        btn.classList.toggle('album-btn-active', albumSongs.length > 0 && albumSongs.every(s => selected.has(s)));
    });
    renderSelectedList();
}

function togglePosition(song, pos) {
    if (songPositions[song] === pos) {
        delete songPositions[song];
    } else {
        songPositions[song] = pos;
    }
    renderSelectedList();
}

function renderSelectedList() {
    const div = document.getElementById('selectedList');
    if (selectedOrder.length === 0) { div.innerHTML = ''; return; }
    const orderMode = finderOpts.order;
    const numbered = orderMode === 'ordered' || orderMode === 'back-to-back';
    const dragHint = (numbered && selectedOrder.length > 1) ? '<div class="muted" style="font-size:11px;font-family:Monaco,\'JetBrains Mono\',monospace;margin-bottom:4px;">drag to reorder</div>' : '';
    div.innerHTML = dragHint + 'selected: ' + selectedOrder.map((s, i) => {
        const label = numbered ? `${i + 1}. ${s}` : s;
        const pos = songPositions[s];
        const posBtns = `<button class="pos-btn${pos === 'first' ? ' pos-active' : ''}" data-idx="${i}" data-pos="first" title="must open the setlist">first</button><button class="pos-btn${pos === 'last' ? ' pos-active' : ''}" data-idx="${i}" data-pos="last" title="must close the setlist">last</button>`;
        return `<span draggable="true" data-idx="${i}" style="cursor:grab;">${label}${posBtns}</span>`;
    }).join('');
    div.querySelectorAll('.pos-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const song = selectedOrder[parseInt(btn.dataset.idx)];
            togglePosition(song, btn.dataset.pos);
        });
    });
    div.querySelectorAll('span[draggable]').forEach(el => {
        el.addEventListener('dragstart', e => {
            dragSrcIdx = parseInt(el.dataset.idx);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => el.style.opacity = '0.4', 0);
        });
        el.addEventListener('dragend', () => { el.style.opacity = ''; });
        el.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.style.outline = '2px solid white';
        });
        el.addEventListener('dragleave', () => { el.style.outline = ''; });
        el.addEventListener('drop', e => {
            e.preventDefault();
            el.style.outline = '';
            const targetIdx = parseInt(el.dataset.idx);
            if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
            const moved = selectedOrder.splice(dragSrcIdx, 1)[0];
            selectedOrder.splice(targetIdx, 0, moved);
            dragSrcIdx = null;
            renderSelectedList();
        });
    });
}

function clearAll() {
    selected.clear();
    selectedOrder = [];
    songPositions = {};
    document.querySelectorAll('#albumSections .song-tag.selected, #alphaSongGrid .song-tag.selected').forEach(tag => tag.classList.remove('selected'));
    document.querySelectorAll('.album-btn-active').forEach(btn => btn.classList.remove('album-btn-active'));
    renderSelectedList();
    document.getElementById('finderResults').innerHTML = '';
}

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
    if (selectedOrder.length === 0) {
        resultsDiv.innerHTML = '<p class="no-results">select at least one song.</p>';
        return;
    }
    const query = [...selectedOrder];
    const { mode, order: orderMode, sort: sortDir, recordingsOnly } = finderOpts;
    const minYear = parseInt(document.getElementById('yearMin').value);
    const maxYear = parseInt(document.getElementById('yearMax').value);
    const inYearRange = show => { const y = parseInt(show.date.slice(0, 4)); return y >= minYear && y <= maxYear; };

    // Build highlight set: include parent songs so they highlight in results too
    const highlightSet = new Set(selected);
    for (const song of selected) {
        if (PART_OF[song]) highlightSet.add(PART_OF[song]);
    }

    if (orderMode === 'ordered' || orderMode === 'back-to-back') {
        const results = [];
        for (let i = 0; i < shows.length; i++) {
            if (recordingsOnly && !shows[i].recordings.length) continue;
            if (!inYearRange(shows[i])) continue;
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

        const posFiltered = results.filter(idx => matchesPositions(shows[idx]));
        posFiltered.sort((a, b) => sortDir === 'asc' ? a - b : b - a);
        if (posFiltered.length === 0) {
            resultsDiv.innerHTML = `<p class="no-results">no shows found with those songs ${orderMode === 'back-to-back' ? 'back-to-back' : 'in that order'}${Object.keys(songPositions).length ? ' matching position constraints' : ''}.</p>`;
            return;
        }
        const label = orderMode === 'back-to-back' ? 'songs back-to-back' : 'songs in order';
        let html = `<h2>shows with ${label} (${posFiltered.length} found)</h2>`;
        for (const idx of posFiltered) {
            html += renderShowCard(shows[idx], label, highlightSet);
        }
        resultsDiv.innerHTML = html;
        return;
    }

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
    const ranked = Object.entries(scores)
        .sort((a, b) => b[1] - a[1] || dateSort(a, b))
        .filter(([idx, score]) => score >= minScore && (!recordingsOnly || shows[idx].recordings.length > 0) && matchesPositions(shows[idx]) && inYearRange(shows[idx]));

    if (ranked.length === 0) {
        resultsDiv.innerHTML = `<p class="no-results">${mode === 'all' ? 'no shows found containing all selected songs.' : 'no shows found with these songs.'}</p>`;
        return;
    }

    const modeLabel = mode === 'all' ? 'containing all songs' : 'ranked by match';
    let html = `<h2>shows ${modeLabel} (${ranked.length} found)</h2>`;
    for (const [idx, score] of ranked) {
        const matchLabel = score === query.length ? `all ${score} songs` : `${score} / ${query.length} songs`;
        html += renderShowCard(shows[idx], matchLabel, highlightSet);
    }
    resultsDiv.innerHTML = html;
}

