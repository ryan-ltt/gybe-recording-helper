// ─── Canonical songs ───────────────────────────────────────────────────────
const CANONICAL_SONGS = [
    '12-28-99', '12-28-99 (outro)', '2 nouveau tower', '3rd part', 'albanian', 'anthem for no state',
    'babys in a thundercloud', 'behemoth', 'blaise bailey finnegan III', 'bosses hang',
    'broken spires at dead kapital', 'chart #3', 'cliff', 'dead metheny',
    'divorce & fever', 'do you know how to waltz', 'fire at static valley', 'gamelan',
    'gathering storm', 'glacier', 'improvisation', 'intro', 'j.l.h. outro', 'john hughes', 'kicking horse on broken hill',
    "macrimmon's lament", 'monheim', 'motherfucker = redeemer', 'moya',
    'nothings alrite in our lives', 'pale spectator takes photographs', 'piss crowns are trebled',
    'raindrops cast in lead', 'sad mafioso', 'steve reich', 'sun is a hole sun is vapors',
    'tazer floyd', 'the cowboy', 'the dead flag blues', 'the dead flag blues (outro)',
    'world police',
];

// ─── Albums ────────────────────────────────────────────────────────────────
const ALBUMS = [
    { name: 'f#a#∞',                        year: '1997', songs: ['the dead flag blues', 'the cowboy', 'the dead flag blues (outro)', 'nothings alrite in our lives', 'sad mafioso', 'divorce & fever', 'dead metheny', 'kicking horse on broken hill', 'j.l.h. outro'] },
    { name: 'slow riot for new zerø kanada', year: '1999', songs: ['moya', 'blaise bailey finnegan III'] },
    { name: 'lift your skinny fists',        year: '2000', songs: ['gathering storm', 'chart #3', 'world police', 'monheim', '3rd part', 'john hughes'] },
    { name: 'yanqui u.x.o.',                 year: '2002', songs: ['12-28-99', '12-28-99 (outro)', 'tazer floyd', 'motherfucker = redeemer'] },
    { name: "allelujah! don't bend! ascend!",year: '2012', songs: ['albanian', 'gamelan'] },
    { name: 'asunder, sweet and other distress', year: '2015', songs: ['behemoth', 'piss crowns are trebled'] },
    { name: 'luciferian towers',             year: '2017', songs: ['bosses hang', '2 nouveau tower', 'anthem for no state' ] },
    { name: "g_d's pee at state's end!",     year: '2021', songs: ['glacier', 'fire at static valley', 'cliff' ] },
    { name: 'no title as of 13 february 2024 28,340 dead', year: '2024', songs: ['sun is a hole sun is vapors', 'babys in a thundercloud', 'raindrops cast in lead', 'broken spires at dead kapital', 'pale spectator takes photographs'] },
];


// ─── Normalization ─────────────────────────────────────────────────────────
function normalizeSong(raw) {
    const s = raw.toLowerCase()
        .replace(/\s+thanks to\b.*/g, '')
        .replace(/\s+\[.*/g, '')
        .replace(/\s+note\s*:.*/g, '')
        .replace(/\s+(order not confirmed|only the confirmed|unconfirmed).*/g, '')
        .replace(/\s+".*/g, '')
        .replace(/\(soundcheck\)|\(tape\)/g, '')
        .replace(/\s*\(w\/[^)]+\)/g, '')
        .replace(/\s*\(aborted\)/g, '')
        .replace(/\s*\(\?\)/g, '')
        .replace(/motherfucking/g, 'motherfucker')
        .replace(/motherfucker=redeemer/, 'motherfucker = redeemer')
        .trim();

    const MAP = {
        '12-28-99': '12-28-99', '12-28-99 (outro)': '12-28-99 (outro)', '12-28-99 (w/ outro)': '12-28-99',
        '12-28-99 (w/outro)': '12-28-99', '12-28-99 w/ outro': '12-28-99', '11-28-99 w/ outro': '12-28-99',
        '12.28.99': '12-28-99', '12.28.99 (w/ outro)': '12-28-99', '12/28/99 (w/ outro)': '12-28-99',
        'impro + 12-28-99': '12-28-99', '09-15-00': '12-28-99', '09-15-00 (cont.)': '12-28-99',
        'intro': 'intro', 'hope drone': 'intro', 'the dead flag blues (intro version)': 'intro',
        'improvisation': 'improvisation', 'improv': 'improvisation', 'impro': 'improvisation',
        'improvised': 'improvisation', 'improvisation/impro': 'improvisation',
        '2 nouveau tower': '2 nouveau tower', 'fam/famine': '2 nouveau tower', 'fam/famine -> undoing a luciferian towers': '2 nouveau tower',
        '3rd part': '3rd part', 'broken windows, locks of love part iii': '3rd part', 'new thing (part 3)': '3rd part',
        'albanian': 'albanian', 'mladic': 'albanian',
        'anthem for no state': 'anthem for no state', 'anthem for no state (part 1)': 'anthem for no state', 'new new': 'anthem for no state', 'railroads': 'anthem for no state',
        'babys in a thundercloud': 'babys in a thundercloud',
        'behemoth': 'behemoth', 'behemoth (part 2)': 'behemoth', "big'un": 'behemoth',
        'blaise bailey finnegan iii': 'blaise bailey finnegan III',
        'blaise bailey finnegan ii': 'blaise bailey finnegan III',
        'blaise bailey finnegan iiii': 'blaise bailey finnegan III',
        'bbf3': 'blaise bailey finnegan III',
        'bosses hang': 'bosses hang', 'bosses hang (section)': 'bosses hang', '[bosses hang ?]': 'bosses hang', 'old new': 'bosses hang', 'buildings': 'bosses hang',
        'broken spires at dead kapital': 'broken spires at dead kapital',
        'chart #3': 'chart #3', 'chart #3/steve reich': 'chart #3',
        'steve reich': 'steve reich',
        'cliff': 'cliff',
        'dead flag blues': 'the dead flag blues', 'dead flag blues (outro)': 'the dead flag blues (outro)',
        'dead metheny': 'dead metheny', 'dead metheny (w/ outro)': 'dead metheny', 'death metheny': 'dead metheny',
        'divorce & fever': 'divorce & fever',
        'do you know how to waltz': 'do you know how to waltz',
        'fire at static valley': 'fire at static valley', 'fire at static vallley': 'fire at static valley',
        '(?) fire at static valley': 'fire at static valley',
        'gamelan': 'gamelan', 'we drift like worried fire': 'gamelan',
        'gathering storm': 'gathering storm', 'gathering storm (part 2)': 'gathering storm',
        'gathering storm (part ii)': 'gathering storm', 'gathering storm pt. i': 'gathering storm',
        'gatheering storm': 'gathering storm', 'gathering strom': 'gathering storm', 'gatherng storm': 'gathering storm',
        'storm': 'gathering storm', 'new thing': 'gathering storm', 'lift yr. skinny fists like antennas to heaven': 'gathering storm', "therry's": 'gathering storm',
        'glacier': 'glacier', 'glaicer': 'glacier',
        'j.l.h. outro': 'j.l.h. outro', 'j.l.h outro': 'j.l.h. outro', 'j.l.h. (outro)': 'j.l.h. outro',
        'j.l.h. outro jam': 'j.l.h. outro', 'intro -> j.l.h. outro': 'j.l.h. outro', 'john lee hooker outro': 'j.l.h. outro',
        'john hughes': 'john hughes', 'she dreamt she was a bulldozer, she dreamt she was alone in an empty field': 'john hughes',
        'kicking horse on broken hill': 'kicking horse on broken hill', 'kicking horses on brokenhill': 'kicking horse on broken hill', 'bolero': 'kicking horse on broken hill',
        "macrimmon's lament": "macrimmon's lament",
        'monheim': 'monheim', 'monhiem': 'monheim', 'intro + monheim': 'monheim',
        'motherfucker = redeemer': 'motherfucker = redeemer', 'tiny silver hammers': 'motherfucker = redeemer',
        'moya': 'moya', 'moya (?)': 'moya', 'moya (aborted)': 'moya', 'gorecki': 'moya',
        'nothings alrite in our life': 'nothings alrite in our lives', 'nothings alrite in our lives': 'nothings alrite in our lives',
        'pale spectator takes photographs': 'pale spectator takes photographs',
        'piss crowns are trebled': 'piss crowns are trebled',
        'raindrops cast in lead': 'raindrops cast in lead',
        'sad mafioso': 'sad mafioso', 'sad mafioso (part 2)': 'sad mafioso',
        'the sad mafioso': 'sad mafioso', 'the sad mafioso + outro': 'sad mafioso', 'the sad mafiosos': 'sad mafioso',
        'sun is a hole': 'sun is a hole sun is vapors', 'sun is a hole sun is vapors': 'sun is a hole sun is vapors', 'sun is a hole / sun is vapors': 'sun is a hole sun is vapors',
        'tazer floyd': 'tazer floyd', 'rockets fall on rocket falls': 'tazer floyd',
        'the boy': 'the cowboy', 'the cowboy': 'the cowboy', 'slow moving trains': 'the cowboy',
        'the dead flag blues': 'the dead flag blues',
        'the dead flag blues (outro)': 'the dead flag blues (outro)',
        'the dead flag blues outro': 'the dead flag blues (outro)', '(?)the dead flag blues (outro)': 'the dead flag blues (outro)',
        'world police': 'world police', 'wold police': 'world police', 'world police (part i)': 'world police',
        'world police and friendly fire': 'world police', "norsola's thing": 'world police',
    };
    return MAP[s] || null;
}

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
function renderShowCard(show, labelHtml, highlightSet) {
    const setlistHtml = show.songs.map(rawSong => {
        const canon = normalizeSong(rawSong);
        const highlighted = canon && highlightSet && highlightSet.has(canon);
        return highlighted ? `<span class="matched">${rawSong}</span>` : rawSong;
    }).join(' &nbsp;·&nbsp; ');
    const thanksSuffix = show.note
        ? `<div class="muted" style="font-family:Monaco, 'JetBrains Mono', monospace;font-size:11px;margin-top:6px;white-space:pre-line;">${show.note}</div>`
        : '';

    const bestId = BEST_RECORDINGS[show.date];
    const recHtml = show.recordings && show.recordings.length > 0
        ? `<div class="recordings"><span class="rec-label">recordings:</span>${show.recordings.map((r, i) => `<a href="${r.url}" target="_blank"${bestId === r.id ? ' style="font-weight:bold"' : ''}>[${i + 1}] archive.org</a>`).join('')}</div>`
        : '';

    return `<div class="result-show">
        <div class="show-header">
            <div><span class="show-date">${show.date}</span><span class="show-venue">${show.venue}</span></div>
            <span class="match-count">${labelHtml}</span>
        </div>
        <div class="setlist">${setlistHtml}</div>
        ${thanksSuffix}
        ${recHtml}
    </div>`;
}

// ─── Tab switching ─────────────────────────────────────────────────────────
const TABS = ['finder','discover','eras','picks','versions','users'];
function switchTab(name) {
    if (!TABS.includes(name)) name = 'finder';
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
        b.classList.toggle('active', TABS[i] === name);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === 'tab-' + name);
    });
    history.replaceState(null, '', '#' + name);
    if (name === 'versions' && !currentVersionSong) loadSongVoteCounts().then(renderVersionsTab);
    if (name === 'eras' && currentUser && !trackingLoaded) loadTrackingThenBuild();
    if (name === 'users' && !usersLoaded) loadUsers();
    if (name === 'picks' && !picksLoaded) loadPicks();
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

fetch('setlists.json').then(r => r.json()).then(data => {
    shows = data;
    buildIndex();
    buildAlbumSections();
    buildEras();
    updateErasTrackSection();
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
    const toggleBtn = `<button class="header-btn" id="themeToggle" onclick="toggleTheme()" title="toggle dark mode">◑</button>`;
    if (currentUser && currentUsername) {
        div.innerHTML = `<a href="profile/index.html" style="font-family:Monaco,'JetBrains Mono',monospace;font-size:12px;color:inherit;text-decoration:underline;">${currentUsername}</a> <button class="header-btn" onclick="doLogout()">log out</button> ${toggleBtn}`;
    } else {
        div.innerHTML = `<button class="header-btn" onclick="showAuthModal()">log in</button> ${toggleBtn}`;
    }
    const discoverAccountDiv = document.getElementById('discoverAccountListened');
    if (discoverAccountDiv) discoverAccountDiv.style.display = currentUser ? 'block' : 'none';
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

