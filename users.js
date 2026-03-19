// ─── USERS TAB ───────────────────────────────────────────────────────────────
let usersLoaded = false;
let usersData = []; // [{ user_id, username, tracking: {date: {attended,listened}} }]
let userTabState = {}; // userId -> 'attended'|'listened'

async function loadUsers() {
    usersLoaded = true;
    const container = document.getElementById('usersContainer');

    const { data: profiles, error } = sbClient
        ? await sbClient.from('profiles').select('user_id, username, created_at').eq('is_public', true).order('created_at', { ascending: true })
        : { data: null, error: 'no client' };

    if (error) {
        container.innerHTML = `<p class="error" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:13px;">error loading users: ${error.message || JSON.stringify(error)}</p>`;
        return;
    }
    if (!profiles || profiles.length === 0) {
        container.innerHTML = `<p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:13px;color:inherit;">no public profiles yet.</p>`;
        return;
    }

    const ids = profiles.map(p => p.user_id);
    const allTracking = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    while (true) {
        const { data: page } = await sbClient.from('show_tracking')
            .select('user_id, show_date, attended, listened, listened_notes, attended_notes')
            .in('user_id', ids)
            .range(from, from + PAGE_SIZE - 1);
        if (!page || page.length === 0) break;
        allTracking.push(...page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    const trackingByUser = {};
    for (const row of allTracking) {
        if (!trackingByUser[row.user_id]) trackingByUser[row.user_id] = {};
        trackingByUser[row.user_id][row.show_date] = { attended: row.attended, listened: row.listened, listened_notes: row.listened_notes || '', attended_notes: row.attended_notes || '' };
    }

    const { data: allVotes } = await sbClient.from('votes').select('user_id, song, show_date').in('user_id', ids);
    const votesByUser = {};
    if (allVotes) for (const row of allVotes) {
        if (!votesByUser[row.user_id]) votesByUser[row.user_id] = [];
        votesByUser[row.user_id].push({ song: row.song, show_date: row.show_date });
    }

    const { data: allPicks } = await sbClient.from('user_picks').select('user_id, show_date, rank, note').in('user_id', ids).order('rank', { ascending: true });
    const picksByUser = {};
    if (allPicks) for (const row of allPicks) {
        if (!picksByUser[row.user_id]) picksByUser[row.user_id] = [];
        picksByUser[row.user_id].push({ show_date: row.show_date, rank: row.rank, note: row.note });
    }

    usersData = profiles.map(p => ({ ...p, tracking: trackingByUser[p.user_id] || {}, votes: votesByUser[p.user_id] || [], picks: picksByUser[p.user_id] || [] }));

    document.getElementById('usersControls').style.display = 'flex';
    if (!currentUser) {
        document.getElementById('usersLoginNote').style.display = '';
    } else if (currentUser && !profiles.some(p => p.user_id === currentUser.id)) {
        document.getElementById('usersMakePublicNote').style.display = '';
    }

    renderUsers(usersData);
}

function renderUsers(profiles) {
    const container = document.getElementById('usersContainer');
    if (profiles.length === 0) {
        container.innerHTML = `<p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:13px;color:inherit;">no matching users.</p>`;
        return;
    }
    container.innerHTML = profiles.map(p => {
        const attendedDates = Object.entries(p.tracking).filter(([, td]) => td.attended).map(([d]) => d);
        const listenedDates = Object.entries(p.tracking).filter(([, td]) => td.listened).map(([d]) => d);
        const attendedCount = attendedDates.length;
        const listenedCount = listenedDates.length;
        const uid = p.user_id.replace(/-/g, '');
        return `<div class="era-block" id="ucard-${uid}">
            <div class="era-header" onclick="toggleUser('${uid}')">
                <div><div class="era-title">${p.username}</div></div>
                <div style="display:flex;align-items:center;gap:16px;">
                    <div class="era-meta">${attendedCount} attended · ${listenedCount} listened</div>
                    <div class="era-toggle" id="utoggle-${uid}">+</div>
                </div>
            </div>
            <div class="era-body" id="ubody-${uid}"></div>
        </div>`;
    }).join('');
}

function toggleUser(uid) {
    const body = document.getElementById('ubody-' + uid);
    const tgl = document.getElementById('utoggle-' + uid);
    const isOpen = body.classList.toggle('open');
    tgl.textContent = isOpen ? '−' : '+';
    if (isOpen && !body.dataset.rendered) {
        body.dataset.rendered = '1';
        userTabState[uid] = userTabState[uid] || 'attended';
        renderUserBody(uid);
    }
}

function renderUserBody(uid) {
    const body = document.getElementById('ubody-' + uid);
    const profile = usersData.find(p => p.user_id.replace(/-/g, '') === uid);
    if (!profile) return;
    const activeTab = userTabState[uid] || 'attended';

    const shows = Object.entries(profile.tracking)
        .filter(([, td]) => td[activeTab])
        .map(([date]) => showByDate[date])
        .filter(Boolean)
        .sort((a, b) => a.date.localeCompare(b.date));

    const attendedCount = Object.values(profile.tracking).filter(td => td.attended).length;
    const listenedCount = Object.values(profile.tracking).filter(td => td.listened).length;
    const votesCount = profile.votes.length;
    const picksCount = profile.picks ? profile.picks.length : 0;

    let listHtml;
    if (activeTab === 'picks') {
        const picks = (profile.picks || []).sort((a, b) => a.rank - b.rank);
        if (picks.length === 0) {
            listHtml = `<p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;color:inherit;margin:0;">no picks yet.</p>`;
        } else {
            listHtml = `<ol style="list-style:none;padding:0;margin:0;">${picks.map((pick, i) => {
                const show = showByDate[pick.show_date];
                const venue = show ? show.venue : '';
                const bestId = BEST_RECORDINGS[pick.show_date];
                const recs = show && show.recordings ? show.recordings : [];
                const recsHtml = recs.length > 0 ? `<div class="era-show-recs" style="padding-left:20px;">${recs.map((r, ri) => `<a href="${r.url}" target="_blank"${bestId === r.id ? ' style="font-weight:bold"' : ''}>[${ri + 1}]</a>`).join('')}</div>` : '';
                const noteHtml = pick.note ? `<div class="muted" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:11px;margin-top:3px;padding-left:20px;">${pick.note}</div>` : '';
                return `<li style="padding:8px 0;border-bottom:1px solid #eee;font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;"><span class="muted" style="display:inline-block;width:20px;text-align:right;">${i + 1}.</span> <strong>${pick.show_date}</strong>${venue ? ` <span class="muted">— ${venue}</span>` : ''}${recsHtml}${noteHtml}</li>`;
            }).join('')}</ol>`;
        }
    } else if (activeTab === 'votes') {
        if (votesCount === 0) {
            listHtml = `<p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;color:inherit;margin:0;">no votes yet.</p>`;
        } else {
            const byYear = {};
            for (const v of profile.votes) {
                const y = v.show_date.slice(0, 4);
                if (!byYear[y]) byYear[y] = [];
                byYear[y].push(v);
            }
            listHtml = Object.keys(byYear).sort().map(year => {
                const votes = byYear[year].sort((a, b) => a.song.localeCompare(b.song));
                const rows = votes.map(v => {
                    const show = showByDate[v.show_date];
                    const venue = show ? show.venue : '';
                    const date = v.show_date.replace(/[a-z]$/, '');
                    return `<div class="era-show-row" style="cursor:default;">
                        <span class="era-show-date">${date}</span>
                        <span class="era-show-venue">${v.song}${venue ? ` <span class="dim" style="font-size:10px;">- ${venue}</span>` : ''}</span>
                    </div>`;
                }).join('');
                const count = votes.length;
                const open = votesCount < 10;
                return `<div class="user-year-group">
                    <div class="user-year-header" onclick="toggleUserYear('${uid}','${year}','votes')">
                        <div class="user-year-label">${year}</div>
                        <div class="user-year-meta">
                            <span>${count} vote${count !== 1 ? 's' : ''}</span>
                            <span id="uytgl-${uid}-${year}-votes">${open ? '−' : '+'}</span>
                        </div>
                    </div>
                    <div class="user-year-body${open ? ' open' : ''}" id="uybody-${uid}-${year}-votes">
                        ${rows}
                    </div>
                </div>`;
            }).join('');
        }
    } else if (shows.length === 0) {
        listHtml = `<p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;color:inherit;margin:0;">no shows marked as ${activeTab}.</p>`;
    } else {
        const byYear = {};
        for (const s of shows) {
            const y = s.date.slice(0, 4);
            if (!byYear[y]) byYear[y] = [];
            byYear[y].push(s);
        }
        const noteField = activeTab === 'listened' ? 'listened_notes' : 'attended_notes';
        listHtml = Object.keys(byYear).sort().map(year => {
            const rows = byYear[year].map(s => {
                const bestId = BEST_RECORDINGS[s.date];
                const recsHtml = s.recordings.map((r, i) =>
                    `<a href="${r.url}" target="_blank"${bestId === r.id ? ' style="font-weight:bold"' : ''}>[${i + 1}]</a>`
                ).join('');
                const mainSongs = s.songs.filter(song => !/\(soundcheck\)/i.test(song));
                const soundcheckSongs = s.songs.filter(song => /\(soundcheck\)/i.test(song));
                let setlistText = '';
                if (soundcheckSongs.length > 0) {
                    setlistText += `<span class="muted" style="font-size:10px;display:block;margin-bottom:2px;">soundcheck</span>` +
                        soundcheckSongs.map(song => `<span class="dim">${song.replace(/\s*\(soundcheck\)/i, '')}</span>`).join('<br>') +
                        `<br><span class="muted" style="font-size:10px;display:block;margin-top:6px;margin-bottom:2px;">setlist</span>`;
                }
                setlistText += mainSongs.join('<br>');
                if (s.note) setlistText += `<br><span class="muted" style="padding-left:16px;font-size:11px;white-space:pre-line;">${s.note}</span>`;
                const userNote = profile.tracking[s.date]?.[noteField] || '';
                const id = `u${uid}-sl-` + s.date.replace(/\W/g, '-');
                const hasSetlist = s.songs.length > 0;
                const hasUserNote = !!userNote;
                const noteHtml = hasUserNote ? `<div style="margin-bottom:${hasSetlist ? '8px' : '0'};padding-bottom:${hasSetlist ? '6px' : '0'};border-bottom:${hasSetlist ? '1px solid #eee' : 'none'};font-family:Monaco,'JetBrains Mono',monospace;font-size:11px;color:inherit;line-height:1.6;white-space:pre-wrap;">${userNote.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : '';
                return `<div class="era-show-row"${(hasSetlist || hasUserNote) ? ` onclick="toggleShowSetlist('${id}')" style="cursor:pointer;"` : ''}>
                    <span class="era-show-date">${s.date.replace(/[a-z]$/, '')}</span>
                    <span class="era-show-venue">${s.venue}${hasUserNote ? ' <span class="dim" style="font-size:10px;" title="user has left a note for this show">[n]</span>' : ''}</span>
                    <span class="era-show-recs" onclick="event.stopPropagation()">${recsHtml}</span>
                    <span class="era-show-toggle"${(hasSetlist || hasUserNote) ? ` id="tgl-${id}"` : ' style="visibility:hidden"'}>+</span>
                </div>
                ${(hasSetlist || hasUserNote) ? `<div class="era-show-setlist" id="${id}">${noteHtml}${hasSetlist ? setlistText : ''}</div>` : ''}`;
            }).join('');
            const userCount = byYear[year].length;
            const totalInYear = activeTab === 'listened' ? (showsWithRecordingsByYear[year] || 0) : null;
            const countLabel = totalInYear !== null ? `${userCount} / ${totalInYear} show${totalInYear !== 1 ? 's' : ''}` : `${userCount} show${userCount !== 1 ? 's' : ''}`;
            const open = shows.length < 10;
            const complete = totalInYear !== null && totalInYear > 0 && userCount === totalInYear;
            return `<div class="user-year-group${complete ? ' complete' : ''}">
                <div class="user-year-header" onclick="toggleUserYear('${uid}','${year}','${activeTab}')">
                    <div class="user-year-label">${year}</div>
                    <div class="user-year-meta">
                        <span>${countLabel}</span>
                        <span id="uytgl-${uid}-${year}-${activeTab}">${open ? '−' : '+'}</span>
                    </div>
                </div>
                <div class="user-year-body${open ? ' open' : ''}" id="uybody-${uid}-${year}-${activeTab}">
                    ${rows}
                </div>
            </div>`;
        }).join('');
    }

    body.innerHTML = `
        <div style="display:flex;gap:0;border-bottom:2px solid black;margin-bottom:12px;">
            <button style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;padding:5px 14px;border:none;background:none;cursor:pointer;border-bottom:3px solid ${activeTab==='attended'?'black':'transparent'};margin-bottom:-2px;${activeTab==='attended'?'font-weight:bold;':''}" onclick="switchUserTab('${uid}','attended')">attended (${attendedCount})</button>
            <button style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;padding:5px 14px;border:none;background:none;cursor:pointer;border-bottom:3px solid ${activeTab==='listened'?'black':'transparent'};margin-bottom:-2px;${activeTab==='listened'?'font-weight:bold;':''}" onclick="switchUserTab('${uid}','listened')">listened (${listenedCount})</button>
            <button style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;padding:5px 14px;border:none;background:none;cursor:pointer;border-bottom:3px solid ${activeTab==='votes'?'black':'transparent'};margin-bottom:-2px;${activeTab==='votes'?'font-weight:bold;':''}" onclick="switchUserTab('${uid}','votes')">votes (${votesCount})</button>
            <button style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;padding:5px 14px;border:none;background:none;cursor:pointer;border-bottom:3px solid ${activeTab==='picks'?'black':'transparent'};margin-bottom:-2px;${activeTab==='picks'?'font-weight:bold;':''}" onclick="switchUserTab('${uid}','picks')">picks (${picksCount})</button>
        </div>
        ${listHtml}
        ${profile.created_at ? `<div class="dim" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:11px;margin-top:16px;">member since ${profile.created_at.slice(0,10)}</div>` : ''}`;
}

function switchUserTab(uid, tab) {
    userTabState[uid] = tab;
    renderUserBody(uid);
}

function toggleUserYear(uid, year, tab) {
    const body = document.getElementById(`uybody-${uid}-${year}-${tab}`);
    const tgl = document.getElementById(`uytgl-${uid}-${year}-${tab}`);
    if (!body) return;
    const isOpen = body.classList.toggle('open');
    tgl.textContent = isOpen ? '−' : '+';
}

function sortUsers(by) {
    const sorted = [...usersData].sort((a, b) => {
        if (by === 'attended') {
            const aCount = Object.values(a.tracking).filter(t => t.attended).length;
            const bCount = Object.values(b.tracking).filter(t => t.attended).length;
            return bCount - aCount;
        }
        if (by === 'listened') {
            const aCount = Object.values(a.tracking).filter(t => t.listened).length;
            const bCount = Object.values(b.tracking).filter(t => t.listened).length;
            return bCount - aCount;
        }
        // signup: oldest first
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });
    renderUsers(sorted);
    const q = document.getElementById('usersFilter').value;
    if (q) filterUsers(q);
}

function filterUsers(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('#usersContainer .era-block').forEach(card => {
        const username = card.querySelector('.era-title').textContent.toLowerCase();
        card.style.display = (!q || username.includes(q)) ? '' : 'none';
    });
}

switchTab(window.location.hash.slice(1) || 'finder');
