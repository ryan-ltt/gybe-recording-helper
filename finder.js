function buildAlbumSections() {
    const container = document.getElementById('albumSections');
    const btns = ALBUMS.map(album => {
        const validSongs = album.songs.filter(s => CANONICAL_SONGS.includes(s));
        if (validSongs.length === 0) return '';
        return `<button class="album-btn" onclick='toggleAlbum(${JSON.stringify(validSongs)}, this)'>${album.name} <span class="muted" style="font-size:11px;">(${album.year})</span></button>`;
    }).join('');
    container.innerHTML = `<div class="song-grid" style="margin-bottom:0;">${btns}</div>`;
}

function toggleAlbum(songs, btn) {
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
    renderSongGrid(document.getElementById('songSearch').value);
    renderSelectedList();
}

// ─── SONG FINDER ──────────────────────────────────────────────────────────
let selected = new Set();
let selectedOrder = []; // drag-reorderable ordered list
let dragSrcIdx = null;

function renderSongGrid(filter) {
    const grid = document.getElementById('songGrid');
    grid.innerHTML = '';
    const f = (filter || '').toLowerCase().trim();
    for (const song of CANONICAL_SONGS) {
        const matchesCanon = song.toLowerCase().includes(f);
        const matchesAlias = f && (ALIAS_MAP[song] || []).some(a => a.includes(f));
        if (f && !matchesCanon && !matchesAlias) continue;
        const tag = document.createElement('div');
        tag.className = 'song-tag' + (selected.has(song) ? ' selected' : '');
        tag.textContent = song;
        tag.onclick = () => toggleSong(song, tag);
        grid.appendChild(tag);
    }
}

function filterSongs() {
    renderSongGrid(document.getElementById('songSearch').value);
}

function toggleSong(song, el) {
    if (selected.has(song)) {
        selected.delete(song);
        selectedOrder.splice(selectedOrder.indexOf(song), 1);
        el.classList.remove('selected');
    } else {
        selected.add(song);
        selectedOrder.push(song);
        el.classList.add('selected');
    }
    renderSelectedList();
}

function renderSelectedList() {
    const div = document.getElementById('selectedList');
    if (selectedOrder.length === 0) { div.innerHTML = ''; return; }
    const orderMode = document.querySelector('input[name="order"]:checked')?.value;
    const numbered = orderMode === 'ordered' || orderMode === 'back-to-back';
    const dragHint = (numbered && selectedOrder.length > 1) ? '<div class="muted" style="font-size:11px;font-family:Monaco,\'JetBrains Mono\',monospace;margin-bottom:4px;">drag to reorder</div>' : '';
    div.innerHTML = dragHint + 'selected: ' + selectedOrder.map((s, i) => {
        const label = numbered ? `${i + 1}. ${s}` : s;
        return `<span draggable="true" data-idx="${i}" style="cursor:grab;">${label}</span>`;
    }).join('');
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
    renderSongGrid(document.getElementById('songSearch').value);
    renderSelectedList();
    document.getElementById('finderResults').innerHTML = '';
}

function findShows() {
    const resultsDiv = document.getElementById('finderResults');
    if (selectedOrder.length === 0) {
        resultsDiv.innerHTML = '<p class="no-results">select at least one song.</p>';
        return;
    }
    const query = [...selectedOrder];
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const orderMode = document.querySelector('input[name="order"]:checked').value;
    const recordingsOnly = document.getElementById('recordingsOnly').checked;

    // Build highlight set: include parent songs so they highlight in results too
    const highlightSet = new Set(selected);
    for (const song of selected) {
        if (PART_OF[song]) highlightSet.add(PART_OF[song]);
    }

    if (orderMode === 'ordered' || orderMode === 'back-to-back') {
        const results = [];
        for (let i = 0; i < shows.length; i++) {
            if (recordingsOnly && !shows[i].recordings.length) continue;
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

        if (results.length === 0) {
            resultsDiv.innerHTML = `<p class="no-results">no shows found with those songs ${orderMode === 'back-to-back' ? 'back-to-back' : 'in that order'}.</p>`;
            return;
        }
        const label = orderMode === 'back-to-back' ? 'songs back-to-back' : 'songs in order';
        let html = `<h2>shows with ${label} (${results.length} found)</h2>`;
        for (const idx of results) {
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

    const minScore = mode === 'all' ? query.length : 1;
    const ranked = Object.entries(scores)
        .sort((a, b) => b[1] - a[1] || b[0] - a[0])
        .filter(([idx, score]) => score >= minScore && (!recordingsOnly || shows[idx].recordings.length > 0));

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

