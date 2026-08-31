// ─── Predictions ───────────────────────────────────────────────────────────
// gliffcoin markets on upcoming setlists. prices blend a decay-weighted
// setlist prior with the live betting pool; payouts are fixed at bet time.

const PRED_WINDOW      = 250;   // shows of history feeding the prior
const PRED_HALFLIFE    = 25;    // shows; recent tour legs dominate
const PRED_FLOOR       = 0.001; // 0.1% — max 1000x before the seed
const PRED_SLOT_FOLD   = 0.005; // slots only: below this an outcome joins "anything else"
const PRED_POOL_K      = 200;   // gliffcoins before the crowd outweighs the prior
const PRED_SEED        = 10;    // house gliffcoins per market
const PRED_LONGSHOT_CAP= 10;    // max stake on a sub-1% outcome
const PRED_DEBUT_PRIOR = 0.25;  // sentiment, not stats — see PRED_DEBUT_MIN_GAP
const PRED_DEBUT_MIN_GAP = 30;  // days since previous show for a debut market

// songs that cannot come back: the members who played them are gone.
const PRED_RETIRED = [
    '12-28-99', '12-28-99 (outro)', '3rd part', 'do you know how to waltz',
    'divorce & fever', 'gamelan', 'motherfucker = redeemer',
    'nothings alrite in our lives', 'steve reich',
];

const PRED_NO_SONG = '(show ends before this slot)';

// non-songs that appear in setlist data
const PRED_NOT_SONGS = ['intro', 'improvisation', '(?)'];

function predIsJunk(song) {
    if (!song) return true;
    const s = song.toLowerCase();
    return s.startsWith('(?)') || s.startsWith('soundcheck') || s.includes('incomplete')
        || s.includes('out of order') || s === '(?)';
}

// a show's setlist, normalized and stripped of junk entries
function predSetlist(show) {
    const out = [];
    for (const raw of show.songs || []) {
        if (predIsJunk(raw)) continue;
        const n = typeof normalizeSong === 'function' ? normalizeSong(raw) : raw.toLowerCase().trim();
        if (n && !predIsJunk(n)) out.push(n);
    }
    return out;
}

function predIsIncomplete(show) {
    if (show.note && /incomplete/i.test(show.note)) return true;
    return (show.songs || []).some(s => /incomplete|out of order/i.test(s));
}

// history feeding the prior: played, complete, on or before today
function predHistory(today) {
    const out = [];
    for (const s of shows) {
        if (s.date > today) continue;
        if (!s.songs || s.songs.length === 0) continue;
        if (predIsIncomplete(s)) continue;
        const set = predSetlist(s);
        if (set.length) out.push({ date: s.date, venue: s.venue, songs: set });
    }
    return out;
}

// exponential decay weights, heaviest on the most recent show
function predWeights(n) {
    const w = [];
    for (let i = 0; i < n; i++) w.push(Math.pow(0.5, (n - 1 - i) / PRED_HALFLIFE));
    return w;
}

// P(song appears) over the weighted window
function predSongPrior(hist, song) {
    const w = predWeights(hist.length);
    let num = 0, den = 0;
    for (let i = 0; i < hist.length; i++) {
        den += w[i];
        if (hist[i].songs.includes(song)) num += w[i];
    }
    return den ? num / den : 0;
}

// P(song occupies slot i), unconditional. shows that never reach the slot are
// counted toward "(no song)" rather than dropped, so a slot market means what a
// reader thinks it means instead of being a hidden bet on set length.
function predSlotPrior(hist, slot) {
    const w = predWeights(hist.length);
    const counts = {};
    let den = 0, short = 0;
    for (let i = 0; i < hist.length; i++) {
        const set = hist[i].songs;
        den += w[i];
        if (set.length <= slot) { short += w[i]; continue; }
        counts[set[slot]] = (counts[set[slot]] || 0) + w[i];
    }
    if (!den) return {};
    const out = {};
    for (const k in counts) out[k] = counts[k] / den;
    if (short > 0) out[PRED_NO_SONG] = short / den;
    return out;
}

function predCloserPrior(hist) {
    const w = predWeights(hist.length);
    const counts = {};
    let den = 0;
    for (let i = 0; i < hist.length; i++) {
        const set = hist[i].songs;
        if (!set.length) continue;
        den += w[i];
        const last = set[set.length - 1];
        counts[last] = (counts[last] || 0) + w[i];
    }
    if (!den) return {};
    const out = {};
    for (const k in counts) out[k] = counts[k] / den;
    return out;
}

// how likely a dormant song is to reappear: the longer since it was last
// played the lower the per-show hazard, but a deep catalogue history lifts it.
function predBustoutPrior(hist, song, allHist) {
    let lastIdx = -1;
    for (let i = allHist.length - 1; i >= 0; i--) {
        if (allHist[i].songs.includes(song)) { lastIdx = i; break; }
    }
    if (lastIdx < 0) return 0;
    const showsSince = allHist.length - 1 - lastIdx;
    let career = 0;
    for (const h of allHist) if (h.songs.includes(song)) career++;
    // base hazard decays with dormancy; career plays raise the ceiling.
    const familiarity = Math.log1p(career) / Math.log1p(300);
    const hazard = 0.30 * familiarity * Math.exp(-showsSince / 120);
    return Math.max(PRED_FLOOR, Math.min(hazard, 0.25));
}

// clamp to the floor and renormalize a multi-outcome distribution
function predNormalize(dist) {
    const out = {};
    let total = 0;
    for (const k in dist) { out[k] = Math.max(dist[k], PRED_FLOOR); total += out[k]; }
    if (!total) return out;
    for (const k in out) out[k] = out[k] / total;
    return out;
}

// ─── Market generation ─────────────────────────────────────────────────────
// auto-generated for future dated shows with no setlist yet.

const PRED_MAX_OUTCOMES     = 12;   // per multi-outcome market, plus "other"
const PRED_RARE_CEILING     = 0.15; // above this a song is a regular, not rare
const PRED_MIN_SLOT_REACH   = 0.02; // a slot needs this much weight to be listed

function predDaysBetween(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// betting closes once the show's date arrives: setlists surface publicly the
// same night, well before the scraper picks them up the following morning.
function predShowStarted(showDate) {
    return String(showDate) <= new Date().toISOString().slice(0, 10);
}

function predUpcomingShows(today) {
    return shows
        .filter(s => s.date > today && (!s.songs || s.songs.length === 0))
        .sort((a, b) => a.date.localeCompare(b.date));
}

// how many slot markets to open: out to the longest set that still carries
// real weight in the window, so a rare long show is bettable rather than absent.
function predMaxSlot(hist) {
    const w = predWeights(hist.length);
    let den = 0;
    const atLeast = [];
    for (let i = 0; i < hist.length; i++) {
        den += w[i];
        const n = hist[i].songs.length;
        for (let k = 0; k < n; k++) atLeast[k] = (atLeast[k] || 0) + w[i];
    }
    if (!den) return 8;
    let last = 0;
    for (let k = 0; k < atLeast.length; k++) {
        if (atLeast[k] / den >= PRED_MIN_SLOT_REACH) last = k;
    }
    return last + 1;
}

// keep the top N outcomes, roll the rest into "other"
function predTrimOutcomes(dist, max) {
    const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    if (sorted.length <= max) return predNormalize(dist);
    const out = {};
    let rest = 0;
    sorted.forEach(([k, v], i) => { if (i < max) out[k] = v; else rest += v; });
    if (rest > 0) out['(anything else)'] = rest;
    return predNormalize(out);
}

// slot markets only: fold the thin tail into one "anything else" outcome.
// a row of its own implies a song was measured at that rate, when really it is
// anything too rare to price separately — those belong together. applied to
// shares of the whole, so what gets folded is what a reader would have seen.
function predFoldTail(dist) {
    let total = 0;
    for (const k in dist) total += dist[k];
    if (!total) return dist;

    const kept = {};
    let rest = 0;
    for (const k in dist) {
        if (k === PRED_NO_SONG || dist[k] / total >= PRED_SLOT_FOLD) kept[k] = dist[k];
        else rest += dist[k];
    }
    if (rest > 0) kept['(anything else)'] = (kept['(anything else)'] || 0) + rest;
    return kept;
}

function predGenerateMarkets(today) {
    const hist = predHistory(today);
    if (hist.length === 0) return [];
    const win = hist.slice(-PRED_WINDOW);

    const markets = [];
    const upcoming = predUpcomingShows(today);
    const maxSlot = predMaxSlot(win);

    // previous show date, for the debut-gap rule
    const lastPlayed = hist[hist.length - 1].date;

    upcoming.forEach((show, idx) => {
        const prev = idx === 0 ? lastPlayed : upcoming[idx - 1].date;

        // ── slot markets: one per slot, out to the longest set that still
        // plausibly happens. the near-certain early slots stay on the board —
        // they price at ~1x on their own, so they cost nothing to
        // list. slots the show usually never reaches are priced mostly on
        // "(show ends before this slot)".
        for (let slot = 0; slot < maxSlot; slot++) {
            const dist = predSlotPrior(win, slot);
            if (Object.keys(dist).length === 0) continue;
            markets.push({
                show_date: show.date, kind: 'slot', slot,
                subject: null,
                title: `song ${slot + 1}`,
                prior: predNormalize(predFoldTail(predTrimOutcomes(dist, PRED_MAX_OUTCOMES))),
            });
        }

        // ── closer
        const closer = predCloserPrior(win);
        if (Object.keys(closer).length) {
            markets.push({
                show_date: show.date, kind: 'closer', slot: null, subject: null,
                title: 'closer',
                prior: predTrimOutcomes(closer, PRED_MAX_OUTCOMES),
            });
        }

        // ── rare appearances. one market type for anything unlikely, priced by
        // the dormancy hazard: a song gone 150 shows and one gone 300 belong on
        // the same scale, and recent-frequency can't provide it — decay drives
        // anything long dormant to nearly zero regardless of how it got there.
        const rares = [];
        for (const song of CANONICAL_SONGS) {
            if (PRED_RETIRED.includes(song) || PRED_NOT_SONGS.includes(song)) continue;
            const recent = predSongPrior(win, song);
            if (recent >= PRED_RARE_CEILING) continue;  // a regular, not a rarity
            const p = Math.max(recent, predBustoutPrior(win, song, hist));
            if (p <= PRED_FLOOR) continue;
            rares.push({ song, p });
        }
        rares.sort((a, b) => b.p - a.p);
        for (const r of rares) {
            markets.push({
                show_date: show.date, kind: 'rare', slot: null, subject: r.song,
                title: r.song,
                prior: predNormalize({ yes: r.p, no: 1 - r.p }),
            });
        }

        // ── debut: only after a real break. back-to-back shows would have
        //    already burned any new material on the first night.
        if (predDaysBetween(prev, show.date) >= PRED_DEBUT_MIN_GAP) {
            markets.push({
                show_date: show.date, kind: 'debut', slot: null, subject: null,
                title: 'any live debut',
                prior: predNormalize({ yes: PRED_DEBUT_PRIOR, no: 1 - PRED_DEBUT_PRIOR }),
            });
        }
    });

    return markets;
}

// ─── Pricing ───────────────────────────────────────────────────────────────
// displayed price blends the setlist prior with the live pool. with an empty
// book you see the statistics; as gliffcoins arrive the crowd takes over.
// payouts are fixed odds: the price you bet at is the price you are paid at.

function predPoolByOutcome(bets) {
    const pool = {};
    for (const b of bets) pool[b.outcome] = (pool[b.outcome] || 0) + Number(b.stake);
    return pool;
}

function predPoolTotal(pool) {
    let t = 0;
    for (const k in pool) t += pool[k];
    return t;
}

// blended implied probability per outcome
function predPrices(market, bets) {
    const prior = market.prior || {};
    const pool = predPoolByOutcome(bets);
    const total = predPoolTotal(pool);
    const w = total / (total + PRED_POOL_K);
    const out = {};
    for (const k in prior) {
        const share = total ? (pool[k] || 0) / total : 0;
        out[k] = Math.max((1 - w) * prior[k] + w * share, PRED_FLOOR);
    }
    let sum = 0;
    for (const k in out) sum += out[k];
    for (const k in out) out[k] = out[k] / sum;
    return out;
}

// what 1 gliffcoin on `outcome` returns if it wins: fixed at the price showing
// when the bet is placed, and never revised afterwards. later money moves the
// price for the next bettor, not the payout of one already taken.
function predPayoutMultiple(market, bets, outcome) {
    const price = predPrices(market, bets)[outcome];
    if (!(price > 0)) return null;
    return 1 / price;
}

// what an already-placed bet will actually pay, from the price it locked in.
function predBetMultiple(bet) {
    const p = Number(bet.prior_at_bet);
    if (!(p > 0)) return null;
    return 1 / p;
}

function predFormatMultiple(m) {
    if (m === null || !isFinite(m)) return '—';
    if (m >= 100) return Math.round(m) + '×';
    if (m >= 10) return m.toFixed(1) + '×';
    return m.toFixed(2) + '×';
}

// a parlay of several bets can be astronomically unlikely, well past the range
// predFormatPct is built for, so it gets its own formatting.
function predFormatParlay(p) {
    if (!(p > 0)) return '0%';
    if (p >= 0.01) return (100 * p).toFixed(1) + '%';
    if (p >= 0.0001) return (100 * p).toFixed(3) + '%';
    if (p >= 1e-8) return (100 * p).toPrecision(2) + '%';
    return '~1 in ' + Math.round(1 / p).toExponential(1).replace('e+', 'e');
}

function predFormatPct(p) {
    if (p >= 0.995) return '>99%';
    if (p < 0.001) return '<0.1%';
    if (p < 0.01) return (100 * p).toFixed(1) + '%';
    return Math.round(100 * p) + '%';
}

function predFormatCoins(n) {
    const v = Number(n) || 0;
    return (Math.round(v * 100) / 100).toString();
}

// ─── Resolution ────────────────────────────────────────────────────────────
// what a market settles to, given the real setlist. returns null when the show
// hasn't happened yet, and 'void' when the setlist can't be trusted.

function predResolveMarket(market, show, priorSongs) {
    if (!show) return null;
    if (!show.songs || show.songs.length === 0) return null;
    if (predIsIncomplete(show)) return 'void';

    const set = predSetlist(show);
    if (!set.length) return 'void';

    const outcomes = Object.keys(market.prior || {});
    const held = name => outcomes.includes(name) ? name : '(anything else)';

    switch (market.kind) {
        case 'slot': {
            const i = market.slot;
            if (set.length <= i) {
                return outcomes.includes(PRED_NO_SONG) ? PRED_NO_SONG : 'void';
            }
            return held(set[i]);
        }
        case 'closer':
            return held(set[set.length - 1]);
        case 'rare':
            return set.includes(market.subject) ? 'yes' : 'no';
        case 'debut': {
            // a debut is a song with no prior live performance anywhere in the
            // catalogue's history, not merely one absent from the window.
            //
            // this reads the raw setlist, not the normalized one: normalizeSong
            // returns null for anything it doesn't recognise, and a true debut
            // is by definition not in the map yet — normalizing first would
            // drop the very song being asked about and always answer "no".
            for (const raw of show.songs || []) {
                if (predIsJunk(raw)) continue;
                const n = typeof normalizeSong === 'function' ? normalizeSong(raw) : null;
                const key = (n === null || n === undefined) ? raw.toLowerCase().trim() : n;
                if (!priorSongs.has(key)) return 'yes';
            }
            return 'no';
        }
        default:
            return null;
    }
}

// every song played strictly before `date`, for debut resolution. keeps the raw
// spelling alongside the normalized one so a song the map doesn't know is still
// recognised the second time it is played.
function predSongsBefore(date) {
    const seen = new Set();
    for (const s of shows) {
        if (s.date >= date) continue;
        if (!s.songs || s.songs.length === 0) continue;
        for (const raw of s.songs) {
            if (predIsJunk(raw)) continue;
            const n = typeof normalizeSong === 'function' ? normalizeSong(raw) : null;
            seen.add(n === null || n === undefined ? raw.toLowerCase().trim() : n);
        }
    }
    return seen;
}

// settlement. each winning bet pays out at the price it locked in; a void
// market refunds every stake.
function predSettle(market, bets, outcome) {
    const payouts = [];
    if (outcome === 'void') {
        const back = {};
        for (const b of bets) back[b.user_id] = (back[b.user_id] || 0) + Number(b.stake);
        for (const user_id in back) {
            payouts.push({ user_id, amount: Math.round(back[user_id] * 100) / 100, reason: 'refund' });
        }
        return payouts;
    }
    const winners = bets.filter(b => b.outcome === outcome);
    if (!winners.length) return payouts; // house keeps the stakes; nothing to pay

    // fixed odds: every bet pays stake x the multiple it locked in, whatever the
    // book looks like now. bets placed before the price moved keep their price.
    // a bet with no recorded price falls back to the market's opening prior.
    const prior = market.prior || {};
    const byUser = {};
    for (const b of winners) {
        let p = Number(b.prior_at_bet);
        if (!(p > 0)) p = Number(prior[outcome]) || 0;
        if (!(p > 0)) continue;                       // unpriceable, pay nothing
        const amount = Number(b.stake) / p;
        byUser[b.user_id] = (byUser[b.user_id] || 0) + amount;
    }

    // one row per user, not per bet: the ledger records one payout per market.
    for (const user_id in byUser) {
        payouts.push({
            user_id,
            amount: Math.round(byUser[user_id] * 100) / 100,
            reason: 'payout',
        });
    }
    return payouts;
}

// ─── State ─────────────────────────────────────────────────────────────────

let predMarkets   = [];
let predBets      = [];
let predBalance   = null;
let predLoaded    = false;
let predOpenShows = new Set();
let predOpenGroups = new Set();
let predBusy      = false;
let predLoading   = false;
let predNames     = {};      // user_id -> username
let predBetsUser  = null;    // whose bets the card is showing

function predBetsFor(marketId) {
    return predBets.filter(b => String(b.market_id) === String(marketId));
}

// what this user's bets on `outcome` pay if it wins, each at its locked price
function predMyReturn(marketId, outcome) {
    if (!currentUser) return 0;
    let total = 0;
    for (const b of predBetsFor(marketId)) {
        if (b.user_id !== currentUser.id || b.outcome !== outcome) continue;
        const m = predBetMultiple(b);
        if (m !== null) total += Number(b.stake) * m;
    }
    return Math.round(total * 100) / 100;
}

function predMyStake(marketId, outcome) {
    if (!currentUser) return 0;
    return predBetsFor(marketId)
        .filter(b => b.user_id === currentUser.id && b.outcome === outcome)
        .reduce((t, b) => t + Number(b.stake), 0);
}

async function loadPredictions() {
    const container = document.getElementById('predictionsResults');
    if (!container) return;
    predLoading = true;
    try {
        await predLoadInner(container);
    } finally {
        predLoading = false;
    }
}

async function predLoadInner(container) {
    if (!sbClient) {
        container.innerHTML = predNote('no database connection.');
        return;
    }
    if (!predLoaded) container.innerHTML = predNote('loading markets…');

    const [mRes, bRes] = await Promise.all([
        sbClient.from('pred_markets').select('*').order('show_date', { ascending: true }),
        sbClient.from('pred_bets').select('market_id,user_id,outcome,stake,prior_at_bet'),
    ]);

    // an empty board and a failed query look identical once the data is gone,
    // so say which one happened instead of showing "no markets yet" for both.
    if (mRes.error) {
        console.error('pred_markets:', mRes.error);
        container.innerHTML = predNote('could not load markets: ' + predEscape(mRes.error.message));
        return;
    }
    if (bRes.error) console.error('pred_bets:', bRes.error);

    predMarkets = mRes.data || [];
    predBets    = bRes.data || [];

    if (currentUser) {
        const { data, error } = await sbClient.rpc('ensure_balance');
        if (error) console.error('ensure_balance:', error);
        else if (data !== null && data !== undefined) predBalance = Number(data);
    } else {
        predBalance = null;
    }

    predLoaded = true;
    renderPredictions();
}

function predNote(text) {
    return `<p style="font-family:Monaco,'JetBrains Mono',monospace;font-size:13px;color:#888;">${text}</p>`;
}

// ─── Rendering ─────────────────────────────────────────────────────────────

const PRED_KIND_LABEL = {
    slot: 'slot', closer: 'closer', rare: 'rare', debut: 'debut',
};

// everyone who has actually placed a bet, most-staked first so the list is
// ordered by involvement rather than by whatever order the rows arrived in.
function predBettors() {
    const staked = {};
    for (const b of predBets) staked[b.user_id] = (staked[b.user_id] || 0) + Number(b.stake);
    return Object.keys(staked)
        .filter(u => predNames[u])
        .sort((a, b) => staked[b] - staked[a]);
}

function predRenderBetsUserSelect(bettors) {
    const sel = document.getElementById('predBetsUser');
    if (!sel) return;
    if (!bettors.length) { sel.innerHTML = ''; sel.style.display = 'none'; return; }
    sel.style.display = '';
    sel.innerHTML = bettors.map(u => {
        const label = (currentUser && u === currentUser.id)
            ? `${predNames[u]} (you)` : predNames[u];
        return `<option value="${predEscape(u)}"${u === predBetsUser ? ' selected' : ''}>${predEscape(label)}</option>`;
    }).join('');
    sel.value = predBetsUser || '';
}

function predSelectBetsUser(userId) {
    predBetsUser = userId || null;
    predRenderMyBets();
    // opened from a leaderboard name, the card may still be collapsed
    const body = document.getElementById('body-predpanel-mybets');
    const toggle = document.getElementById('toggle-predpanel-mybets');
    if (body && toggle && !predOpenGroups.has('predpanel-mybets')) {
        body.classList.toggle('open');
        toggle.textContent = '−';
        predOpenGroups.add('predpanel-mybets');
    }
}

function predSetPanelTitle(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function predSetPanelMeta(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function predMarketTitle(market) {
    if (market.kind === 'slot')   return `song ${Number(market.slot) + 1}`;
    if (market.kind === 'closer') return 'closer';
    if (market.kind === 'debut')  return 'any live debut';
    return market.subject || PRED_KIND_LABEL[market.kind] || market.kind;
}

function predEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPredictions() {
    const container = document.getElementById('predictionsResults');
    if (!container) return;

    predRenderBalance();

    if (!predMarkets.length) {
        container.innerHTML = predNote('no markets yet. they open automatically once a show with no setlist is announced.');
        return;
    }

    const byShow = {};
    for (const m of predMarkets) (byShow[m.show_date] = byShow[m.show_date] || []).push(m);
    const dates = Object.keys(byShow).sort();

    let html = '';
    for (const date of dates) {
        const show = shows.find(s => s.date === date);
        const venue = show ? show.venue : '';
        const list = byShow[date];
        const id = 'pred-' + date;
        const open = predOpenShows.has(date);
        const live = list.filter(m => m.status === 'open' && !predShowStarted(m.show_date)).length;
        const staked = list.reduce((t, m) =>
            t + predBetsFor(m.id).reduce((u, b) => u + Number(b.stake), 0), 0);

        html += `<div class="era-block">
            <div class="era-header" onclick="predToggleShow('${date}')">
                <div>
                    <div class="era-title">${predEscape(date)}</div>
                    <div class="pred-venue">${predEscape(venue)}</div>
                </div>
                <div style="display:flex;align-items:center;gap:16px;">
                    <div class="era-meta">${live} market${live === 1 ? '' : 's'} · ${predFormatCoins(staked)}g in</div>
                    <div class="era-toggle" id="toggle-${id}">${open ? '−' : '+'}</div>
                </div>
            </div>
            <div class="era-body${open ? ' open' : ''}" id="body-${id}">${predRenderShow(list, date)}</div>
        </div>`;
    }
    container.innerHTML = html;
}

// a show's markets, grouped. debut and closer are single markets and sit at the
// top uncollapsed; slots and rares are long lists, so they fold away.
function predRenderShow(list, date) {
    const byKind = { debut: [], closer: [], slot: [], rare: [] };
    for (const m of list) (byKind[m.kind] || (byKind[m.kind] = [])).push(m);

    byKind.slot.sort((a, b) => Number(a.slot) - Number(b.slot));
    byKind.rare.sort((a, b) => {
        const pa = Number((a.prior || {}).yes || 0);
        const pb = Number((b.prior || {}).yes || 0);
        return pb - pa;
    });

    let html = '';
    for (const m of byKind.debut)  html += predRenderMarket(m);
    for (const m of byKind.closer) html += predRenderMarket(m);
    html += predRenderGroup(date, 'slots', 'song slots', byKind.slot);
    html += predRenderGroup(date, 'rare', 'rare songs', byKind.rare);
    return html;
}

// a collapsible group of markets, closed by default
function predRenderGroup(date, key, label, list) {
    if (!list.length) return '';
    const id = 'predg-' + date + '-' + key;
    const open = predOpenGroups.has(id);
    const staked = list.reduce((t, m) =>
        t + predBetsFor(m.id).reduce((u, b) => u + Number(b.stake), 0), 0);
    return `<div class="pred-group">
        <div class="pred-group-head" onclick="predToggleGroup('${id}')">
            <span class="pred-group-toggle" id="toggle-${id}">${open ? '−' : '+'}</span>
            <span class="pred-group-label">${predEscape(label)}</span>
            <span class="pred-group-meta">${list.length} market${list.length === 1 ? '' : 's'}${staked ? ' · ' + predFormatCoins(staked) + 'g in' : ''}</span>
        </div>
        <div class="pred-group-body${open ? ' open' : ''}" id="body-${id}">${list.map(predRenderMarket).join('')}</div>
    </div>`;
}

// the leaderboard and your-bets cards toggle like every other card on the site
function predTogglePanel(key) {
    const id = 'predpanel-' + key;
    const body = document.getElementById('body-' + id);
    const toggle = document.getElementById('toggle-' + id);
    if (!body || !toggle) return;
    const isOpen = body.classList.toggle('open');
    toggle.textContent = isOpen ? '−' : '+';
    if (isOpen) predOpenGroups.add(id); else predOpenGroups.delete(id);
}

function predToggleGroup(id) {
    const body = document.getElementById('body-' + id);
    const toggle = document.getElementById('toggle-' + id);
    if (!body || !toggle) return;
    const isOpen = body.classList.toggle('open');
    toggle.textContent = isOpen ? '−' : '+';
    if (isOpen) predOpenGroups.add(id); else predOpenGroups.delete(id);
}

function predRenderMarket(market) {
    const bets   = predBetsFor(market.id);
    const prices = predPrices(market, bets);
    const pool   = predPoolByOutcome(bets);
    const total  = predPoolTotal(pool);
    const locked = market.status !== 'open' || predShowStarted(market.show_date);

    const entries = Object.entries(prices).sort((a, b) => b[1] - a[1]);

    const title = predMarketTitle(market);

    const resolved = market.status === 'resolved'
        ? `<span class="pred-resolved">resolved: ${predEscape(market.resolved_outcome)}</span>` : '';
    const voided = market.status === 'void' ? `<span class="pred-resolved">void — refunded</span>` : '';

    const rows = entries.map(([outcome, p]) => {
        const mult  = predPayoutMultiple(market, bets, outcome);
        const mine  = predMyStake(market.id, outcome);
        const myRet = predMyReturn(market.id, outcome);
        const won   = market.status === 'resolved' && market.resolved_outcome === outcome;
        const onPool = pool[outcome] || 0;
        return `<div class="pred-row${won ? ' pred-won' : ''}">
            <div class="pred-bar" style="width:${(100 * p).toFixed(1)}%"></div>
            <div class="pred-row-inner">
                <span class="pred-outcome">${predEscape(outcome)}</span>
                <span class="pred-pct">${predFormatPct(p)}</span>
                <span class="pred-mult">${predFormatMultiple(mult)}</span>
                <span class="pred-pool">${onPool ? predFormatCoins(onPool) + 'g' : ''}</span>
                <span class="pred-mine">${mine ? 'you: ' + predFormatCoins(mine) + 'g → ' + predFormatCoins(myRet) + 'g' : ''}</span>
                ${locked ? '' : `<button class="pred-bet-btn" data-market="${market.id}" data-outcome="${predEscape(outcome)}" onclick="predBetFromButton(this)">bet</button>`}
            </div>
        </div>`;
    }).join('');

    return `<div class="pred-market">
        <div class="pred-market-head">
            <span class="pred-kind">${PRED_KIND_LABEL[market.kind] || market.kind}</span>
            <span class="pred-title">${predEscape(title)}</span>
            ${resolved}${voided}
            <span class="pred-total">${total ? predFormatCoins(total) + 'g staked' : 'no bets yet'}</span>
        </div>
        ${rows}
    </div>`;
}

function predRenderBalance() {
    const el = document.getElementById('predBalance');
    if (!el) return;
    if (!currentUser) {
        predBalance = null;
        el.innerHTML = `<span class="muted">log in to place bets.</span>`;
    } else if (predBalance === null) {
        el.innerHTML = '';
    } else {
        el.innerHTML = `balance: <strong>${predFormatCoins(predBalance)}</strong> gliffcoins`;
    }
}

function predToggleShow(date) {
    const id = 'pred-' + date;
    const body = document.getElementById('body-' + id);
    const toggle = document.getElementById('toggle-' + id);
    if (!body || !toggle) return;
    const isOpen = body.classList.toggle('open');
    toggle.textContent = isOpen ? '−' : '+';
    if (isOpen) predOpenShows.add(date); else predOpenShows.delete(date);
}

// ─── Betting ───────────────────────────────────────────────────────────────

let predPendingBet = null;

// the outcome is read off the element rather than interpolated into JS source:
// song titles contain apostrophes ("macrimmon's lament"), which break an inline
// handler no matter how the string is quoted.
function predBetFromButton(el) {
    if (!el) return;
    predOpenBet(el.getAttribute('data-market'), el.getAttribute('data-outcome'));
}

function predOpenBet(marketId, outcome) {
    if (!currentUser) { alert('log in to place bets.'); return; }
    const market = predMarkets.find(m => String(m.id) === String(marketId));
    if (!market || market.status !== 'open') return;
    if (predShowStarted(market.show_date)) return;

    predPendingBet = { marketId, outcome };
    const bets  = predBetsFor(marketId);
    const prior = Number((market.prior || {})[outcome] || 0);
    const cap   = prior < 0.01 ? PRED_LONGSHOT_CAP : null;
    const mine  = predMyStake(marketId, outcome);
    const max   = cap === null
        ? predBalance
        : Math.min(predBalance, Math.max(0, cap - mine));

    const el = document.getElementById('predBetDialog');
    if (!el) return;

    if (!(max >= 1)) {
        el.innerHTML = `<div class="pred-dialog-inner">
            <div class="pred-dialog-title">${predEscape(outcome)}</div>
            <div class="pred-dialog-sub">${cap !== null && mine >= cap
                ? 'you are at the ' + predFormatCoins(cap) + 'g longshot cap for this outcome.'
                : 'not enough gliffcoins to bet.'}</div>
            <div class="pred-dialog-btns">
                <button class="secondary-btn" onclick="predCloseBet()">close</button>
            </div>
        </div>`;
        el.style.display = 'flex';
        return;
    }

    el.innerHTML = `<div class="pred-dialog-inner">
        <div class="pred-dialog-title">${predEscape(outcome)}</div>
        <div class="pred-dialog-sub">
            ${predFormatPct(predPrices(market, bets)[outcome])} ·
            pays ${predFormatMultiple(predPayoutMultiple(market, bets, outcome))} if it hits
        </div>
        ${cap !== null ? `<div class="pred-dialog-cap">longshot (opened at ${predFormatPct(prior)}): max ${predFormatCoins(cap)}g per outcome${mine ? `, you have ${predFormatCoins(mine)}g on it` : ''}</div>` : ''}
        <div class="pred-dialog-row">
            <input type="number" id="predStake" min="1" step="1" max="${Math.floor(max)}" value="${Math.min(5, Math.floor(max)) || ''}" />
            <span class="muted">of ${predFormatCoins(predBalance)}g</span>
        </div>
        <div id="predBetError" class="pred-dialog-error"></div>
        <div class="pred-dialog-btns">
            <button class="secondary-btn" onclick="predCloseBet()">cancel</button>
            <button onclick="predSubmitBet()">place bet</button>
        </div>
        <div class="pred-dialog-note">payouts are based on other bettors and winnings are split (plus a 10 gliffcoin bonus in the pot for having the courage to bet)</div>
    </div>`;
    el.style.display = 'flex';
    const input = document.getElementById('predStake');
    if (input) { input.focus(); input.select(); }
}

function predCloseBet() {
    predPendingBet = null;
    const el = document.getElementById('predBetDialog');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

async function predSubmitBet() {
    if (!predPendingBet || predBusy) return;
    const errEl = document.getElementById('predBetError');
    const input = document.getElementById('predStake');
    const stake = Number(input && input.value);

    if (!isFinite(stake) || stake <= 0) {
        if (errEl) errEl.textContent = 'enter a stake above zero.';
        return;
    }
    if (!Number.isInteger(stake)) {
        if (errEl) errEl.textContent = 'bets must be whole gliffcoins.';
        return;
    }
    if (predBalance !== null && stake > predBalance) {
        if (errEl) errEl.textContent = 'not enough gliffcoins.';
        return;
    }

    predBusy = true;
    if (errEl) errEl.textContent = '';
    const { data, error } = await sbClient.rpc('place_bet', {
        p_market_id: predPendingBet.marketId,
        p_outcome:   predPendingBet.outcome,
        p_stake:     stake,
    });
    predBusy = false;

    if (error) {
        if (errEl) errEl.textContent = error.message || 'could not place bet.';
        return;
    }
    if (data && data.ok === false) {
        if (errEl) errEl.textContent = data.error || 'could not place bet.';
        return;
    }

    if (data && data.balance !== undefined) predBalance = Number(data.balance);
    predCloseBet();
    await loadPredictions();
    await predLoadLeaderboard();
    predRenderMyBets();
}

// ─── Leaderboard ───────────────────────────────────────────────────────────

async function predLoadLeaderboard() {
    const el = document.getElementById('predLeaderboard');
    if (!el || !sbClient) return;

    const [balRes, profRes] = await Promise.all([
        sbClient.from('pred_balances').select('user_id,balance').order('balance', { ascending: false }).limit(25),
        sbClient.from('profiles').select('user_id,username'),
    ]);
    const names = {};
    for (const p of profRes.data || []) names[p.user_id] = p.username;
    predNames = names;

    const rows = (balRes.data || []).filter(r => names[r.user_id]);
    if (!rows.length) {
        predSetPanelMeta('predLeaderboardMeta', '');
        el.innerHTML = predNote('nobody has placed a bet yet.');
        return;
    }

    // stakes on unsettled markets aren't in the balance, so show them alongside
    // it. a locked market is still unsettled: the show has happened but its
    // setlist hasn't landed yet, and that money is very much still at risk.
    const atRisk = {}, dream = {}, odds = {}, conflicted = {};
    const perUserMarket = {};   // user -> market -> outcomes backed
    for (const b of predBets) {
        const m = predMarkets.find(x => String(x.id) === String(b.market_id));
        if (!m || (m.status !== 'open' && m.status !== 'locked')) continue;
        const u = b.user_id;
        atRisk[u] = (atRisk[u] || 0) + Number(b.stake);

        // payout if every open bet wins, each at the price it locked in
        const mult = predBetMultiple(b);
        if (mult !== null) dream[u] = (dream[u] || 0) + Number(b.stake) * mult;

        // chance of that happening. bets on different markets multiply; two
        // bets on different outcomes of the SAME market cannot both win, so
        // that parlay is impossible rather than merely unlikely.
        const seen = perUserMarket[u] || (perUserMarket[u] = {});
        const key = String(b.market_id);
        if (seen[key] === undefined) {
            seen[key] = b.outcome;
            const p = Number(b.prior_at_bet);
            odds[u] = (odds[u] === undefined ? 1 : odds[u]) * (p > 0 ? p : 0);
        } else if (seen[key] !== b.outcome) {
            conflicted[u] = true;
        }
    }

    const me = rows.findIndex(r => currentUser && r.user_id === currentUser.id);
    predSetPanelMeta('predLeaderboardMeta',
        `${rows.length} player${rows.length === 1 ? '' : 's'}` +
        (me >= 0 ? ` · you are #${me + 1}` : ''));

    el.innerHTML = `<div class="pred-scroll"><table class="pred-table">
        <tr><th>#</th><th>user</th><th>gliffcoins</th><th>at risk</th>
            <th>if all hit</th><th>chance</th></tr>
        ${rows.map((r, i) => {
            const u = r.user_id;
            const win = dream[u];
            const p = conflicted[u] ? 0 : odds[u];
            return `<tr${currentUser && u === currentUser.id ? ' class="pred-me"' : ''}>
            <td>${i + 1}</td>
            <td><span class="pred-leader-name" onclick="predSelectBetsUser('${predEscape(u)}')">${predEscape(names[u])}</span></td>
            <td>${predFormatCoins(r.balance)}</td>
            <td>${atRisk[u] ? predFormatCoins(atRisk[u]) : '—'}</td>
            <td>${win ? predFormatCoins(Math.round(win * 100) / 100) : '—'}</td>
            <td>${p === undefined ? '—' : predFormatParlay(p)}</td>
        </tr>`; }).join('')}
    </table></div>`;
}

// ─── Your bets ─────────────────────────────────────────────────────────────

// what the returns column says: a settled bet reports what happened, a live one
// reports what it would pay. showing a would-pay figure on a lost bet reads as
// though the money is still coming.
function predBetReturnCell(r) {
    if (r.state === 'lost') return '—';
    if (r.state === 'void — refunded') return predFormatCoins(r.b.stake) + 'g';
    if (r.ret === null) return '—';
    const amt = predFormatCoins(Math.round(r.ret * 100) / 100) + 'g';
    return r.state === 'won' ? amt : amt;
}

// every bet this user holds, by show date, with the price each locked in.
function predRenderMyBets() {
    const el = document.getElementById('predMyBets');
    if (!el) return;
    // whose bets to show: an explicit pick, else yourself, else the first bettor
    const bettors = predBettors();
    if (predBetsUser === null || !bettors.includes(predBetsUser)) {
        predBetsUser = (currentUser && bettors.includes(currentUser.id))
            ? currentUser.id
            : (bettors[0] || null);
    }
    predRenderBetsUserSelect(bettors);

    const isMe = currentUser && predBetsUser === currentUser.id;
    const who = isMe ? 'you' : (predNames[predBetsUser] || 'this user');
    predSetPanelTitle('predMyBetsTitle', isMe ? 'your bets' : `${who}'s bets`);

    if (!predBetsUser) {
        predSetPanelMeta('predMyBetsMeta', '');
        el.innerHTML = predNote(currentUser
            ? 'nobody has placed a bet yet.'
            : 'log in or pick a user to see their bets.');
        return;
    }

    const mine = predBets.filter(b => b.user_id === predBetsUser);
    if (!mine.length) {
        predSetPanelMeta('predMyBetsMeta', 'nothing riding yet');
        el.innerHTML = predNote(isMe
            ? 'you have not placed any bets yet.'
            : `${who} has not placed any bets yet.`);
        return;
    }

    const rows = mine.map(b => {
        const m = predMarkets.find(x => String(x.id) === String(b.market_id));
        const mult = predBetMultiple(b);
        const ret = mult === null ? null : Number(b.stake) * mult;
        let state = 'open', cls = '';
        if (!m) state = '—';
        else if (m.status === 'void') { state = 'void — refunded'; }
        else if (m.status === 'resolved') {
            const won = m.resolved_outcome === b.outcome;
            state = won ? 'won' : 'lost';
            cls = won ? ' class="pred-won-row"' : ' class="pred-lost-row"';
        } else if (m.status === 'locked' || predShowStarted(m.show_date)) {
            state = 'awaiting setlist';
        }
        return { b, m, mult, ret, state, cls };
    }).sort((a, b) => {
        const da = a.m ? a.m.show_date : '';
        const db = b.m ? b.m.show_date : '';
        return da.localeCompare(db);
    });

    const staked = mine.reduce((t, b) => t + Number(b.stake), 0);
    const live = rows.filter(r => r.state === 'open' || r.state === 'awaiting setlist');
    const couldWin = live.reduce((t, r) => t + (r.ret || 0), 0);

    predSetPanelMeta('predMyBetsMeta',
        `${mine.length} bet${mine.length === 1 ? '' : 's'} · ${predFormatCoins(staked)}g staked` +
        (live.length ? ` · ${predFormatCoins(Math.round(couldWin * 100) / 100)}g if all win` : ''));

    el.innerHTML = `<div class="pred-scroll"><table class="pred-table pred-bets-table">
        <tr><th>show</th><th>market</th><th>pick</th><th>stake</th><th>at</th><th>returns</th><th></th></tr>
        ${rows.map(r => `<tr${r.cls}>
            <td>${r.m ? predEscape(r.m.show_date) : '—'}</td>
            <td>${r.m ? predEscape(predMarketTitle(r.m)) : '—'}</td>
            <td>${predEscape(r.b.outcome)}</td>
            <td>${predFormatCoins(r.b.stake)}g</td>
            <td>${r.b.prior_at_bet ? predFormatPct(Number(r.b.prior_at_bet)) : '—'}</td>
            <td>${predBetReturnCell(r)}</td>
            <td class="pred-bet-state">${predEscape(r.state)}</td>
        </tr>`).join('')}
        <tr class="pred-bets-total">
            <td colspan="3">${mine.length} bet${mine.length === 1 ? '' : 's'}, ${live.length} live</td>
            <td>${predFormatCoins(staked)}g</td>
            <td></td>
            <td>${predFormatCoins(Math.round(couldWin * 100) / 100)}g</td>
            <td class="pred-bet-state">if every live bet wins</td>
        </tr>
    </table></div>`;
}

// ─── Init ──────────────────────────────────────────────────────────────────

let predInitPending = false;

function initPredictions() {
    // setlists.json is fetched asynchronously, and the tab can be opened before
    // it lands. wait for it, or the board renders without venues and the
    // generator has no history to work from.
    if (!shows || shows.length === 0) {
        const container = document.getElementById('predictionsResults');
        if (container && !predLoaded) container.innerHTML = predNote('loading…');
        // one retry loop, however many times the tab is clicked: each click
        // used to start its own, and they all fired a query once shows landed.
        if (predInitPending) return;
        predInitPending = true;
        setTimeout(() => { predInitPending = false; initPredictions(); }, 100);
        return;
    }
    if (predLoading) return;   // a load is already in flight
    loadPredictions().then(() => predLoadLeaderboard()).then(predRenderMyBets);
}
