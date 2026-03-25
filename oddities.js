// ─── ODDITIES TAB ────────────────────────────────────────────────────────────
let odditiesComputed = false;
let odditiesRecOnly = false;
let odditiesRanked = []; // [{showIdx, score, reasons[], rareSongs: Set}]

function readSlider(id) {
    const el = document.getElementById(id);
    return parseFloat(el.value);
}

function updateSliderLabel(id) {
    const el = document.getElementById(id);
    const label = document.getElementById(id + 'Val');
    if (label) label.textContent = el.value;
}

// Sync slider labels on page load (browser may restore values without firing oninput)
document.addEventListener('DOMContentLoaded', () => {
    ['oddWindow', 'oddRareBonus', 'oddPositionBonus', 'oddLengthBonus'].forEach(updateSliderLabel);
});

let oddYearInited = false;
function initOddYearSlider() {
    if (oddYearInited || !shows.length) return;
    oddYearInited = true;
    const years = shows.map(s => parseInt(s.date.slice(0, 4)));
    const minY = Math.min(...years);
    const maxY = Math.max(...years);
    const minEl = document.getElementById('oddYearMin');
    const maxEl = document.getElementById('oddYearMax');
    minEl.min = minY; minEl.max = maxY; minEl.value = minY;
    maxEl.min = minY; maxEl.max = maxY; maxEl.value = maxY;
    document.getElementById('oddYearLabel').textContent = `${minY} – ${maxY}`;
    document.getElementById('oddYearWrap').style.display = 'flex';
    minEl.addEventListener('pointerdown', () => { minEl.style.zIndex = 2; maxEl.style.zIndex = 1; });
    maxEl.addEventListener('pointerdown', () => { maxEl.style.zIndex = 2; minEl.style.zIndex = 1; });
}

function onOddYearSlider() {
    const minEl = document.getElementById('oddYearMin');
    const maxEl = document.getElementById('oddYearMax');
    let minVal = parseInt(minEl.value);
    let maxVal = parseInt(maxEl.value);
    if (minVal > maxVal) { minEl.value = maxVal; minVal = maxVal; }
    if (maxVal < minVal) { maxEl.value = minVal; maxVal = minVal; }
    document.getElementById('oddYearLabel').textContent = minVal === maxVal ? String(minVal) : `${minVal} – ${maxVal}`;
}

function computeOddities() {
    initOddYearSlider();

    const recOnly = document.getElementById('odditiesRecordingsOnly').checked;
    const excludeMonumental = document.getElementById('odditiesExcludeMonumental').checked;
    odditiesRecOnly = recOnly;

    const WINDOW = Math.round(readSlider('oddWindow'));
    const RARE_BONUS = readSlider('oddRareBonus');
    const POSITION_BONUS = readSlider('oddPositionBonus');
    const LENGTH_BONUS = readSlider('oddLengthBonus');
    const yearMin = parseInt(document.getElementById('oddYearMin').value);
    const yearMax = parseInt(document.getElementById('oddYearMax').value);

    // Filter to shows with setlist data (and optionally recordings)
    const pool = [];
    for (let i = 0; i < shows.length; i++) {
        const s = shows[i];
        if (s.songs.length === 0) continue;
        if (recOnly && s.recordings.length === 0) continue;
        if (excludeMonumental && s.note && /monumental/i.test(s.note)) continue;
        const y = parseInt(s.date.slice(0, 4));
        if (y < yearMin || y > yearMax) continue;
        pool.push(i);
    }

    const HALF = WINDOW / 2;
    odditiesRanked = [];

    for (let pi = 0; pi < pool.length; pi++) {
        const showIdx = pool[pi];
        const show = shows[showIdx];

        // Window: nearest WINDOW shows in pool (expand other side if clamped)
        let wStart = Math.max(0, pi - HALF);
        let wEnd = Math.min(pool.length, pi + HALF);
        if (wEnd - wStart < WINDOW) {
            if (wStart === 0) wEnd = Math.min(pool.length, wStart + WINDOW);
            else wStart = Math.max(0, wEnd - WINDOW);
        }

        // Compute song frequency in window
        const freq = {};
        let totalLengths = 0;
        let windowCount = 0;
        for (let wi = wStart; wi < wEnd; wi++) {
            if (wi === pi) continue; // exclude self
            const wShow = shows[pool[wi]];
            windowCount++;
            totalLengths += wShow.songs.length;
            const seen = new Set();
            for (const raw of wShow.songs) {
                const c = normalizeSong(raw);
                if (c && !seen.has(c)) {
                    seen.add(c);
                    freq[c] = (freq[c] || 0) + 1;
                }
            }
        }
        if (windowCount === 0) continue;

        const meanLength = totalLengths / windowCount;

        // Score this show
        let score = 0;
        const reasons = [];
        const songBreakdown = []; // [{name, freq, rarity, bonus}]
        const rareSongs = new Set();
        const canonSongs = [];

        for (const raw of show.songs) {
            const c = normalizeSong(raw);
            if (!c) continue;
            canonSongs.push(c);
            const count = freq[c] || 0;
            const f = count / windowCount;
            const rarity = 1 - f;
            let songScore = rarity;
            let bonus = false;

            if (count < 3) {
                songScore += RARE_BONUS;
                bonus = true;
            }
            score += songScore;
            if (rarity > 0.7) rareSongs.add(c);
            songBreakdown.push({ name: c, count, total: windowCount, rarity: Math.round(rarity * 100), bonus });
        }

        if (canonSongs.length === 0) continue;

        // Unusual opener/closer
        const firstCanon = canonSongs[0];
        const lastCanon = canonSongs[canonSongs.length - 1];
        const firstFreq = (freq[firstCanon] || 0) / windowCount;
        const lastFreq = (freq[lastCanon] || 0) / windowCount;
        if (firstFreq < 0.1) {
            score += POSITION_BONUS;
            reasons.push(`unusual opener: ${firstCanon} (${Math.round(firstFreq * 100)}% frequency)`);
        }
        if (lastFreq < 0.1 && lastCanon !== firstCanon) {
            score += POSITION_BONUS;
            reasons.push(`unusual closer: ${lastCanon} (${Math.round(lastFreq * 100)}% frequency)`);
        }

        // Setlist length deviation
        const lengthDev = Math.abs(show.songs.length - meanLength);
        if (lengthDev > 2) {
            const bonus = (lengthDev - 2) * LENGTH_BONUS;
            score += bonus;
            reasons.push(`${show.songs.length} songs vs ${meanLength.toFixed(1)} average`);
        }

        // Normalize: per-song, scaled
        const normalized = (score / canonSongs.length) * 10;

        odditiesRanked.push({ showIdx, score: normalized, reasons, songBreakdown, rareSongs });
    }

    odditiesRanked.sort((a, b) => b.score - a.score);
    odditiesComputed = true;
    renderOddities();
}

function renderOddities() {
    const container = document.getElementById('odditiesResults');
    if (!odditiesComputed) { container.innerHTML = ''; return; }

    const top = odditiesRanked.slice(0, 100);
    if (top.length === 0) {
        container.innerHTML = '<p style="font-family:Monaco,\'JetBrains Mono\',monospace;font-size:13px;color:inherit;">no shows to rank.</p>';
        return;
    }

    container.innerHTML = top.map((r, rank) => {
        const show = shows[r.showIdx];
        const label = `#${rank + 1} · weirdness: ${r.score.toFixed(1)}`;
        const breakdownHtml = r.songBreakdown.map(s =>
            `<div>· ${s.name}: ${s.count}/${s.total} nearby shows (${s.rarity}% rare)${s.bonus ? ' +bonus' : ''}</div>`
        ).join('');
        const bonusHtml = r.reasons.map(s => `<div>· ${s}</div>`).join('');
        const reasonsHtml = '<details class="oddities-reasons"><summary>score breakdown</summary>' + breakdownHtml + bonusHtml + '</details>';
        return renderShowCard(show, label, r.rareSongs) + reasonsHtml;
    }).join('');
}

// If oddities tab is already active when this script loads (e.g. page refresh with #oddities),
// wait for shows data to be available before computing
if (document.getElementById('tab-oddities')?.classList.contains('active')) {
    const waitForShows = setInterval(() => {
        if (shows.length > 0) { clearInterval(waitForShows); computeOddities(); }
    }, 50);
}
