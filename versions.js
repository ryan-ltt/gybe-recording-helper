// ─── VERSIONS TAB ──────────────────────────────────────────────────────────
let currentVersionSong = null;
let versionSubmitSelectedDate = null;
let songVoteCounts = {};  // song → total votes across all versions (cached)

async function loadSongVoteCounts() {
    if (!sbClient) return;
    const { data } = await sbClient.from('performance_scores').select('song, votes');
    songVoteCounts = {};
    if (data) for (const row of data) songVoteCounts[row.song] = (songVoteCounts[row.song] || 0) + Number(row.votes);
}

function renderVersionsTab() {
    if (currentVersionSong) return;
    const content = document.getElementById('versionsContent');
    const f = (document.getElementById('versionsSearchInput')?.value || '').toLowerCase().trim();

    const makeTag = song => {
        const count = songVoteCounts[song];
        const badge = count ? ` <span style="font-size:10px;color:inherit;">(${count})</span>` : '';
        const idx = CANONICAL_SONGS.indexOf(song);
        return `<div class="song-tag" onclick="openVersionSong(CANONICAL_SONGS[${idx}])">${song}${badge}</div>`;
    };

    let html = '';

    if (songSortMode === 'alpha') {
        const tags = CANONICAL_SONGS.filter(song => {
            if ((showIndex[song] || []).length === 0) return false;
            return !f || song.toLowerCase().includes(f);
        }).map(makeTag).join('');
        html = tags ? `<div class="song-grid">${tags}</div>` : '';
    } else {
        const songsInAlbums = new Set();

        for (const album of ALBUMS) {
            const validSongs = album.songs.filter(s => {
                if (!CANONICAL_SONGS.includes(s)) return false;
                if ((showIndex[s] || []).length === 0) return false;
                return !f || s.toLowerCase().includes(f);
            });
            validSongs.forEach(s => songsInAlbums.add(s));
            if (validSongs.length === 0) continue;

            html += `<div class="album-section">
                <div class="versions-album-header">${album.name} <span class="muted" style="font-size:11px;">(${album.year})</span></div>
                <div class="song-grid" style="margin:6px 0 16px 0;">${validSongs.map(makeTag).join('')}</div>
            </div>`;
        }

        const otherSongs = CANONICAL_SONGS.filter(s => {
            if (songsInAlbums.has(s)) return false;
            if ((showIndex[s] || []).length === 0) return false;
            return !f || s.toLowerCase().includes(f);
        });
        if (otherSongs.length > 0) {
            html += `<div class="album-section">
                <div class="versions-album-header">other / live only</div>
                <div class="song-grid" style="margin:6px 0 16px 0;">${otherSongs.map(makeTag).join('')}</div>
            </div>`;
        }
    }

    content.innerHTML = html || '<p class="no-results">no songs match.</p>';
}

async function openVersionSong(song) {
    currentVersionSong = song;
    versionSubmitSelectedDate = null;
    document.getElementById('versionsSongSearch').style.display = 'none';
    const content = document.getElementById('versionsContent');
    content.innerHTML = `<div class="versions-breadcrumb"><a onclick="closeVersionSong()">← all songs</a></div><p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;color:inherit;">loading...</p>`;
    await loadVersionsForSong(song);
}

function closeVersionSong() {
    currentVersionSong = null;
    versionSubmitSelectedDate = null;
    document.getElementById('versionsSongSearch').style.display = '';
    loadSongVoteCounts().then(renderVersionsTab);
}

async function loadVersionsForSong(song) {
    if (!sbClient) {
        const content = document.getElementById('versionsContent');
        content.innerHTML = `<div class="versions-breadcrumb"><a onclick="closeVersionSong()">← all songs</a></div><p class="no-results">voting is unavailable.</p>`;
        return;
    }
    const content = document.getElementById('versionsContent');

    // Fetch scores, comments, and votes in parallel
    const [scoreRes, commentRes, votesRes] = await Promise.all([
        sbClient.from('performance_scores').select('show_date, votes').eq('song', song),
        sbClient.from('comments').select('id, show_date, body, user_id, created_at').eq('song', song).order('created_at', { ascending: true }),
        sbClient.from('votes').select('show_date, user_id, created_at').eq('song', song).order('created_at', { ascending: true })
    ]);

    const scores = {};
    if (scoreRes.data) for (const row of scoreRes.data) scores[row.show_date] = Number(row.votes);

    // First vote per show_date = submitter
    const submitterIdByDate = {};
    if (votesRes.data) for (const row of votesRes.data) {
        if (!submitterIdByDate[row.show_date]) submitterIdByDate[row.show_date] = row.user_id;
    }

    // Fetch usernames for comment authors + submitters
    const commentData = commentRes.data || [];
    const authorIds = [...new Set([
        ...commentData.map(c => c.user_id),
        ...Object.values(submitterIdByDate)
    ])];
    const usernameMap = {};
    if (authorIds.length > 0) {
        const { data: profileData } = await sbClient.from('profiles').select('user_id, username').in('user_id', authorIds);
        if (profileData) for (const p of profileData) usernameMap[p.user_id] = p.username;
    }

    // Group comments by show_date
    const commentsByDate = {};
    for (const c of commentData) {
        if (!commentsByDate[c.show_date]) commentsByDate[c.show_date] = [];
        commentsByDate[c.show_date].push(c);
    }

    let userVoteDate = null;
    if (currentUser) {
        const { data } = await sbClient.from('votes').select('show_date').eq('user_id', currentUser.id).eq('song', song).single();
        if (data) userVoteDate = data.show_date;
    }

    const submittedDates = Object.keys(scores).sort((a, b) => scores[b] - scores[a] || b.localeCompare(a));

    let html = `<div class="versions-breadcrumb"><a onclick="closeVersionSong()">← all songs</a></div>`;
    html += `<h2 style="margin-top:0;">${song}</h2>`;

    for (const date of submittedDates) {
        const show = showByDate[date];
        const venue = show?.venue || '';
        const voteCount = scores[date];
        const isVoted = userVoteDate === date;
        const recHtml = show?.recordings?.length > 0
            ? `<div class="version-card-rec">recording: ${show.recordings.map((r, i) => `<a href="${r.url}" target="_blank">[${i + 1}] archive.org</a>`).join(' ')}</div>`
            : '';
        const submitterId = submitterIdByDate[date];
        const submitterName = submitterId ? (usernameMap[submitterId] || 'user') : null;
        const submittedByHtml = submitterName ? `<div class="version-card-submitter">submitted by ${submitterName}</div>` : '';
        const voteTitle = isVoted ? 'remove vote' : (currentUser ? 'vote for this version' : 'log in to vote');

        const dateComments = commentsByDate[date] || [];
        let commentsHtml = dateComments.map(c => {
            const username = usernameMap[c.user_id] || 'user';
            const time = new Date(c.created_at).toLocaleDateString();
            const deleteBtn = (currentUser && currentUser.id === c.user_id)
                ? `<span class="comment-delete" onclick='deleteComment(${JSON.stringify(c.id)}, ${JSON.stringify(song)})'>delete</span>`
                : '';
            return `<div class="comment-row"><span class="comment-author">${username}</span><span class="comment-body">${c.body}</span><span class="comment-time">${time}</span>${deleteBtn}</div>`;
        }).join('');

        const commentInputHtml = currentUser
            ? `<div class="comment-input-row"><textarea id="commentInput-${date}" placeholder="add a comment..."></textarea><button onclick='postComment(${JSON.stringify(song)}, ${JSON.stringify(date)})'>post</button></div>`
            : `<p class="comment-login-prompt"><a onclick="showAuthModal()" style="cursor:pointer;color:black;text-decoration:underline;">log in</a> to comment</p>`;

        html += `<div class="version-block">
            <div class="version-card">
                <div class="version-card-info">
                    <span class="version-card-date">${date}</span><span class="version-card-venue">${venue}</span>
                    ${recHtml}
                    ${submittedByHtml}
                </div>
                <div class="vote-area">
                    <button class="vote-btn${isVoted ? ' voted' : ''}" onclick='castVote(${JSON.stringify(song)}, ${JSON.stringify(date)}, ${isVoted})' title="${voteTitle}">▲</button>
                    <span class="vote-count">${voteCount}</span>
                </div>
            </div>
            <div class="comments-section">${commentsHtml}${commentInputHtml}</div>
        </div>`;
    }

    // Add new favourite button + collapsible form
    const addFormInner = !currentUser
        ? `<p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;color:inherit;margin:0;"><a onclick="showAuthModal()" style="cursor:pointer;color:black;text-decoration:underline;">log in</a> to add a favourite.</p>`
        : `${userVoteDate ? `<div class="versions-submit-note">you currently voted for ${userVoteDate}. adding a new favourite will move your vote.</div>` : ''}<div class="show-search-wrap" style="max-width:460px;margin-bottom:8px;">
            <input type="text" class="show-search-box" id="versionSubmitSearch" placeholder="search by date or venue..." oninput='onVersionSubmitSearch(${JSON.stringify(song)})' onblur="closeVersionSubmitDropdown()" autocomplete="off">
            <div class="show-dropdown" id="versionSubmitDropdown"></div>
        </div>
        <div id="versionSubmitSelected"></div>
        <button class="find-btn" style="margin-top:8px;font-size:13px;padding:8px 18px;" onclick='submitVersion(${JSON.stringify(song)})' id="versionSubmitBtn" disabled>submit</button>`;

    html += `<button class="add-favourite-btn" onclick='toggleAddFavourite(${JSON.stringify(song)})'>+ add new favourite</button>
        <div class="add-favourite-form" id="addFavouriteForm">${addFormInner}</div>`;

    content.innerHTML = html;

    if (versionSubmitSelectedDate) setVersionSubmitShow(song, versionSubmitSelectedDate, true);
}

function onVersionSubmitSearch(song) {
    const input = document.getElementById('versionSubmitSearch');
    const dropdown = document.getElementById('versionSubmitDropdown');
    if (!input || !dropdown) return;
    const q = input.value.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }
    const matches = [];
    for (let i = 0; i < shows.length && matches.length < 30; i++) {
        const s = shows[i];
        if (!s.songs?.some(raw => normalizeSong(raw) === song)) continue;
        if (s.date.includes(q) || s.venue.toLowerCase().includes(q)) matches.push(i);
    }
    if (matches.length === 0) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = matches.map(i =>
        `<div class="show-dropdown-item" onmousedown='setVersionSubmitShow(${JSON.stringify(song)}, ${JSON.stringify(shows[i].date)})'>${shows[i].date}${shows[i].venue ? ' - ' + shows[i].venue : ''}</div>`
    ).join('');
    dropdown.style.display = 'block';
}

function closeVersionSubmitDropdown() {
    setTimeout(() => { const d = document.getElementById('versionSubmitDropdown'); if (d) d.style.display = 'none'; }, 150);
}

function setVersionSubmitShow(song, date, silent) {
    versionSubmitSelectedDate = date;
    const show = showByDate[date];
    const input = document.getElementById('versionSubmitSearch');
    if (input && !silent) input.value = '';
    const selectedDiv = document.getElementById('versionSubmitSelected');
    if (selectedDiv) {
        selectedDiv.innerHTML = `<div class="seed-tag" style="margin-bottom:0;">${date}${show?.venue ? ' - ' + show.venue : ''}<span class="remove" onclick="clearVersionSubmitShow()">×</span></div>`;
    }
    const btn = document.getElementById('versionSubmitBtn');
    if (btn) btn.disabled = false;
    const dropdown = document.getElementById('versionSubmitDropdown');
    if (dropdown && !silent) dropdown.style.display = 'none';
}

function clearVersionSubmitShow() {
    versionSubmitSelectedDate = null;
    const sel = document.getElementById('versionSubmitSelected');
    if (sel) sel.innerHTML = '';
    const btn = document.getElementById('versionSubmitBtn');
    if (btn) btn.disabled = true;
}

async function submitVersion(song) {
    if (!versionSubmitSelectedDate || !currentUser || !sbClient) return;
    const btn = document.getElementById('versionSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'submitting...'; }
    await castVote(song, versionSubmitSelectedDate, false);
}

function toggleAddFavourite(song) {
    if (!currentUser) { showAuthModal(); return; }
    const form = document.getElementById('addFavouriteForm');
    if (form) form.classList.toggle('open');
}

async function postComment(song, showDate) {
    if (!sbClient || !currentUser) return;
    const textarea = document.getElementById(`commentInput-${showDate}`);
    if (!textarea) return;
    const body = textarea.value.trim();
    if (!body) return;
    textarea.disabled = true;
    const { error } = await sbClient.from('comments').insert({ user_id: currentUser.id, song, show_date: showDate, body });
    if (error) { console.error('comment error:', error); textarea.disabled = false; return; }
    await loadVersionsForSong(song);
}

async function deleteComment(commentId, song) {
    if (!sbClient || !currentUser) return;
    await sbClient.from('comments').delete().eq('id', commentId).eq('user_id', currentUser.id);
    await loadVersionsForSong(song);
}

async function castVote(song, showDate, isCurrentlyVoted) {
    if (!sbClient) return;
    if (!currentUser) { showAuthModal(); return; }

    if (isCurrentlyVoted) {
        await sbClient.from('votes').delete().eq('user_id', currentUser.id).eq('song', song);
    } else {
        await sbClient.from('votes').delete().eq('user_id', currentUser.id).eq('song', song);
        const { error } = await sbClient.from('votes').insert({ user_id: currentUser.id, song, show_date: showDate });
        if (error) { console.error('vote error:', error); return; }
    }
    await loadVersionsForSong(song);
}

