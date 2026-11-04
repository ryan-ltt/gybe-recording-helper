
// ─── Index & show song sets ────────────────────────────────────────────────
let shows = [];
let showIndex = {};
let showSongSets = [];
let showByDate = {}; // date → show object
let showsWithRecordingsByYear = {}; // year → count of shows with recordings
let totalShowsWithRecordings = 0;

function buildIndex() {
    showIndex = {};
    showSongSets = [];
    showByDate = {};
    showsWithRecordingsByYear = {};
    totalShowsWithRecordings = 0;
    for (let i = 0; i < shows.length; i++) {
        showByDate[shows[i].date] = shows[i];
        if (shows[i].recordings && shows[i].recordings.length > 0) {
            const y = shows[i].date.slice(0, 4);
            showsWithRecordingsByYear[y] = (showsWithRecordingsByYear[y] || 0) + 1;
            totalShowsWithRecordings++;
        }
        const seen = new Set();
        for (const rawSong of shows[i].songs) {
            const canon = normalizeSong(rawSong);
            if (canon && !seen.has(canon)) {
                seen.add(canon);
                if (!showIndex[canon]) showIndex[canon] = [];
                showIndex[canon].push(i);
            }
        }
        showSongSets.push(seen);
    }
}

// ─── Shared render helpers ─────────────────────────────────────────────────
// Escape user-written text (comments, notes) before putting it in innerHTML.
function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Brief error banner for failed saves; replaces any banner already showing.
function notifyError(msg) {
    let el = document.getElementById('errorToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'errorToast';
        el.className = 'error-toast';
        el.setAttribute('role', 'alert');
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('open');
    clearTimeout(notifyError._t);
    notifyError._t = setTimeout(() => el.classList.remove('open'), 5000);
}

// A show's date as a link that opens it on the shows tab. The href is a real
// deep link (#shows?show=…), so ctrl/cmd-click opens it in a new browser tab.
function showLink(date, text = date) {
    const d = escapeHtml(date);
    return `<a class="show-link" href="#shows?show=${encodeURIComponent(date)}" title="open in shows" onclick="return onShowLinkClick(event, '${d}')">${escapeHtml(text)}</a>`;
}

function onShowLinkClick(e, date) {
    e.stopPropagation();                 // links sit inside clickable rows and cards
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return true;   // let the browser open it
    e.preventDefault();
    openShowInEras(date);
    return false;
}

function renderShowCard(show, labelHtml, highlightSet) {
    const songLengths = show.song_lengths || [];
    const setlistHtml = show.songs.map((rawSong, i) => {
        const canon = normalizeSong(rawSong);
        const highlighted = canon && highlightSet && highlightSet.has(canon);
        const len = songLengths[i] ? ` <span class="song-len">${formatDuration(songLengths[i])}</span>` : '';
        return (highlighted ? `<span class="matched">${rawSong}</span>` : rawSong) + len;
    }).join(' &nbsp;·&nbsp; ');
    const showLenHtml = show.length
        ? `<span class="show-length" title="length of the preferred recording on archive.org">${formatDuration(show.length)}</span>`
        : '';
    const thanksSuffix = show.note
        ? `<div class="muted" style="font-family:Monaco, 'JetBrains Mono', monospace;font-size:11px;margin-top:6px;white-space:pre-line;">${show.note}</div>`
        : '';

    const bestId = BEST_RECORDINGS[show.date];
    const recHtml = show.recordings && show.recordings.length > 0
        ? `<div class="recordings"><span class="rec-label">recordings:</span>${show.recordings.map((r, i) => `<a href="${r.url}" target="_blank"${bestId === r.id ? ' style="font-weight:bold"' : ''}>[${i + 1}] archive.org</a>${r.length ? `<span class="rec-len">${formatDuration(r.length)}</span>` : ''}`).join('')}</div>`
        : '';

    return `<div class="result-show">
        <div class="show-header">
            <div><span class="show-date">${showLink(show.date)}</span><span class="show-venue">${show.venue}</span>${showLenHtml}</div>
            <span class="match-count">${labelHtml}</span>
        </div>
        <div class="setlist">${setlistHtml}</div>
        ${thanksSuffix}
        ${recHtml}
    </div>`;
}

// ─── Tab switching ─────────────────────────────────────────────────────────
// Top-level groups, each with its own row of sub-tabs. The URL hash is the
// sub-tab's name, which matches its label (#shows, #best-versions…), plus an
// optional query holding that tab's state: #song-finder?songs=moya,glacier or
// #shows?show=2003-07-15. Each tab keeps its own query while you're elsewhere.
const TAB_GROUPS = {
    explore: ['song-finder', 'shows', 'discover', 'lengths'],
    community: ['picks', 'best-versions', 'users', 'predictions'],
};
// Hashes the tabs used to have, so old links and bookmarks still land right.
const OLD_TAB_NAMES = { finder: 'song-finder', eras: 'shows', length: 'lengths', versions: 'best-versions' };
const TABS = Object.values(TAB_GROUPS).flat();
const groupOfTab = name => Object.keys(TAB_GROUPS).find(g => TAB_GROUPS[g].includes(name));
const lastTabInGroup = {};   // group → sub-tab last open, so returning to a group lands there
const tabQuery = {};         // tab → its state as a query string ('' or absent: none)
let currentTab = null;

function parseHash(hash = location.hash) {
    const [tab, query = ''] = hash.replace(/^#/, '').split('?');
    return { tab: OLD_TAB_NAMES[tab] || tab, params: new URLSearchParams(query) };
}

function tabUrl(tab) {
    return '#' + tab + (tabQuery[tab] ? '?' + tabQuery[tab] : '');
}

// Record a tab's state (URLSearchParams, or null to clear) and show it in the
// address bar if that tab is open.
function setTabQuery(tab, params) {
    // commas are safe in a hash; keep them readable in shared links
    const q = params ? params.toString().replace(/%2C/gi, ',') : '';
    if (q) tabQuery[tab] = q; else delete tabQuery[tab];
    if (currentTab === tab) history.replaceState(null, '', tabUrl(tab));
}

// Rebuild a tab's state from its query. Needs setlists.json loaded.
function restoreTabState(tab, params) {
    if (tab === 'song-finder' && params.has('songs')) restoreFinderFromParams(params);
    if (tab === 'shows' && params.get('show')) openShowInEras(params.get('show'));
}

// Open whatever the current URL describes: on first load and when the hash is
// edited or a deep link is followed within the page.
function applyHash() {
    const { tab, params } = parseHash();
    const q = params.toString();
    if (q && TABS.includes(tab)) tabQuery[tab] = q;
    switchTab(tab || 'song-finder');
    if (shows.length) restoreTabState(currentTab, params);   // else the data load does it
}
window.addEventListener('hashchange', applyHash);

function switchGroup(group) {
    switchTab(lastTabInGroup[group] || TAB_GROUPS[group][0]);
}

function switchTab(name) {
    name = OLD_TAB_NAMES[name] || name;
    if (!TABS.includes(name)) name = 'song-finder';
    const group = groupOfTab(name);
    lastTabInGroup[group] = name;
    currentTab = name;
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.group === group);
    });
    document.querySelectorAll('.subtab-btn').forEach(b => {
        const active = b.dataset.tab === name;
        b.hidden = !TAB_GROUPS[group].includes(b.dataset.tab);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === 'tab-' + name);
    });
    history.replaceState(null, '', tabUrl(name));
    if (name === 'lengths' && typeof renderStatsTab === 'function') renderStatsTab();
    if (name === 'best-versions' && !currentVersionSong) loadSongVoteCounts().then(renderVersionsTab);
    if (name === 'shows' && currentUser && !trackingLoaded) loadTrackingThenBuild();
    if (name === 'users' && !usersLoaded) loadUsers();
    if (name === 'picks' && !picksLoaded) loadPicks();
    if (name === 'predictions' && typeof initPredictions === 'function') initPredictions();
}


// Build reverse map: canonical → [alias, alias, ...]
const ALIAS_MAP = {};
for (const song of CANONICAL_SONGS) ALIAS_MAP[song] = [];
// We'll populate it by running normalizeSong on all MAP keys after normalizeSong is defined.
// (populated in init below)

// Songs that are subsets of another: searching the sub-song also finds shows with the parent.
// One-way only: parent search does NOT surface the sub-song.
const PART_OF = {
    'piss crowns are trebled': 'behemoth',
};

// ─── Init ──────────────────────────────────────────────────────────────────
// Populate ALIAS_MAP from normalizeSong's internal MAP
(function() {
    const aliases = ['12-28-99','12-28-99 (outro)','12-28-99 (w/ outro)','12-28-99 (w/outro)','12-28-99 w/ outro','11-28-99 w/ outro','12.28.99','12.28.99 (w/ outro)','12/28/99 (w/ outro)','impro + 12-28-99','09-15-00','09-15-00 (cont.)','intro','hope drone','the dead flag blues (intro version)','improvisation','improv','impro','improvised','improvisation/impro','2 nouveau tower','fam/famine','fam/famine -> undoing a luciferian towers','3rd part','broken windows, locks of love part iii','new thing (part 3)','albanian','mladic','anthem for no state','anthem for no state (part 1)','new new','railroads','babys in a thundercloud','behemoth','behemoth (part 2)',"big'un",'blaise bailey finnegan iii','blaise bailey finnegan ii','blaise bailey finnegan iiii','bbf3','bosses hang','bosses hang (section)','[bosses hang ?]','old new','buildings','broken spires at dead kapital','chart #3','chart #3/steve reich','steve reich','cliff','dead flag blues','dead flag blues (outro)','dead metheny','dead metheny (w/ outro)','death metheny','divorce & fever','do you know how to waltz','fire at static valley','fire at static vallley','(?) fire at static valley','gamelan','we drift like worried fire','gathering storm','gathering storm (part 2)','gathering storm (part ii)','gathering storm pt. i','gatheering storm','gathering strom','gatherng storm','storm','new thing','lift yr. skinny fists like antennas to heaven',"therry's",'glacier','glaicer','improvisation','j.l.h. outro','j.l.h outro','j.l.h. (outro)','j.l.h. outro jam','intro -> j.l.h. outro','john lee hooker outro','john hughes','she dreamt she was a bulldozer, she dreamt she was alone in an empty field','kicking horse on broken hill','kicking horses on brokenhill','bolero',"macrimmon's lament",'monheim','monhiem','motherfucker = redeemer','tiny silver hammers','moya','moya (?)','moya (aborted)','gorecki','nothings alrite in our life','nothings alrite in our lives','pale spectator takes photographs','piss crowns are trebled','raindrops cast in lead','sad mafioso','sad mafioso (part 2)','the sad mafioso','the sad mafioso + outro','the sad mafiosos','sun is a hole','sun is a hole sun is vapors','sun is a hole / sun is vapors','tazer floyd','rockets fall on rocket falls','the boy','the cowboy','slow moving trains','the dead flag blues','the dead flag blues (outro)','the dead flag blues outro','(?)the dead flag blues (outro)','world police','wold police','world police (part i)','world police and friendly fire',"norsola's thing",'piss crowns are trebled','raindrops cast in lead','babys in a thundercloud','broken spires at dead kapital','pale spectator takes photographs','anthem for no state','glacier','cliff','fire at static valley','bosses hang','2 nouveau tower'];
    for (const alias of aliases) {
        const canon = normalizeSong(alias);
        if (canon && ALIAS_MAP[canon]) ALIAS_MAP[canon].push(alias);
    }
})();
// piss crowns are trebled is a part of behemoth: searching "piss crowns" also surfaces behemoth tag
for (const [sub, parent] of Object.entries(PART_OF)) {
    if (ALIAS_MAP[parent]) ALIAS_MAP[parent].push(sub);
}

// ─── State declared early (referenced by renderEraShowList on init) ─────────
let trackingData = {};
let trackingLoaded = false;
let currentUser = null;
let currentUsername = null;
let picksData = [];
let picksLoaded = false;
let myPicksDraft = [];
let myPicksDirty = false;
let myPicksSaved = []; // snapshot of last saved state for per-row dirty tracking
let picksDragSrcIdx = null;

Promise.all([
    fetch('setlists.json').then(r => r.json()),
    BEST_RECORDINGS_READY
]).then(([data]) => {
    shows = data;
    buildIndex();
    buildAlbumSections();
    renderSelectedList();
    updateOptsSummary();
    restoreErasToggles();
    buildEras();
    updateErasTrackSection();
    // the page may have opened on #lengths before the data arrived
    if (document.getElementById('tab-lengths').classList.contains('active')) renderStatsTab();
    // …or on a deep link (#song-finder?songs=…, #shows?show=…)
    restoreTabState(currentTab, parseHash().params);
});

// ─── Supabase init ─────────────────────────────────────────────────────────
const _SB_URL = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : 'https://jouivrvbgyqtyvrrcwcs.supabase.co';
const _SB_KEY = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : 'sb_publishable_6y2HvnhrMSBXFxbn2m2qkw_0cCi1j83';
const sbClient = window.supabase ? window.supabase.createClient(_SB_URL, _SB_KEY) : null;

if (sbClient) {
    sbClient.auth.getSession().then(({ data: { session } }) => {
        if (session) {
            currentUser = session.user;
            fetchUsername(currentUser.id).then(u => { currentUsername = u; updateHeaderAuth(); loadTrackingThenBuild(); });
        }
    });
    sbClient.auth.onAuthStateChange((_event, session) => {
        const newUser = session?.user ?? null;
        if (newUser?.id === currentUser?.id) return;
        currentUser = newUser;
        picksLoaded = false; picksData = []; myPicksDraft = [];
        if (currentUser) {
            fetchUsername(currentUser.id).then(u => {
                currentUsername = u;
                updateHeaderAuth();
                if (currentVersionSong) loadVersionsForSong(currentVersionSong);
                loadTrackingThenBuild();
                if (document.getElementById('tab-picks').classList.contains('active')) loadPicks();
            });
        } else {
            currentUsername = null;
            trackingData = {};
            trackingLoaded = false;
            localStorage.removeItem('discoverUseAccount');
            updateHeaderAuth();
            updateErasTrackSection();
            buildEras();
            if (currentVersionSong) loadVersionsForSong(currentVersionSong);
            if (document.getElementById('tab-picks').classList.contains('active')) loadPicks();
        }
    });
}

async function fetchUsername(userId) {
    const { data } = await sbClient.from('profiles').select('username').eq('user_id', userId).single();
    return data?.username || null;
}

function updateHeaderAuth() {
    const div = document.getElementById('headerAuth');
    const coffeeBtn = `<a class="header-btn" href="https://buymeacoffee.com/ayycap" target="_blank" rel="noopener noreferrer" title="buy me a coffee" style="text-decoration:none;display:inline-flex;align-items:center;">☕</a>`;
    const toggleBtn = `<button class="header-btn" id="themeToggle" onclick="toggleTheme()" title="toggle dark mode">◑</button>`;
    if (currentUser && currentUsername) {
        div.innerHTML = `<a href="profile/index.html" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;color:inherit;text-decoration:underline;">${currentUsername}</a> <button class="header-btn" onclick="doLogout()">log out</button> ${coffeeBtn} ${toggleBtn}`;
    } else {
        div.innerHTML = `<button class="header-btn" onclick="showAuthModal()">log in</button> ${coffeeBtn} ${toggleBtn}`;
    }
    const discoverAccountDiv = document.getElementById('discoverAccountListened');
    if (discoverAccountDiv) discoverAccountDiv.style.display = currentUser ? 'block' : 'none';
    if (typeof updateFinderAccountOptions === 'function') updateFinderAccountOptions();
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// ─── Auth modal ─────────────────────────────────────────────────────────────
function showAuthModal(mode) {
    document.getElementById('authOverlay').classList.add('open');
    document.getElementById('authError').style.display = 'none';
    if (mode === 'signup') showSignup(); else showLogin();
}
function hideAuthModal() { document.getElementById('authOverlay').classList.remove('open'); }
function closeAuthOverlay(e) { if (e.target === document.getElementById('authOverlay')) hideAuthModal(); }

function showLogin() {
    document.getElementById('authModalTitle').textContent = 'log in';
    document.getElementById('authLoginForm').style.display = '';
    document.getElementById('authSignupForm').style.display = 'none';
    document.getElementById('authError').style.display = 'none';
    document.getElementById('authError').textContent = '';
}
function showSignup() {
    document.getElementById('authModalTitle').textContent = 'create account';
    document.getElementById('authLoginForm').style.display = 'none';
    document.getElementById('authSignupForm').style.display = '';
    document.getElementById('authError').style.display = 'none';
    document.getElementById('authError').textContent = '';
    updateEmailWarning();
}
function updateEmailWarning() {
    const email = document.getElementById('authEmail').value.trim();
    document.getElementById('authEmailWarning').style.display = email ? 'none' : '';
}
function showAuthError(msg) {
    const el = document.getElementById('authError');
    el.textContent = msg;
    el.style.display = '';
}

function showForgotPassword() {
    const section = document.getElementById('forgotPasswordSection');
    if (!section) return;
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
    document.getElementById('forgotPasswordMsg').textContent = '';
}

async function sendPasswordReset() {
    if (!sbClient) return;
    const id = document.getElementById('forgotPasswordId').value.trim();
    const msg = document.getElementById('forgotPasswordMsg');
    if (!id) { msg.className = 'error'; msg.textContent = 'please enter your username or email.'; return; }

    let email = id;
    if (!id.includes('@')) {
        const { data, error } = await sbClient.from('profiles').select('email').eq('username', id).single();
        if (error?.code === 'PGRST116' || !data) { msg.className = 'error'; msg.textContent = 'username not found.'; return; }
        if (!data.email) { msg.className = 'error'; msg.textContent = 'this account has no email address attached. password reset is unavailable.'; return; }
        email = data.email;
    }

    const redirectTo = window.location.origin + '/profile';
    const { error } = await sbClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) { msg.className = 'error'; msg.textContent = error.message; return; }
    msg.className = 'success';
    msg.textContent = 'reset link sent - check your email.';
}

async function doLogin() {
    if (!sbClient) return;
    const id = document.getElementById('authLoginId').value.trim();
    const pw = document.getElementById('authLoginPw').value;
    if (!id || !pw) { showAuthError('please fill in all fields.'); return; }

    let email = id;
    if (!id.includes('@')) {
        const { data, error: lookupErr } = await sbClient.from('profiles').select('email').eq('username', id).single();
        if (lookupErr?.code === 'PGRST116' || !data) { showAuthError('username not found.'); return; }
        email = data.email || `${id}@no-email.local`;
    }
    const { error } = await sbClient.auth.signInWithPassword({ email, password: pw });
    if (error) { showAuthError(error.message); return; }
    hideAuthModal();
}

async function doSignup() {
    if (!sbClient) return;
    const username = document.getElementById('authUsername').value.trim();
    const email = document.getElementById('authEmail').value.trim();
    const pw = document.getElementById('authSignupPw').value;

    if (!username || !pw) { showAuthError('username and password are required.'); return; }
    if (pw.length < 6) { showAuthError('password must be at least 6 characters.'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) { showAuthError('username may only contain letters, numbers, _ and -.'); return; }

    const { data: existing } = await sbClient.from('profiles').select('user_id').eq('username', username).single();
    if (existing) { showAuthError('username already taken.'); return; }

    const authEmail = email || `${username}@no-email.local`;
    const { data, error } = await sbClient.auth.signUp({ email: authEmail, password: pw });
    if (error) { showAuthError(error.message); return; }

    const { error: profileError } = await sbClient.from('profiles').insert({ user_id: data.user.id, username, email: email || null });
    if (profileError) { showAuthError('account created but profile setup failed: ' + profileError.message); return; }
    hideAuthModal();
}

async function doLogout() {
    if (!sbClient) return;
    await sbClient.auth.signOut();
}

