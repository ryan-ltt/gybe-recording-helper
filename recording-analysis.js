// Recording labels from analyze_recording.py (see its --export-site option).
//
// recording-analysis.json (loaded on every page) → RECORDING_ANALYSIS[id]:
//   phone    true when the uploader's notes name phone gear, or when they don't say
//            and the analyzer is >= 70% sure
//   stated   'phone' | 'not phone' | null: what the uploader's source notes say
//   p_phone  analyzer's phone probability;  p_lossy  probability of a lossy encode in the chain
//   lossy    'lossless' | 'lossy' | 'uncertain'
//   lossy_from  how that was decided: 'format' (an MP3/AAC/... upload), 'notes' (the source/
//            lineage names a lossy stage such as MP3 or MiniDisc, or only lossless gear such as
//            DAT), or 'analysis' (notes don't say: lossless at p_lossy <= 0.3, lossy at >= 0.7)
//   band_limited_khz  lossless per the notes, but nothing above this frequency (e.g. 32 kHz DAT)
//   format   e.g. "flac 16-bit / 44.1 kHz";  upsampled  true for hi-res files with no hi-res content
// recording-spectra.json (fetched only when the shows tab's spectrogram view is on) →
//   RECORDING_SPECTRA[id] = { bands: 44 points 0–22 kHz in dB re 1–4 kHz, wall_db, wall_hz, ... }
//
// Filled in place so render code can read it synchronously; await RECORDING_ANALYSIS_READY first.
const RECORDING_ANALYSIS = {};
let RECORDING_SPECTRA = null;
const _analysisBase = document.currentScript.src;

const RECORDING_ANALYSIS_READY = fetch(new URL('recording-analysis.json', _analysisBase))
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(data => Object.assign(RECORDING_ANALYSIS, data))
    .catch(err => {
        console.error('failed to load recording-analysis.json', err);   // labels are optional
        return RECORDING_ANALYSIS;
    });

let _spectraPromise = null;
function loadRecordingSpectra() {
    _spectraPromise ||= fetch(new URL('recording-spectra.json', _analysisBase))
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
        .then(data => (RECORDING_SPECTRA = data))
        .catch(err => {
            _spectraPromise = null;   // let a later toggle retry
            if (typeof notifyError === 'function') notifyError('could not load the spectrogram data');
            console.error('failed to load recording-spectra.json', err);
            return null;
        });
    return _spectraPromise;
}

const recAnalysis = rec => RECORDING_ANALYSIS[rec.id] || null;
const recIsPhone = rec => !!recAnalysis(rec)?.phone;
const recQuality = rec => {           // 'lossless' | 'lossy' | null (not confident, or not analysed)
    const a = recAnalysis(rec);
    return a && a.lossy !== 'uncertain' ? a.lossy : null;
};

// Show-level: every recording is a phone recording (and there is at least one).
const showIsPhoneOnly = show => show.recordings.length > 0 && show.recordings.every(recIsPhone);
const showHasLossless = show => show.recordings.some(r => recQuality(r) === 'lossless');

function phoneOnlyFlag(show) {
    if (!showIsPhoneOnly(show)) return '';
    const stated = show.recordings.every(r => recAnalysis(r).stated === 'phone');
    const title = stated ? "every recording of this show is a phone recording (from the uploaders' notes)"
                         : 'every recording of this show is a phone recording (some estimated by audio analysis)';
    return `<span class="phone-only-flag" title="${title}">phone only</span>`;
}

const pct = p => Math.round(p * 100) + '%';

// "lossless (lineage notes)", "lossy (uploaded as mp3)", "lossless (92% sure, audio analysis)"…
function qualityText(a) {
    const from = a.lossy_from || 'analysis';
    if (from === 'format') return `lossy (uploaded as ${a.format.split(' ')[0]})`;
    if (from === 'notes') {
        if (a.lossy === 'lossy') return 'lossy (the lineage names a lossy stage, e.g. MP3 or MiniDisc)';
        return 'lossless (the source/lineage notes name only lossless gear or formats)' + (a.band_limited_khz
            ? ` · band-limited: nothing above ~${a.band_limited_khz} kHz, as from a 32 kHz DAT or FM, but no lossy codec`
            : '');
    }
    return a.lossy === 'lossless' ? `lossless (${pct(1 - a.p_lossy)} sure, audio analysis)`
         : a.lossy === 'lossy' ? `lossy (${pct(a.p_lossy)} sure, audio analysis)`
         : `lossless or lossy: unclear (${pct(a.p_lossy)} lossy, audio analysis)`;
}

// Hover text for a recording link.
function recAnalysisTitle(rec) {
    const a = recAnalysis(rec);
    if (!a) return '';
    const q = qualityText(a);
    const phone = a.stated === 'phone' ? 'phone recording (uploader notes)'
                : a.stated === 'not phone' ? 'not a phone (uploader notes)'
                : a.phone ? `likely a phone recording (${pct(a.p_phone)}, estimated)`
                : `probably not a phone (${pct(a.p_phone)} phone, estimated)`;
    return [q + ' · ' + a.format, phone, a.upsampled ? 'upsampled: no content above ~22 kHz' : '']
        .filter(Boolean).join('\n');
}

// ─── Spectrogram view (shows tab) ───────────────────────────────────────────
const SPEC_TOP = 30, SPEC_BOT = -80;   // dB range drawn, re the 1–4 kHz level

function spectrumSvg(spec, w = 240, h = 44) {
    const b = spec.bands, n = b.length;
    const x = i => (i / (n - 1)) * w;
    const y = v => Math.min(h, Math.max(0, (SPEC_TOP - (v ?? SPEC_BOT)) / (SPEC_TOP - SPEC_BOT) * h));
    const pts = b.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const grid = [5, 10, 15, 20].map(k => {
        const gx = (k * 1000 / 22000 * w).toFixed(1);
        return `<line class="spec-grid" x1="${gx}" y1="0" x2="${gx}" y2="${h}"/>`;
    }).join('');
    const showWall = spec.wall_db >= 10;
    const wx = (spec.wall_hz / 22000 * w).toFixed(1);
    const wall = showWall ? `<line class="spec-wall" x1="${wx}" y1="0" x2="${wx}" y2="${h}"/>` : '';
    const label = `spectrum 0 to 22 kHz` + (showWall ? `, lowpass wall at ${(spec.wall_hz / 1000).toFixed(1)} kHz` : '');
    return `<svg class="spec-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${label}">` +
        `<title>${label}</title>${grid}<polygon class="spec-fill" points="0,${h} ${pts} ${w},${h}"/>` +
        `<polyline class="spec-line" points="${pts}"/>${wall}</svg>`;
}

function spectrumFacts(rec, spec) {
    const a = recAnalysis(rec);
    const facts = [];
    if (a) {
        const from = a.lossy_from || 'analysis';
        const how = from === 'notes' ? 'lineage' : from === 'format' ? 'upload format' : null;
        const q = a.lossy === 'lossless' ? `<span class="spec-ok">lossless ${how ? `(${how})` : pct(1 - a.p_lossy)}</span>`
                : a.lossy === 'lossy' ? `<span class="spec-bad">lossy ${how ? `(${how})` : pct(a.p_lossy)}</span>`
                : `unclear (${pct(a.p_lossy)} lossy)`;
        facts.push(q);
    }
    facts.push(a?.band_limited_khz ? `band-limited at ${a.band_limited_khz} kHz (no codec)`
             : spec.wall_db >= 10 ? `wall ${Math.round(spec.wall_db)} dB at ${(spec.wall_hz / 1000).toFixed(1)} kHz`
             : `no lowpass wall (${Math.round(spec.wall_db)} dB)`);
    facts.push(spec.side_db < -40 ? 'mono' : `stereo (side ${Math.round(spec.side_db)} dB)`);
    facts.push(`top end ${Math.round(spec.top_db)} dB`);
    if (a) {
        facts.push(a.stated === 'phone' ? 'phone (notes)' : a.stated === 'not phone' ? 'not phone (notes)'
                 : a.phone ? `~phone ${pct(a.p_phone)}` : `phone ${pct(a.p_phone)}`);
        facts.push(a.format);
    }
    return facts.join(' · ');
}

// One block under a show row: a spectrum and its numbers for each analysed recording.
function renderSpectraList(show) {
    if (!RECORDING_SPECTRA || show.recordings.length === 0) return '';
    const rows = show.recordings.map((r, i) => {
        const spec = RECORDING_SPECTRA[r.id];
        if (!spec) return `<div class="rec-spectra-row"><a ${recLinkAttrs(show.date, r)}>[${i + 1}]</a><span class="muted">not analysed yet</span></div>`;
        return `<div class="rec-spectra-row"><a ${recLinkAttrs(show.date, r)}>[${i + 1}]</a>` +
            `<div class="spec-plot">${spectrumSvg(spec)}<div class="spec-axis"><span>0</span><span>5k</span><span>10k</span><span>15k</span><span>20k Hz</span></div></div>` +
            `<span class="spec-facts">${spectrumFacts(r, spec)}</span></div>`;
    }).join('');
    return `<div class="rec-spectra-list" onclick="event.stopPropagation()">${rows}</div>`;
}
