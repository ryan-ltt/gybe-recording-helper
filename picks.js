// ─── PICKS TAB ───────────────────────────────────────────────────────────────
async function loadPicks() {
  if (picksLoaded) return;
  picksLoaded = true;
  const container = document.getElementById('picksContainer');
  container.innerHTML = '<p style="font-family:Monaco,\'JetBrains Mono\',monospace;font-size:13px;color:#888;">loading...</p>';
  if (!sbClient) { container.innerHTML = '<p style="font-family:Monaco,\'JetBrains Mono\',monospace;font-size:13px;color:#888;">no database connection.</p>'; return; }
  const { data: rows, error } = await sbClient.from('user_picks').select('user_id,show_date,rank,note').order('rank', { ascending: true });
  if (error || !rows || rows.length === 0) { container.innerHTML = '<p style="font-family:Monaco,\'JetBrains Mono\',monospace;font-size:13px;color:#888;">no picks yet.</p>'; return; }
  const byUser = {};
  for (const row of rows) { if (!byUser[row.user_id]) byUser[row.user_id] = []; byUser[row.user_id].push(row); }
  const userIds = Object.keys(byUser);
  const { data: profiles } = await sbClient.from('profiles').select('user_id,username').in('user_id', userIds);
  const usernameMap = {};
  if (profiles) for (const p of profiles) usernameMap[p.user_id] = p.username;
  picksData = userIds.map(uid => ({ user_id: uid, username: usernameMap[uid] || uid, picks: byUser[uid].sort((a, b) => a.rank - b.rank) }));
  picksData.sort((a, b) => {
    if (currentUser && a.user_id === currentUser.id) return -1;
    if (currentUser && b.user_id === currentUser.id) return 1;
    return a.username.localeCompare(b.username);
  });
  seedMyPicksDraft();
  renderPicksCards();
}

function seedMyPicksDraft() {
  if (!currentUser) { myPicksDraft = []; return; }
  const me = picksData.find(u => u.user_id === currentUser.id);
  myPicksDraft = me ? me.picks.map(p => ({ ...p })) : [];
  myPicksSaved = me ? me.picks.map(p => ({ ...p })) : [];
}

function renderPicksTopShows() {
  const el = document.getElementById('picksTopShows');
  if (!el) return;
  const pickCounts = {}, rankSums = {};
  for (const u of picksData) {
    for (const p of u.picks) {
      pickCounts[p.show_date] = (pickCounts[p.show_date] || 0) + 1;
      rankSums[p.show_date] = (rankSums[p.show_date] || 0) + p.rank;
    }
  }
  const top = Object.entries(pickCounts)
    .map(([date, count]) => [date, count, rankSums[date] / count])
    .sort((a, b) => (b[1] * (15 - b[2])) - (a[1] * (15 - a[2])))
    .slice(0, 10);
  if (top.length === 0) { el.innerHTML = ''; return; }
  const showMap = {};
  if (typeof shows !== 'undefined') for (const s of shows) showMap[s.date] = s;
  el.innerHTML = `<div class="era-block picks-aggregate"><div class="era-header" onclick="toggleTopShows()"><div style="display:flex;align-items:baseline;gap:10px;"><div class="era-title" style="font-style:italic;">most picked shows</div><span class="muted" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:11px;">community</span></div><div style="display:flex;align-items:center;gap:16px;"><div class="era-meta">top ${top.length}</div><div class="era-toggle" id="topShowsToggle">−</div></div></div><div class="era-body open" id="topShowsBody"><ol style="list-style:none;padding:0;margin:0;">${top.map(([date, count, avgPos], i) => { const show = showMap[date]; const venue = show ? show.venue : ''; const bestRecId = (typeof BEST_RECORDINGS !== 'undefined' && BEST_RECORDINGS[date]) ? BEST_RECORDINGS[date] : null; const recs = show && show.recordings ? show.recordings : []; const recsHtml = recs.length > 0 ? `<div class="recordings" style="padding-left:26px;">${recs.map((r, ri) => `<a href="${r.url}" target="_blank"${bestRecId === r.id ? ' style="font-weight:bold"' : ''}>[${ri + 1}]</a>`).join('')}</div>` : ''; const avgStr = Number.isInteger(avgPos) ? avgPos : avgPos.toFixed(1); return `<li style="padding:8px 16px;border-bottom:1px solid #eee;font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;"><span class="muted" style="display:inline-block;width:20px;text-align:right;">${i + 1}.</span> <strong>${date}</strong>${venue ? ` <span class="muted">- ${venue}</span>` : ''} <span class="muted" style="font-size:11px;">(${count} pick${count !== 1 ? 's' : ''}, avg #${avgStr})</span>${recsHtml}</li>`; }).join('')}</ol></div></div>`;
}


function toggleTopShows() {
  const body = document.getElementById('topShowsBody');
  const tgl = document.getElementById('topShowsToggle');
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  tgl.textContent = isOpen ? '−' : '+';
}

function renderPicksCards() {
  renderPicksTopShows();
  const container = document.getElementById('picksContainer');
  const loginNote = document.getElementById('picksLoginNote');
  if (loginNote) loginNote.style.display = (!currentUser) ? '' : 'none';
  if (picksData.length === 0 && (!currentUser)) { container.innerHTML = '<p style="font-family:Monaco,\'JetBrains Mono\',monospace;font-size:13px;color:#888;">no picks yet.</p>'; return; }
  let html = '';
  // If logged in and not in picksData yet, show an empty card for current user first
  const hasMyCard = currentUser && picksData.some(u => u.user_id === currentUser.id);
  if (currentUser && !hasMyCard) {
    const uid = currentUser.id.replace(/-/g, '');
    html += `<div class="era-block" id="pcard-${uid}"><div class="era-header" onclick="togglePicksCard('${uid}')"><div><div class="era-title">${currentUsername || 'you'} <span style="font-size:11px;font-weight:normal;">(yours)</span></div></div><div style="display:flex;align-items:center;gap:16px;"><div class="era-meta">0 picks</div><div class="era-toggle" id="ptoggle-${uid}">+</div></div></div><div class="era-body" id="pbody-${uid}"></div></div>`;
  }
  html += picksData.map(u => {
    const uid = u.user_id.replace(/-/g, '');
    const isMe = currentUser && u.user_id === currentUser.id;
    const badge = isMe ? ' <span style="font-size:11px;font-weight:normal;">(yours)</span>' : '';
    return `<div class="era-block" id="pcard-${uid}"><div class="era-header" onclick="togglePicksCard('${uid}')"><div><div class="era-title">${u.username}${badge}</div></div><div style="display:flex;align-items:center;gap:16px;"><div class="era-meta">${u.picks.length} pick${u.picks.length !== 1 ? 's' : ''}</div><div class="era-toggle" id="ptoggle-${uid}">+</div></div></div><div class="era-body" id="pbody-${uid}"></div></div>`;
  }).join('');
  container.innerHTML = html;
}

function togglePicksCard(uid) {
  const body = document.getElementById('pbody-' + uid);
  const tgl = document.getElementById('ptoggle-' + uid);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  tgl.textContent = isOpen ? '−' : '+';
  if (isOpen && !body.dataset.rendered) { body.dataset.rendered = '1'; renderPicksCardBody(uid); }
}

function renderPicksCardBody(uid) {
  const body = document.getElementById('pbody-' + uid);
  const profile = picksData.find(u => u.user_id.replace(/-/g, '') === uid);
  const isMe = currentUser && profile && profile.user_id === currentUser.id || (currentUser && !profile && currentUser.id.replace(/-/g, '') === uid);
  const picks = isMe ? myPicksDraft : (profile ? profile.picks : []);
  const showMap = {};
  if (typeof shows !== 'undefined') for (const s of shows) showMap[s.date] = s;
  let html = '';
  if (picks.length === 0) {
    html += '<p style="font-family:Monaco,\'JetBrains Mono\',monospace;font-size:13px;color:#888;padding:12px 16px;margin:0;">no picks yet.</p>';
  } else {
    html += '<ol style="list-style:none;padding:0;margin:0;" id="picksList-' + uid + '">';
    html += picks.map((pick, i) => {
      const show = showMap[pick.show_date];
      const venue = show ? show.venue : '';
      const bestRecId = (typeof BEST_RECORDINGS !== 'undefined' && BEST_RECORDINGS[pick.show_date]) ? BEST_RECORDINGS[pick.show_date] : null;
      const recs = show && show.recordings ? show.recordings : [];
      const recsHtml = recs.length > 0 ? `<div class="recordings" style="padding-left:20px;">${recs.map((r, ri) => `<a href="${r.url}" target="_blank"${bestRecId === r.id ? ' style="font-weight:bold"' : ''}>[${ri + 1}]</a>`).join('')}</div>` : '';
      const dragAttr = isMe ? `draggable="true" data-idx="${i}"` : '';
      const removeBtn = isMe ? `<button class="header-btn" onclick="removePick('${uid}','${pick.show_date}')" style="position:absolute;top:6px;right:10px;font-size:11px;padding:2px 7px;">✕</button>` : '';
      const savedEntry = myPicksSaved.find(p => p.show_date === pick.show_date);
      const rowDirty = isMe && (!savedEntry || savedEntry.rank !== i + 1 || savedEntry.note !== (pick.note || null));
      const dirtyBadge = rowDirty ? `<span style="font-family:Monaco,'JetBrains Mono',monospace;font-size:10px;color:#c0392b;margin-left:6px;">unsaved</span>` : '';
      const noteHtml = isMe
        ? `<textarea placeholder="add a note..." oninput="updatePickNote('${pick.show_date}',this.value);this.style.height='auto';this.style.height=this.scrollHeight+'px'" draggable="false" onmousedown="this.closest('li').setAttribute('draggable','false')" onblur="this.closest('li').setAttribute('draggable','true')" style="margin-top:6px;margin-left:20px;width:calc(100% - 76px);font-family:Monaco,'JetBrains Mono',monospace;font-size:11px;padding:4px 6px;border:1px solid #ccc;background:transparent;color:inherit;resize:none;overflow:hidden;display:block;box-sizing:border-box;">${(pick.note || '').replace(/</g,'&lt;')}</textarea>`
        : (pick.note ? `<div class="muted" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:11px;margin-top:3px;padding-left:20px;">${pick.note}</div>` : '');
      return `<li ${dragAttr} data-date="${pick.show_date}" style="position:relative;padding:8px 16px;${isMe ? 'padding-right:56px;' : ''}border-bottom:1px solid #eee;${isMe ? 'cursor:grab;' : ''}"><span style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;"><span class="muted">${i + 1}.</span> <strong>${pick.show_date}</strong>${venue ? ` <span class="muted">- ${venue}</span>` : ''}${dirtyBadge}</span>${recsHtml}${noteHtml}${removeBtn}</li>`;
    }).join('');
    html += '</ol>';
    if (isMe) html += '<p style="font-family:Monaco,\'JetBrains Mono\',monospace;font-size:11px;color:#888;padding:4px 16px;margin:0;">drag to reorder</p>';
  }
  if (isMe) {
    const canAdd = picks.length < 10;
    html += `<div style="padding:12px 16px;border-top:${picks.length > 0 ? '1px solid #eee' : 'none'};">`;
    if (canAdd) {
      html += `<div style="position:relative;"><input type="text" class="search-box" id="picksAddInput" placeholder="search for a show to add..." oninput="picksShowSearch(this.value,'${uid}')" autocomplete="off" style="margin:0;width:100%;box-sizing:border-box;"><div class="show-dropdown" id="picksDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;max-height:200px;overflow-y:auto;"></div></div>`;
    } else {
      html += `<p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;color:#888;margin:0;">10/10 picks, remove one to add another.</p>`;
    }
    html += `<button class="find-btn" onclick="saveMyPicks('${uid}')" style="margin-top:8px;">save order</button>`;
    html += `</div>`;
  }
  body.innerHTML = html;
  if (isMe && picks.length > 0) attachPicksDragHandlers(uid);
  if (isMe) body.querySelectorAll('textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; });
}

function attachPicksDragHandlers(uid) {
  const list = document.getElementById('picksList-' + uid);
  if (!list) return;
  list.querySelectorAll('li[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => { picksDragSrcIdx = parseInt(el.dataset.idx); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => { el.style.opacity = '0.4'; }, 0); });
    el.addEventListener('dragend', () => { el.style.opacity = ''; });
    el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.style.outline = '2px solid black'; });
    el.addEventListener('dragleave', () => { el.style.outline = ''; });
    el.addEventListener('drop', e => {
      e.preventDefault(); el.style.outline = '';
      const targetIdx = parseInt(el.dataset.idx);
      if (picksDragSrcIdx === null || picksDragSrcIdx === targetIdx) return;
      const moved = myPicksDraft.splice(picksDragSrcIdx, 1)[0];
      myPicksDraft.splice(targetIdx, 0, moved);
      picksDragSrcIdx = null;
      myPicksDirty = true;
      const body = document.getElementById('pbody-' + uid);
      delete body.dataset.rendered;
      renderPicksCardBody(uid);
    });
  });
}

function picksShowSearch(q, uid) {
  const dropdown = document.getElementById('picksDropdown');
  if (!dropdown) return;
  if (!q) { dropdown.style.display = 'none'; return; }
  const qLow = q.toLowerCase();
  const existing = new Set(myPicksDraft.map(p => p.show_date));
  const matches = (typeof shows !== 'undefined' ? shows : []).filter(s => !existing.has(s.date) && (s.date.includes(q) || (s.venue && s.venue.toLowerCase().includes(qLow)))).slice(0, 8);
  if (matches.length === 0) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = matches.map(s => `<div class="show-dropdown-item" onmousedown="addPickFromDropdown('${uid}','${s.date}')">${s.date}${s.venue ? ' - ' + s.venue : ''}</div>`).join('');
  dropdown.style.display = 'block';
}

function addPickFromDropdown(uid, date) {
  if (myPicksDraft.length >= 10) return;
  if (myPicksDraft.some(p => p.show_date === date)) return;
  myPicksDraft.push({ show_date: date, rank: myPicksDraft.length + 1, note: null });
  myPicksDirty = true;
  const inp = document.getElementById('picksAddInput');
  if (inp) inp.value = '';
  const dd = document.getElementById('picksDropdown');
  if (dd) dd.style.display = 'none';
  const body = document.getElementById('pbody-' + uid);
  delete body.dataset.rendered;
  renderPicksCardBody(uid);
  // Update card meta count
  const me = picksData.find(u => u.user_id === currentUser.id);
  if (me) me.picks = [...myPicksDraft];
  const meta = document.querySelector('#pcard-' + uid + ' .era-meta');
  if (meta) meta.textContent = myPicksDraft.length + ' pick' + (myPicksDraft.length !== 1 ? 's' : '');
}

function updatePickNote(date, value) {
  const pick = myPicksDraft.find(p => p.show_date === date);
  if (!pick) return;
  pick.note = value || null;
  myPicksDirty = true;
  const savedEntry = myPicksSaved.find(p => p.show_date === date);
  const rowDirty = !savedEntry || savedEntry.note !== (pick.note || null);
  const li = document.querySelector(`li[data-date="${date}"]`);
  if (!li) return;
  const span = li.querySelector('span');
  if (!span) return;
  let badge = span.querySelector('.pick-unsaved-badge');
  if (rowDirty && !badge) {
    badge = document.createElement('span');
    badge.className = 'pick-unsaved-badge';
    badge.style.cssText = 'font-family:Monaco,"JetBrains Mono",monospace;font-size:10px;color:#c0392b;margin-left:6px;';
    badge.textContent = 'unsaved';
    span.appendChild(badge);
  } else if (!rowDirty && badge) {
    badge.remove();
  }
}

function removePick(uid, date) {
  myPicksDraft = myPicksDraft.filter(p => p.show_date !== date);
  myPicksDirty = true;
  const body = document.getElementById('pbody-' + uid);
  delete body.dataset.rendered;
  renderPicksCardBody(uid);
  const me = picksData.find(u => u.user_id && u.user_id === currentUser.id);
  if (me) me.picks = [...myPicksDraft];
  const meta = document.querySelector('#pcard-' + uid + ' .era-meta');
  if (meta) meta.textContent = myPicksDraft.length + ' pick' + (myPicksDraft.length !== 1 ? 's' : '');
}

async function saveMyPicks(uid) {
  if (!currentUser || !sbClient) return;
  const btn = document.querySelector('#pbody-' + uid + ' .find-btn');
  if (btn) { btn.textContent = 'saving...'; btn.disabled = true; }
  const rows = myPicksDraft.map((pick, i) => ({ user_id: currentUser.id, show_date: pick.show_date, rank: i + 1, note: pick.note || null }));
  await sbClient.from('user_picks').delete().eq('user_id', currentUser.id);
  if (rows.length > 0) await sbClient.from('user_picks').insert(rows);
  const me = picksData.find(u => u.user_id === currentUser.id);
  if (me) me.picks = rows.map((r, i) => ({ ...r }));
  else { picksData.unshift({ user_id: currentUser.id, username: currentUsername || currentUser.id, picks: rows.map(r => ({ ...r })) }); }
  myPicksDirty = false;
  myPicksSaved = rows.map(r => ({ ...r }));
  renderPicksCardBody(uid);
  const newBtn = document.querySelector('#pbody-' + uid + ' .find-btn');
  if (newBtn) { newBtn.textContent = 'saved!'; newBtn.disabled = true; setTimeout(() => { if (newBtn) { newBtn.textContent = 'save order'; newBtn.disabled = false; } }, 1500); }
}

