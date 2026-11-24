#!/usr/bin/env node
// sync-predictions.js
// Opens markets for newly announced shows and settles the ones whose setlists
// have landed. Runs in CI with the service-role key: balances and payouts are
// never writable from the browser.
//
//   node sync-predictions.js            # open + resolve
//   node sync-predictions.js --dry-run  # report, write nothing

const fs = require('fs');
const vm = require('vm');
const { createClient } = require('@supabase/supabase-js');

const DRY = process.argv.includes('--dry-run');
// the project url is public (it ships in index.js); only the key is a secret.
const URL = process.env.SUPABASE_URL || 'https://jouivrvbgyqtyvrrcwcs.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;

if (!KEY) {
    console.error('SUPABASE_SERVICE_KEY must be set.');
    process.exit(1);
}

// share one implementation of the pricing/resolution rules with the browser
function loadShared() {
    const ctx = { console, Math, Date, Intl, Object, Array, JSON, String, Number, Set, Map,
                  parseInt, parseFloat, isNaN, isFinite };
    vm.createContext(ctx);
    // CANONICAL_SONGS etc. live in songs.js, which the page loads before index.js
    vm.runInContext(fs.readFileSync('songs.js', 'utf8'), ctx);
    const index = fs.readFileSync('index.js', 'utf8');
    vm.runInContext(index.slice(0, index.indexOf('// ─── Tab switching')), ctx);
    ctx.SHOWS_DATA = JSON.parse(fs.readFileSync('setlists.json', 'utf8'));
    vm.runInContext('shows = SHOWS_DATA;', ctx);
    const pred = fs.readFileSync('predictions.js', 'utf8');
    // the browser half of the file touches the DOM; stop before it.
    vm.runInContext(pred.slice(0, pred.indexOf('// ─── State ───')), ctx);
    // top-level `const` doesn't land on the context object, so read the
    // constants we need back out through an expression.
    ctx.PRED_SEED = vm.runInContext('PRED_SEED', ctx);
    ctx.shows = vm.runInContext('shows', ctx);
    return ctx;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function marketKey(m) {
    return [m.show_date, m.kind, m.slot === null || m.slot === undefined ? -1 : m.slot,
            m.subject || ''].join('|');
}

async function main() {
    const ctx = loadShared();
    const sb = createClient(URL, KEY, { auth: { persistSession: false } });

    const { data: existing, error: exErr } = await sb.from('pred_markets').select('*');
    if (exErr) throw exErr;

    // ── open markets for shows that don't have any yet
    const have = new Set((existing || []).map(marketKey));
    const generated = ctx.predGenerateMarkets(today());
    const fresh = generated.filter(m => !have.has(marketKey(m)));

    console.log(`generated ${generated.length} markets, ${fresh.length} new`);
    if (fresh.length && !DRY) {
        const rows = fresh.map(m => ({
            show_date: m.show_date,
            closes_at: m.closes_at,
            kind: m.kind,
            slot: m.slot === undefined ? null : m.slot,
            subject: m.subject || null,
            outcomes: Object.keys(m.prior),
            prior: m.prior,
            seed: ctx.PRED_SEED,
            status: 'open',
        }));
        const { error } = await sb.from('pred_markets').insert(rows);
        if (error) throw error;
        console.log(`opened ${rows.length} markets`);
    }

    // ── keep each open market's closing time in step with its venue. markets
    // from before closes_at existed get one here, and a venue edited in
    // setlists.json (or a zone added to PRED_TZ_REGION) moves it.
    const showFor = {};
    for (const s of ctx.shows) showFor[s.date] = s;
    let reclosed = 0;
    const unzoned = new Set();
    for (const market of existing || []) {
        if (market.status !== 'open') continue;
        const show = showFor[market.show_date];
        if (!show) continue;
        if (!ctx.predVenueTz(show.venue)) unzoned.add(`${show.date} ${show.venue}`);
        const closes = ctx.predClosesAt(show);
        if (market.closes_at && Date.parse(market.closes_at) === Date.parse(closes)) continue;
        if (!DRY) {
            const { error } = await sb.from('pred_markets')
                .update({ closes_at: closes }).eq('id', market.id).eq('status', 'open');
            if (error) throw error;
        }
        market.closes_at = closes;
        reclosed++;
    }
    if (reclosed) console.log(`set closing time on ${reclosed} open markets`);
    // not an error: these close at midnight UTC, the safe default. adding the
    // region to PRED_TZ_REGION lets them stay open until the afternoon.
    for (const v of unzoned) console.log(`no time zone for ${v}: closing at midnight UTC`);

    // ── reprice open markets on the latest history. a market used to keep the
    // prior it opened with, so a show announced months ahead was priced
    // without the tour played in between. bets already placed are unaffected:
    // each one is paid at the prior_at_bet it locked, never at the market's
    // prior. only bets placed from here on see the new price.
    //
    // a market whose outcome list would change is left alone: dropping an
    // outcome someone holds would settle their bet as "(anything else)".
    const genByKey = new Map(generated.map(m => [marketKey(m), m]));
    const sameOutcomes = (a, b) => {
        const x = Object.keys(a).sort(), y = Object.keys(b).sort();
        return x.length === y.length && x.every((k, i) => k === y[i]);
    };
    let repriced = 0, kept = 0;
    for (const market of existing || []) {
        if (market.status !== 'open' || ctx.predMarketClosed(market)) continue;
        const gen = genByKey.get(marketKey(market));
        let prior = gen ? gen.prior : null;
        // a rare song the new model prices at or below the floor isn't
        // generated at all, but its market already exists: price it anyway
        if (!prior && market.kind === 'rare' && market.subject) {
            prior = ctx.predRarePriorFor(today(), market.subject);
        }
        if (!prior) { kept++; continue; }
        if (!sameOutcomes(prior, market.prior || {})) { kept++; continue; }
        const moved = Object.keys(prior).some(k =>
            Math.abs(prior[k] - Number(market.prior[k])) > 1e-6);
        if (!moved) continue;
        if (!DRY) {
            const { error } = await sb.from('pred_markets')
                .update({ prior }).eq('id', market.id).eq('status', 'open');
            if (error) throw error;
        }
        repriced++;
    }
    console.log(`repriced ${repriced} open markets` +
                (kept ? `, ${kept} kept their price (no longer generated, or ` +
                        `their outcome list would change)` : ''));

    // ── settle markets whose show has happened
    const { data: open, error: opErr } = await sb.from('pred_markets')
        .select('*').in('status', ['open', 'locked']);
    if (opErr) throw opErr;

    const showsByDate = {};
    for (const s of ctx.shows) showsByDate[s.date] = s;

    // a show's setlist reaches setlists.json the morning after it is played, so
    // a market left open past its closing time is bettable by anyone who already
    // knows the answer. place_bet refuses those bets itself; this marks them
    // locked so the board says so, and they settle once the setlist lands.
    const stamp = today();
    let locked = 0;
    for (const market of open || []) {
        if (market.status !== 'open') continue;
        if (!ctx.predMarketClosed(market)) continue;
        const show = showsByDate[market.show_date];
        if (show && show.songs && show.songs.length) continue; // settles below
        if (!DRY) {
            const { error } = await sb.from('pred_markets')
                .update({ status: 'locked' }).eq('id', market.id).eq('status', 'open');
            if (error) throw error;
        }
        market.status = 'locked';
        locked++;
    }
    if (locked) console.log(`locked ${locked} markets whose show has started`);

    // a show can be cancelled, or its setlist may simply never be published. the
    // market would otherwise stay locked forever with everyone's stake inside it,
    // so after a grace period it is voided and every bet refunded.
    const STALE_DAYS = 30;

    let settled = 0;
    for (const market of open || []) {
        const show = showsByDate[market.show_date];
        const before = ctx.predSongsBefore(market.show_date);
        let outcome = ctx.predResolveMarket(market, show, before);

        if (outcome === null) {
            const age = Math.round(
                (Date.parse(stamp) - Date.parse(market.show_date)) / 86400000);
            if (age < STALE_DAYS) continue;
            console.log(`${market.show_date} ${market.kind} — no setlist after ` +
                        `${age} days, voiding and refunding`);
            outcome = 'void';
        }

        const { data: bets, error: bErr } = await sb.from('pred_bets')
            .select('id,user_id,outcome,stake,prior_at_bet').eq('market_id', market.id);
        if (bErr) throw bErr;

        const payouts = ctx.predSettle(market, bets || [], outcome);
        const total = payouts.reduce((t, p) => t + p.amount, 0);
        console.log(`${market.show_date} ${market.kind}${market.slot !== null ? ' ' + market.slot : ''}` +
                    `${market.subject ? ' ' + market.subject : ''} -> ${outcome}` +
                    ` (${payouts.length} paid, ${total.toFixed(2)}g)`);
        if (DRY) { settled++; continue; }

        // one call per payout: the ledger row and the balance move together, so a
        // failure can never leave a market recorded as paid but unpaid. the
        // ledger's unique index makes a rerun a no-op.
        for (const p of payouts) {
            const { error: sErr } = await sb.rpc('settle_payout', {
                p_user: p.user_id, p_market: market.id,
                p_amount: p.amount, p_reason: p.reason,
            });
            if (sErr) throw sErr;
        }

        const { error: uErr } = await sb.from('pred_markets').update({
            status: outcome === 'void' ? 'void' : 'resolved',
            resolved_outcome: outcome === 'void' ? null : outcome,
            resolved_at: new Date().toISOString(),
        }).eq('id', market.id);
        if (uErr) throw uErr;
        settled++;
    }

    console.log(`${settled} markets settled${DRY ? ' (dry run)' : ''}`);
}

main().catch(e => { console.error(e); process.exit(1); });
