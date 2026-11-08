#!/usr/bin/env python3
"""
analyze_recording.py — estimate whether an archive.org show is a phone recording
(the phone's built-in mics) from short audio clips sampled straight off archive.org.

Usage:
    python analyze_recording.py gybe2013-04-15 gybe2025-03-13.samsung
    python analyze_recording.py --json gybe2013-04-15
    python analyze_recording.py --tracks 1 --clips 2 <identifier>     # faster, noisier

Requires ffmpeg/ffprobe and curl on PATH, plus numpy. FLAC/WAV clips are fetched
with single HTTP range requests (byte offset computed from the header) in parallel;
other formats fall back to ffmpeg's own remote seeking.

Measured per clip, then median across clips:
  - side_db:  side-vs-mid energy (very negative = mono). Phones' built-in mics are often mono.
  - hf_ratio: 10–16 kHz level relative to 1–4 kHz. Phone mics/processing are dull up top.
  - cliff_db: steepest drop across ~1.75 kHz between 11 kHz and 92% of Nyquist —
              the brick-wall lowpass of an AAC/MP3 encode (phone voice-memo apps).
  - crest_db: peak-to-RMS. Phone AGC/limiting lowers it (so does heavy mastering).
  Also stored but unused by the model: corr, lf_ratio, lra, hf_cutoff, coarse spectrum.

The verdict comes from a logistic model fitted on 135 labelled 2024–2026 GY!BE items
(16 phone, 119 not; labels from uploaders' source notes). "Phone" means the phone's
own mics: an external mic recorded *into* a phone (Shure MV88, DPA > Apogee) counts
as not-phone. Leave-one-out on that set: 13/16 phones caught, 3/119 false alarms.
Known blind spots: stereo phones with a clean top end (e.g. Pixel 4a), heavily
limited masters (low crest), and mono non-phone sources (wireless lav mics).

Separately, a lossy-source verdict (was MP3/AAC anywhere in the chain, whatever the
upload format?) from the steepest lowpass wall in the mid or side channel, whether it
sits at the same frequency in every clip, and top-band dropouts:
  lossy (wall >= 20 dB) / possible lossy source (10-20 dB) / no lossy trace.
On 2024-2026 items: 9/9 lossy uploads -> lossy; 3/4 FLACs mixed from lossy sources ->
possible; 2/130 lossless -> possible. Opus/YouTube (~20 kHz lowpass) is invisible.
Files at >=88.2 kHz also get a check for being upsampled from 44.1/48 kHz.
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import warnings
from concurrent.futures import ThreadPoolExecutor

import numpy as np

ARCHIVE_META = 'https://archive.org/metadata/'
ARCHIVE_DL = 'https://archive.org/download/'
AUDIO_EXT = ('.flac', '.wav', '.shn', '.aiff', '.aif', '.mp3', '.m4a', '.ogg')
LOSSLESS_EXT = ('.flac', '.wav', '.shn', '.aiff', '.aif')

# Metadata keywords → informational note only. Not used in the probability: "phone"
# in a description doesn't say whether an external mic was plugged into it.
KEYWORD_HINTS = [
    (r'\b(sbd|soundboard|board feed|desk feed)\b', 'soundboard'),
    (r'\b(iphone|samsung|galaxy|pixel|android|phone|smartphone|mobile|xiaomi|honor|voice memo)\b',
     'phone'),
    (r'\b(zoom|h[124]n?|h5|h6|tascam|dr-?\d+|sony pcm|pcm-[a-z0-9]+|roland|r-?0\d|r-?09|'
     r'olympus|edirol|m-?audio|marantz|sound devices|mixpre|sd ?7\d\d|lotoo|deity|minidisc|md|'
     r'dat|tcd-?d\w+|da-?p1|sony mz|nagra|korg|fostex|tcd)\b', 'recorder'),
    (r'\b(schoeps|neumann|akg|dpa\d*|sennheiser|core sound|church audio|ca-?1[14]|cs-?\d+|'
     r'audio-technica|at\d{3,4}|mk ?4|mk ?41|km ?184|mbho|beyer\w*|line audio|cm[34]|'
     r'mv88\+?|ambeo|rode|nt\d|shure|sanken|cos-?11|sound professionals|sp-\w+|nevaton|'
     r'austrian audio|pom-?2739\w*|diy (?:omni )?mics?|omni mics?|binaural|lark|dji|ecm-?\w+|'
     r'oktava|microtech|gefell|josephson|earthworks|countryman|lapel)\b', 'external_mics'),
]

# Logistic model, L2 lambda=10, fitted on 2024–2026 GY!BE items (see module docstring).
# Each feature is clipped, standardised with mean/sd, then weighted; positive → phone.
MODEL = {
    'features': ['side_db', 'hf_ratio_db', 'cliff_db', 'crest_db'],
    'clip': {'side_db': (-60, 0), 'cliff_db': (0, 40)},
    'mean': [-12.193, -28.148, 6.516, 14.226],
    'sd': [12.438, 5.845, 6.404, 1.458],
    'weights': [-0.643, -0.552, 0.704, -0.646],
    'bias': -1.038,
}
FEATURE_TEXT = {
    'side_db': ('stereo width',
                lambda m: 'mono' if m['side_db'] < -40 else f"side {m['side_db']:.0f} dB below mid"),
    'hf_ratio_db': ('top end (10–16 kHz vs 1–4 kHz)', lambda m: f"{m['hf_ratio_db']:.0f} dB"),
    'cliff_db': ('lossy lowpass wall',
                 lambda m: f"{m['cliff_db']:.0f} dB drop at {m['cliff_hz'] / 1000:.1f} kHz"),
    'crest_db': ('crest factor', lambda m: f"{m['crest_db']:.1f} dB"),
}


def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'gybe-recording-helper'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8', errors='replace'))


def strip_html(s):
    return re.sub(r'<[^>]+>', ' ', s or '')


def pick_tracks(files, n):
    """Pick up to n original audio files, lossless preferred, longest first.
    Returns ([(name, length_s, size_bytes)], lossless_available)."""
    originals = [f for f in files
                 if f.get('source') == 'original' and f['name'].lower().endswith(AUDIO_EXT)]
    lossless = [f for f in originals if f['name'].lower().endswith(LOSSLESS_EXT)]
    pool = lossless or originals
    if not pool:  # fall back to derivatives (e.g. only VBR MP3 exists)
        pool = [f for f in files if f['name'].lower().endswith(AUDIO_EXT)]

    def length(f):
        try:
            return float(f.get('length') or 0)
        except ValueError:  # "mm:ss" style
            parts = [float(p) for p in str(f['length']).split(':')]
            return sum(p * 60 ** i for i, p in enumerate(reversed(parts)))

    pool = sorted(pool, key=length, reverse=True)
    return [(f['name'], length(f), int(f.get('size') or 0)) for f in pool[:n]], bool(lossless)


def probe(url):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
         'stream=codec_name,sample_rate,channels,bits_per_raw_sample,sample_fmt,bit_rate',
         '-of', 'json', url],
        capture_output=True, text=True, timeout=120)
    try:
        return json.loads(out.stdout)['streams'][0]
    except (KeyError, IndexError, json.JSONDecodeError):
        return {}


def fetch_range(url, start, end, patient=False):
    """GET bytes [start, end] inclusive. Returns (bytes, final_url).

    Uses curl rather than urllib: archive.org's storage nodes (dnXXXXXX.*.archive.org)
    use Let's Encrypt's newer chain, which some Python/OpenSSL trust stores reject as
    'certificate has expired' while the OS TLS stack (and curl) accepts it.

    Stragglers dominate scan time (median request ~1.5 s, slowest ~10 s), so a transfer
    slower than 100 kB/s for 5 s is aborted; callers retry via the archive.org/download
    URL, whose redirect can land on the item's other storage node. Some nodes are slow
    for everything, though, so `patient=True` (used for the last attempt) drops that floor."""
    speed = [] if patient else ['--speed-limit', '100000', '--speed-time', '5']
    out = subprocess.run(
        ['curl', '-sSfL', '--retry', '2', *speed, '-A', 'gybe-recording-helper',
         '-r', f'{start}-{end}', '-w', '%{stderr}%{url_effective}', '-o', '-', url],
        capture_output=True, timeout=300 if patient else 120)
    if out.returncode != 0:
        raise RuntimeError(f'curl failed for {url}: {out.stderr.decode(errors="replace")}')
    return out.stdout, out.stderr.decode(errors='replace').strip().splitlines()[-1]


CLIP_BYTES = 4_000_000  # cap per clip: hi-res/32-bit files get shorter clips, not more data
MIN_CLIP_S = 8.0        # never below this (analysis needs >= 5 s of decoded audio)


def retrying(fn, *args, tries=3):
    """Call fn(*args), retrying on any exception (archive.org nodes intermittently 5xx)."""
    import time
    for attempt in range(tries):
        try:
            return fn(*args)
        except Exception as e:
            err = e
            if attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))  # brief backoff: 5xx bursts are short-lived
    raise err


def fetch_patiently(url, start, end):
    """fetch_range with retries: two fast attempts (slow transfers aborted, so a redirect
    can find a quicker node), then one with no speed floor for nodes that are always slow."""
    try:
        return retrying(fetch_range, url, start, end, tries=2)
    except Exception:
        return fetch_range(url, start, end, True)


def probe_retry(url):
    p = {}
    for _ in range(2):
        p = probe(url)
        if p:
            break
    return p


def parse_header(head):
    """Read the format from a file's first bytes and build the minimal header to splice in
    front of a mid-file chunk. Returns (header_bytes, fmt, audio_start) or None if the
    container isn't FLAC/WAV (or a WAV header is truncated).

    FLAC: only 'fLaC' + STREAMINFO (always first, 34 bytes) is needed, re-flagged as the last
    metadata block -- so tags and embedded artwork (seen up to 6 MB) are never downloaded.
    audio_start is then unknown and returned as None; FLAC resyncs on frame headers anyway."""
    if head[:4] == b'fLaC' and len(head) >= 42 and head[4] & 0x7f == 0:
        x = int.from_bytes(head[18:26], 'big')
        fmt = {'codec': 'flac', 'sample_rate': x >> 44,
               'channels': ((x >> 41) & 7) + 1, 'bits': ((x >> 36) & 31) + 1}
        return head[:4] + bytes([0x80]) + head[5:42], fmt, None
    if head[:4] == b'RIFF' and head[8:12] == b'WAVE':
        i, fmt = 12, None
        while i + 8 <= len(head):
            cid, ln = head[i:i + 4], int.from_bytes(head[i + 4:i + 8], 'little')
            if cid == b'fmt ':
                b = head[i + 8:i + 24]
                fmt = {'codec': 'pcm', 'channels': int.from_bytes(b[2:4], 'little'),
                       'sample_rate': int.from_bytes(b[4:8], 'little'),
                       'bits': int.from_bytes(b[14:16], 'little'),
                       'block_align': int.from_bytes(b[12:14], 'little')}
            elif cid == b'data':
                return (head[:i + 8], fmt, i + 8) if fmt else None
            i += 8 + ln + (ln & 1)
    return None


def decode_bytes(data, sr):
    """Decode an in-memory (possibly spliced) file to float32 stereo."""
    cmd = ['ffmpeg', '-v', 'quiet', '-err_detect', 'ignore_err', '-i', 'pipe:0',
           '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1']
    out = subprocess.run(cmd, input=data, capture_output=True, timeout=120)
    a = np.frombuffer(out.stdout, dtype=np.float32)
    return a.reshape(-1, 2) if a.size >= 2 else None


def decode_clip(url, start, dur, sr):
    """Fallback: let ffmpeg seek the remote file itself (slow without a seek table)."""
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{start:.1f}', '-t', f'{dur:.1f}', '-i', url,
           '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-acodec', 'pcm_f32le', '-']
    out = subprocess.run(cmd, capture_output=True, timeout=300)
    a = np.frombuffer(out.stdout, dtype=np.float32)
    return a.reshape(-1, 2) if a.size >= 2 else None


def avg_spectrum(x, sr, nfft=8192):
    """Welch-style averaged power spectrum (dB) of a mono signal."""
    win = np.hanning(nfft)
    hop = nfft // 2
    frames = [x[i:i + nfft] * win for i in range(0, len(x) - nfft, hop)]
    if not frames:
        return None, None
    p = np.mean(np.abs(np.fft.rfft(np.array(frames), axis=1)) ** 2, axis=0)
    return np.fft.rfftfreq(nfft, 1 / sr), 10 * np.log10(p + 1e-20)


def band_db(freqs, spec_db, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return 10 * np.log10(np.mean(10 ** (spec_db[m] / 10)) + 1e-20)


def hf_cutoff(freqs, spec_db):
    """Highest frequency whose 250 Hz band stays within 50 dB of the 1–4 kHz level
    and isn't part of the flat noise floor. Returns Hz."""
    ref = band_db(freqs, spec_db, 1000, 4000)
    floor = np.percentile(spec_db[freqs > freqs[-1] * 0.97], 50)
    step = 250
    edges = np.arange(4000, freqs[-1], step)
    cutoff = 4000
    for lo in edges:
        lvl = band_db(freqs, spec_db, lo, lo + step)
        if lvl > ref - 50 and lvl > floor + 6:
            cutoff = lo + step
    return float(min(cutoff, freqs[-1]))


BAND_STEP = 250  # Hz, resolution of the stored coarse spectrum
BAND_TOP = 24000


def coarse_bands(freqs, spec_db):
    """Mid-channel spectrum in 250 Hz bands, dB relative to the 1–4 kHz level.
    Bands above Nyquist are NaN so recordings at different rates line up."""
    ref = band_db(freqs, spec_db, 1000, 4000)
    out = []
    for lo in range(0, BAND_TOP, BAND_STEP):
        if lo + BAND_STEP > freqs[-1]:
            out.append(np.nan)
        else:
            out.append(band_db(freqs, spec_db, lo, lo + BAND_STEP) - ref)
    return np.array(out)


def steepest_cliff(bands, sr):
    """Largest level drop across ~1.75 kHz (3 bands either side of a 250 Hz band),
    searched between 11 kHz and 92% of Nyquist so the anti-alias filter is ignored.
    Lossy encoders' lowpass gives a 20–60 dB wall; acoustic roll-off is gradual.
    Returns (drop_db, centre_hz)."""
    best, at = 0.0, 0.0
    hi = min(BAND_TOP, sr / 2 * 0.92)
    for i in range(int(11000 / BAND_STEP), int(hi / BAND_STEP) - 3):
        before, after = bands[i - 3:i], bands[i + 1:i + 4]
        if np.isnan(before).any() or np.isnan(after).any():
            continue
        d = float(np.mean(before) - np.mean(after))
        if d > best:
            best, at = d, (i + 0.5) * BAND_STEP
    return best, at


def stft_power(x, nfft=2048, hop=1024):
    """Power spectrogram (frames × bins) with a Hann window."""
    win = np.hanning(nfft)
    n = (len(x) - nfft) // hop
    if n < 4:
        return None
    idx = np.arange(nfft)[None, :] + hop * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(x[idx] * win, axis=1)) ** 2


def hf_gating(P, sr, nfft, cliff_db, cliff_hz):
    """Lossy encoders switch the top band on and off frame by frame when bits run short
    (MP3 sfb21, AAC zeroed bands); real mics fade smoothly. Looks at the 3 kHz just below
    the lossy wall if there is one, else just below 19.5 kHz.
    Returns (dropout fraction of loud frames, median frame-to-frame jump in dB)."""
    f = np.fft.rfftfreq(nfft, 1 / sr)
    top = cliff_hz - 250 if cliff_db >= 15 else min(19500, sr / 2 * 0.9)
    lo = max(top - 3000, 11000)
    if top - lo < 1000:
        return np.nan, np.nan
    hf = P[:, (f >= lo) & (f < top)].mean(1)
    md = P[:, (f >= 1000) & (f < 4000)].mean(1)
    r = 10 * np.log10(hf / (md + 1e-20) + 1e-20)
    loud = md > np.percentile(md, 50)
    if loud.sum() < 4:
        return np.nan, np.nan
    ref = np.percentile(r[loud], 90)
    return float(np.mean(r[loud] < ref - 25)), float(np.median(np.abs(np.diff(r))))


def side_cliff(freqs, side_spec, sr, side_db):
    """Joint-stereo encoders starve the side (L-R) channel first, so its lowpass wall
    is often steeper or lower than the mid's -- and it survives being mixed with a
    lossless source better than the mid's wall does. Returns steepest side drop (dB)."""
    if side_db < -40:  # mono: nothing to measure
        return np.nan
    return steepest_cliff(coarse_bands(freqs, side_spec), sr)[0]


def hires_check(freqs, spec, sr):
    """For ≥88.2 kHz files: level of 24 kHz+ content re 1–4 kHz, and the steepest drop
    between 18 and 26 kHz. A real hi-res capture has a gently sloping ultrasonic floor;
    one upsampled from 44.1/48k falls off a wall near 20–24 kHz into digital silence."""
    if sr < 88200:
        return np.nan, np.nan
    ref = band_db(freqs, spec, 1000, 4000)
    ultra = band_db(freqs, spec, 24000, min(40000, sr / 2 * 0.9)) - ref
    lv = [band_db(freqs, spec, lo, lo + 500) for lo in range(17000, 27500, 500)]
    best = max(np.mean(lv[i - 3:i]) - np.mean(lv[i + 1:i + 4]) for i in range(3, len(lv) - 3))
    return float(ultra), float(best)


def analyze_clip(stereo, sr):
    L, R = stereo[:, 0].astype(np.float64), stereo[:, 1].astype(np.float64)
    mid, side = (L + R) / 2, (L - R) / 2
    e_mid, e_side = np.sum(mid ** 2), np.sum(side ** 2)
    if e_mid < 1e-9:
        return None
    corr = float(np.sum(L * R) / np.sqrt(np.sum(L ** 2) * np.sum(R ** 2) + 1e-20))
    side_db = float(10 * np.log10(e_side / e_mid + 1e-12))

    freqs, spec = avg_spectrum(mid, sr)
    ref = band_db(freqs, spec, 1000, 4000)
    hf = band_db(freqs, spec, 10000, 16000) - ref
    lf = band_db(freqs, spec, 40, 80) - band_db(freqs, spec, 200, 800)
    cutoff = hf_cutoff(freqs, spec)
    bands = coarse_bands(freqs, spec)
    cliff_db, cliff_hz = steepest_cliff(bands, sr)

    blk = int(sr * 0.4)
    nb = len(mid) // blk
    rms = np.sqrt(np.mean(mid[:nb * blk].reshape(nb, blk) ** 2, axis=1))
    rms_db = 20 * np.log10(rms[rms > 1e-6])
    lra = float(np.percentile(rms_db, 95) - np.percentile(rms_db, 10)) if rms_db.size > 4 else 0.0
    crest = float(20 * np.log10(np.max(np.abs(mid)) / (np.sqrt(np.mean(mid ** 2)) + 1e-12)))

    # Lossy-encoding traces (see the helper docstrings).
    nfft = 2048
    P = stft_power(mid, nfft)
    dropout, jitter = hf_gating(P, sr, nfft, cliff_db, cliff_hz) if P is not None else (np.nan,) * 2
    _, side_spec = avg_spectrum(side, sr)
    side_cl = side_cliff(freqs, side_spec, sr, side_db)
    ultra, hires_cliff = hires_check(freqs, spec, sr)

    return {'corr': corr, 'side_db': side_db, 'hf_ratio_db': float(hf),
            'lf_ratio_db': float(lf), 'hf_cutoff_hz': cutoff, 'lra_db': lra,
            'crest_db': crest, 'level_dbfs': float(20 * np.log10(np.sqrt(np.mean(mid ** 2)))),
            'cliff_db': cliff_db, 'cliff_hz': cliff_hz,
            'hf_dropout': dropout, 'hf_jitter_db': jitter, 'side_cliff_db': side_cl,
            'ultra_db': ultra, 'hires_cliff_db': hires_cliff, 'bands': bands}


def metadata_hints(meta):
    text = ' '.join(strip_html(str(meta.get(k, ''))) for k in
                    ('source', 'lineage', 'taper', 'description', 'notes', 'title', 'identifier'))
    text = text.lower()
    hints = []
    for pat, label in KEYWORD_HINTS:
        m = re.search(pat, text)
        if m:
            hints.append((label, m.group(0)))
    return hints


def classify(agg):
    """Phone probability from the fitted model. Returns (p_phone, reasons), reasons
    sorted by how much each feature moved the score."""
    z = MODEL['bias']
    contrib = []
    for name, mu, sd, w in zip(MODEL['features'], MODEL['mean'], MODEL['sd'], MODEL['weights']):
        lo, hi = MODEL['clip'].get(name, (-np.inf, np.inf))
        c = w * (float(np.clip(agg[name], lo, hi)) - mu) / sd
        z += c
        label, describe = FEATURE_TEXT[name]
        side = 'phone' if c > 0 else 'not phone'
        contrib.append((c, f'{label}: {describe(agg)}  [{side} {c:+.2f}]'))
    contrib.sort(key=lambda t: -abs(t[0]))
    return float(1 / (1 + np.exp(-z))), [t[1] for t in contrib]


# P(lossy encode somewhere in the chain), from the steepest lowpass wall in the mid or
# side channel. Logistic fit (L2 lambda=3) on 2024-2026 GY!BE items: 13 lossy (9 lossy
# uploads, whose walls are what a FLAC made from them would show, + 4 FLACs mixed from
# lossy sources) vs 130 lossless. Leave-one-out at the site's 0.7 thresholds: 10/13 lossy
# -> lossy, 127/130 lossless -> lossless, 0 lossless called lossy, 1 lossy called lossless
# (a YouTube Opus mixdown, whose ~20 kHz lowpass no audio test here can see).
# Equivalent cut-offs: lossless (P <= 0.3) at wall <= 8.8 dB, lossy (P >= 0.7) at >= 16.1 dB.
LOSSY_MODEL = {'mean': 7.542, 'sd': 8.156, 'weight': 1.880, 'bias': -1.132, 'clip': 40.0}
CONFIDENT = 0.7   # the site colours a recording only at >= 70% either way


def lossy_wall(agg):
    """Steepest lowpass wall (dB) in the mid or side channel."""
    side = agg.get('side_cliff_db')
    return max(agg['cliff_db'], side if side is not None and not np.isnan(side) else 0.0)


def p_lossy(agg, lossless_upload=True):
    """Probability that a lossy encode is somewhere in the chain. A lossy upload format
    (MP3/AAC/...) is lossy by definition."""
    if not lossless_upload:
        return 1.0
    m = LOSSY_MODEL
    z = m['bias'] + m['weight'] * (min(lossy_wall(agg), m['clip']) - m['mean']) / m['sd']
    return float(1 / (1 + np.exp(-z)))


def lossy_verdict(agg, fmt, lossless_upload=True):
    """Was a lossy encode anywhere in this recording's chain? Independent of the upload
    format: a FLAC made from an MP3 keeps the MP3's lowpass wall.
    Returns (verdict, p_lossy, reasons, upsampled_note); verdict is 'lossy', 'lossless'
    or 'uncertain' at the CONFIDENT threshold."""
    wall = lossy_wall(agg)
    which = 'side channel' if wall != agg['cliff_db'] else 'mid channel'
    p = p_lossy(agg, lossless_upload)
    why = [f"steepest wall {wall:.0f} dB ({which}) at ~{agg['cliff_hz'] / 1000:.1f} kHz; "
           f"same spot in {agg['cliff_consistency']:.0%} of clips"]
    if not lossless_upload:
        why.insert(0, f"uploaded in a lossy format ({fmt.get('codec') or 'lossy'})")
    if p >= CONFIDENT:
        verdict = 'lossy'
    elif p <= 1 - CONFIDENT:
        verdict = 'lossless'
        why.append('note: Opus (YouTube) and 320k MP3 lowpass near 20 kHz and may not show')
    else:
        verdict = 'uncertain'
        why.append('in the range of mixes containing a lossy source, but also of a few '
                   'heavily processed lossless recordings')

    upsampled = None
    u, hc = agg.get('ultra_db'), agg.get('hires_cliff_db')
    if u is not None and not np.isnan(u):
        if u < -70 and hc >= 15:
            upsampled = (f"{fmt['sample_rate'] // 1000} kHz file but nothing above ~22 kHz "
                         f"({u:.0f} dB, {hc:.0f} dB wall) - likely upsampled from 44.1/48 kHz")
        else:
            upsampled = f"genuine high-rate content above 24 kHz ({u:.0f} dB)"
    return verdict, p, why, upsampled


# What the uploader's own source notes say about the equipment, when they're explicit.
# Used by the site in preference to the model ("stated" beats "estimated").
_PHONE_RE = re.compile(r'\b(i ?phone|samsung|galaxy|pixel|android|smartphone|cell ?phone|mobile phone|'
                       r'phone|xiaomi|honor|huawei|oneplus|voice memo|a?msung|apple watch)\b', re.I)
# Non-phone chains: dedicated recorders, external mics, and board/broadcast/tape/video
# sources ("T (AUD) > CDr", "SBD", "FM", "VHS", DAT decks like D7/D8/D100).
_OTHER_SOURCES = (r'\b(sbd|soundboard|board|fm|broadcast|radio|cassette|tape|vhs|hi-?8|dat|'
                  r'd[3-9]|d\d{2,3}|m1|mics?|microphones?|dpa\d+s?|sd ?7\d\d\w*|mz-\w+|r-?\d\d\w*|'
                  r'zoom\w*|pcm-?\d+\w*|km ?\d+|h\d{1,3}n?|iriver|dsm-?\w+|ak40|m300s?|jb)\b'
                  r'|\bt\s*[(>]|^\s*t\s*$')
_GEAR_RE = re.compile('|'.join([KEYWORD_HINTS[2][0], KEYWORD_HINTS[3][0], _OTHER_SOURCES]), re.I)
PHONE_ERA_START = 2009  # no concert recordings from phones' own mics before this


def stated_equipment(source, date=None):
    """'phone' if the source notes name only phone gear, 'not phone' if they name a
    dedicated recorder, external mics (e.g. 'DPA > MMA-A > iPhone' is an external mic into
    a phone) or a board/broadcast/tape source, else None (not stated). Recordings dated
    before PHONE_ERA_START are 'not phone' whatever the notes say."""
    if date and date[:4].isdigit() and int(date[:4]) < PHONE_ERA_START:
        return 'not phone'
    s = strip_html(source or '')
    if not s.strip() or s.strip().lower() in ('unknown', 'aud', 'matrix'):
        return None
    # "internal mics" / "phone mic" describe the phone itself, not external gear.
    s = re.sub(r'\b(internal|phone|built-?in|onboard|on-board)\s+mic(rophone)?s?\b', ' ', s, flags=re.I)
    if _GEAR_RE.search(s):
        return 'not phone'
    if _PHONE_RE.search(s):
        return 'phone'
    return None


def analyze(identifier, n_tracks=3, clips_per_track=2, clip_len=20.0, verbose=True, workers=8,
            use_metadata=True, pool=None):
    """Analyse one show. Pass a shared `pool` (ThreadPoolExecutor) to interleave several
    shows' downloads; otherwise a private pool of `workers` threads is used."""
    data = fetch_json(ARCHIVE_META + urllib.parse.quote(identifier))
    meta, files = data.get('metadata', {}), data.get('files', [])
    tracks, lossless = pick_tracks(files, n_tracks)
    if not tracks:
        raise SystemExit(f'{identifier}: no audio files found')

    own_pool = pool is None
    if own_pool:
        pool = ThreadPoolExecutor(max_workers=workers)
    base = ARCHIVE_DL + urllib.parse.quote(identifier) + '/'

    def get_header(url):
        head, final = fetch_patiently(url, 0, 65535)
        parsed = parse_header(head)
        if parsed is None and head[:4] == b'RIFF':  # WAV with a large chunk before 'data'
            head, final = fetch_patiently(final, 0, 4 * 1024 * 1024)
            parsed = parse_header(head)
        return final, parsed

    def get_chunk(url, off, nbytes):
        return fetch_patiently(url, off, off + nbytes)[0]

    def starts_for(length, secs):
        return [float(s) for s in np.linspace(length * 0.2, max(length * 0.8 - secs, length * 0.2),
                                              clips_per_track)]

    # Submit every network request for this show up front: headers and clip ranges go out
    # together (FLAC/WAV offsets are estimated from file size, so they needn't wait for the
    # header), and they share `pool` with any other shows being scanned at the same time.
    plans = []
    for name, length, size in tracks:
        url = base + urllib.parse.quote(name)
        if name.lower().endswith(('.flac', '.wav')) and size and length:
            bps = size / length
            secs = float(np.clip(CLIP_BYTES / bps, MIN_CLIP_S, clip_len))
            chunks = []
            for st in starts_for(length, secs):
                off = int(st * bps)
                chunks.append((st, off, pool.submit(get_chunk, url, off, int(bps * (secs + 2)))))
            plans.append(('range', name, url, length, pool.submit(get_header, url), chunks))
        else:
            plans.append(('seek', name, url, length or 600, pool.submit(probe_retry, url), None))

    clips, fmt = [], None
    seek_jobs = []
    for kind, name, url, length, hfut, chunks in plans:
        try:
            if kind == 'range':
                final, parsed = hfut.result()
                if not parsed:  # odd container despite the extension: let ffmpeg seek
                    print(f'  {name}: unrecognised header, falling back to ffmpeg seek',
                          file=sys.stderr)
                    for c in chunks:
                        c[2].cancel()
                    p = probe_retry(final)
                    sr0 = int(p.get('sample_rate') or 44100)
                    fmt = fmt or {'codec': p.get('codec_name'), 'sample_rate': sr0,
                                  'channels': int(p.get('channels') or 2),
                                  'bits': int(p.get('bits_per_raw_sample') or 0) or None}
                    for st in starts_for(length, clip_len):
                        seek_jobs.append((name, st, sr0, pool.submit(
                            retrying, decode_clip, url, st, clip_len, sr0)))
                    continue
                hdr, tfmt, astart = parsed
                for st, off, cfut in chunks:
                    try:
                        chunk = cfut.result()
                    except Exception as e:
                        print(f'  skipping clip {name} @ {st:.0f}s: {e}', file=sys.stderr)
                        continue
                    ba = tfmt.get('block_align')
                    if ba:  # WAV: realign the speculative offset to a sample frame
                        chunk = chunk[(-(off - astart)) % ba:]
                    if verbose:
                        print(f'  sampling {name} @ {st:.0f}s', file=sys.stderr)
                    a = decode_bytes(hdr + chunk, tfmt['sample_rate'])
                    r = analyze_clip(a, tfmt['sample_rate']) if a is not None and len(a) >= tfmt['sample_rate'] * 5 else None
                    if r:
                        r['track'], r['start'] = name, round(st)
                        clips.append(r)
                fmt = fmt or tfmt
            else:
                p = hfut.result()
                tfmt = {'codec': p.get('codec_name'), 'sample_rate': int(p.get('sample_rate') or 44100),
                        'channels': int(p.get('channels') or 2),
                        'bits': int(p.get('bits_per_raw_sample') or 0) or None}
                fmt = fmt or tfmt
                for st in starts_for(length, clip_len):
                    seek_jobs.append((name, st, tfmt['sample_rate'],
                                      pool.submit(retrying, decode_clip, url, st, clip_len, tfmt['sample_rate'])))
        except Exception as e:  # archive.org nodes intermittently 5xx
            print(f'  skipping {name}: {e}', file=sys.stderr)
    for name, st, sr, fut in seek_jobs:
        try:
            a = fut.result()
        except Exception as e:
            print(f'  skipping clip {name} @ {st:.0f}s: {e}', file=sys.stderr)
            continue
        if verbose:
            print(f'  sampling {name} @ {st:.0f}s', file=sys.stderr)
        r = analyze_clip(a, sr) if a is not None and len(a) >= sr * 5 else None
        if r:
            r['track'], r['start'] = name, round(st)
            clips.append(r)
    if own_pool:
        pool.shutdown()

    if not clips:
        raise SystemExit(f'{identifier}: could not decode any audio')

    keys = ['corr', 'side_db', 'hf_ratio_db', 'lf_ratio_db', 'hf_cutoff_hz', 'lra_db', 'crest_db',
            'level_dbfs', 'cliff_db', 'cliff_hz', 'hf_dropout', 'hf_jitter_db',
            'side_cliff_db', 'ultra_db', 'hires_cliff_db']
    with warnings.catch_warnings():  # all-NaN (mono side, non-hi-res, above Nyquist) is expected
        warnings.simplefilter('ignore', RuntimeWarning)
        agg = {k: float(np.nanmedian([c[k] for c in clips])) for k in keys}
        bands = np.nanmedian(np.array([c.pop('bands') for c in clips]), axis=0)
    # Same-place cliff: an encoder's lowpass sits at one frequency in every clip, even when
    # a mix with lossless sources shrinks it; real roll-off "cliffs" wander.
    hz = np.array([c['cliff_hz'] for c in clips if c['cliff_db'] >= 6])
    agg['cliff_consistency'] = (float(np.mean(np.abs(hz - np.median(hz)) <= 500)) * len(hz) / len(clips)
                                if len(hz) else 0.0)
    for c in clips:
        for k, v in c.items():
            if isinstance(v, float) and np.isnan(v):
                c[k] = None
    hints = metadata_hints(meta) if use_metadata else []
    p_phone, reasons = classify(agg)
    lossy, p_loss, lossy_reasons, upsampled = lossy_verdict(agg, fmt, lossless)
    return {
        'identifier': identifier,
        'verdict': 'phone' if p_phone >= 0.5 else 'not phone',
        'p_phone': round(p_phone, 3),
        'lossy_verdict': lossy,
        'p_lossy': round(p_loss, 3),
        'lossy_reasons': lossy_reasons,
        'sample_rate_check': upsampled,
        'metadata_mentions': [{'kind': k, 'word': w} for k, w in hints],
        'format': fmt,
        'lossless_original': lossless,
        'measurements': {k: (None if np.isnan(v) else round(v, 3)) for k, v in agg.items()},
        'reasons': reasons,
        'metadata': {k: strip_html(str(meta.get(k, ''))).strip()[:600]
                     for k in ('source', 'lineage', 'taper') if meta.get(k)},
        'clips': clips,
        # Coarse mid spectrum (250 Hz bands from 0 Hz, dB re 1–4 kHz) for offline re-fitting.
        'bands': [None if np.isnan(b) else round(float(b), 2) for b in bands],
    }


def analyze_many(identifiers, n_tracks=3, clips_per_track=2, clip_len=20.0, workers=24,
                 verbose=True, use_metadata=True, cache=None, refresh=False):
    """Scan many shows with one shared download pool, so one show's slow request never
    leaves connections idle. Returns {identifier: result or {'identifier', 'error'}}.
    With `cache` (a JSON file path), previously scanned shows are reused and each new
    result is written back as soon as it finishes."""
    import os
    import threading
    done = {}
    if cache and os.path.exists(cache) and not refresh:
        with open(cache, encoding='utf-8') as fh:
            done = json.load(fh)
    todo = [i for i in dict.fromkeys(identifiers) if i not in done or 'error' in done[i]]
    lock = threading.Lock()
    finished = [0]

    def one(ident):
        try:
            r = analyze(ident, n_tracks, clips_per_track, clip_len, verbose=verbose,
                        use_metadata=use_metadata, pool=net)
        except BaseException as e:  # SystemExit from analyze, network errors, ...
            r = {'identifier': ident, 'error': str(e)}
        with lock:
            # per-clip detail is diagnostic only; keeping it out keeps the cache small
            done[ident] = {k: v for k, v in r.items() if k != 'clips'} if cache else r
            finished[0] += 1
            if verbose:
                print(f"[{finished[0]}/{len(todo)}] {ident}: {r.get('verdict', 'ERROR')}",
                      file=sys.stderr)
            if cache:
                tmp = cache + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as fh:
                    json.dump(done, fh)
                os.replace(tmp, cache)
        return r

    # Show-level threads only orchestrate and wait; all network I/O runs in `net`, so
    # waiting on futures can't deadlock. ~2 shows per 3 connections keeps the pipe full.
    with ThreadPoolExecutor(max_workers=workers) as net, \
            ThreadPoolExecutor(max_workers=max(1, min(len(todo), workers * 2 // 3))) as shows:
        list(shows.map(one, todo))
    return done


PHONE_ESTIMATE_MIN = 0.7  # an unstated recording is labelled phone only at >= 70%

# Lossy stages named in source/lineage text. MiniDisc (ATRAC) and DAB (MP2) are lossy codecs.
_LOSSY_CHAIN = re.compile(
    r'\b(mp3|mp2|aac|m4a|ogg|opus|vorbis|wma|atrac|(?:3[2-9]|[4-9]\d|[1-3]\d\d) ?kbps|lossy|'
    r'youtube|vimeo|bilibili|instagram|facebook|soundcloud|mixcloud|(?:live)?stream (?:rip|download|capture)|'
    r'streamed|livestream|webcast|voice memo|dab|'
    # MiniDisc: MD, MZ-R55 / MZR50 / MZ-RH1 / MZ-N707, Sharp MD-MS702, decks MDS-JE640 / MDS-JA20ES
    r'mini ?disc|md|hi-?sp|hi-?lp|mz-?[a-z]{0,3}-?\d+\w*|md-[a-z]{0,3}\d+\w*|mds[ -]?[a-z]{0,3}-?\d+\w*|mdja\w*)\b',
    re.I)
# Phrases that mention a lossy format without the recording having passed through one.
#   e.g. "Do not encode this data-set to lossy formats like mp3." -> drop the whole sentence.
_LOSSY_NEGATED = re.compile(r"[^.\n|]*\b(do not|don't|dont|never|please don't|not to)\b[^.\n|]*", re.I)
_MD_PCM = re.compile(r'\b(hi-?md\b.*\bpcm|pcm\b.*\bhi-?md|linear pcm)\b', re.I)
# A lossless origin: DAT decks, PCM/solid-state recorders, FM/broadcast (analog, band-limited
# to ~15 kHz but no codec). Mics alone or "unknown > CDr" don't qualify: the origin could be lossy.
_LOSSLESS_ORIGIN = re.compile(
    r'\b(dat|tcd-?d?\w*|d[3-9]|d\d{2,3}|da-?p1|da-?\d{2}|dtc-?\w*|pcm-?\w+|sony pcm|zoom\w*|'
    r'h[124]n?|h[1456]e?|tascam|dr-?\d+\w*|roland|r-?0\d\w*|r-?09\w*|r-?\d\d\w*|edirol|olympus|marantz|'
    r'pmd\w*|sound devices|sd ?7\d\d\w*|mixpre|lotoo|deity|iriver|fm|broadcast)\b', re.I)


# A lossless format or PCM spec written at the recording stage: "(24/48)", "WAV 16/44",
# "24bit/48kHz", "48/24", "FLAC (16/44.1)", "linear PCM". Only trusted in the *source* field:
# nearly every lineage ends "> FLAC", even after an MP3 stage.
_LOSSLESS_FORMAT = re.compile(
    r'\b(wav|wave|bwf|aiff?|flac|alac|dsd|linear pcm|pcm)\b|\b(16|24|32) ?-?bits?\b|'
    r'\b(16|24|32) ?/ ?(44(\.1)?|48|88(\.2)?|96|192)\b|\b(44(\.1)?|48|88(\.2)?|96|192) ?(k(hz)?)? ?/ ?(16|24|32)\b',
    re.I)
_UNKNOWN_ORIGIN = re.compile(r'\b(unknown|unknow|unsure|possibly|probably)\b|\?', re.I)


def stated_chain(source, lineage):
    """'lossy' if the source/lineage notes name a lossy stage, 'lossless' if they name a
    lossless origin (recording gear, or a lossless format/PCM spec at the source) and no
    lossy stage, else None (unknown: the audio analysis decides)."""
    text = ' '.join(strip_html(t or '') for t in (source, lineage))
    if not text.strip() or text.strip().lower() in ('unknown', 'unknown unknown'):
        return None
    scan = _LOSSY_NEGATED.sub(' ', text)
    hit = _LOSSY_CHAIN.search(scan)
    if hit and not (hit.group(0).lower() in ('md', 'minidisc', 'mini disc') and _MD_PCM.search(scan)):
        return 'lossy'
    src = _LOSSY_NEGATED.sub(' ', strip_html(source or ''))
    if _LOSSLESS_FORMAT.search(src) and not _UNKNOWN_ORIGIN.search(src):
        return 'lossless'   # e.g. "... > Apogee Metarecorder (24/48) > iPhone 13 Pro"
    if _LOSSLESS_ORIGIN.search(scan):
        # a mic like the Zoom iQ7 into a phone app says nothing about the file format
        if _PHONE_RE.search(scan) and not re.search(r'\b(wav|flac|aiff?|pcm)\b', scan, re.I):
            return None
        return 'lossless'
    return None


def site_labels(result, source, date, lineage=None):
    """The labels the site shows for one recording, from a cached analyze() result plus
    the setlist's source and lineage notes. Probabilities are recomputed from the stored
    measurements, so model updates apply without re-scanning.

    Lossy/lossless: a lossy upload format is lossy; otherwise the notes win when they say
    (stated_chain), and the analysis decides only when they don't. A stated-lossless chain
    whose audio still has a hard lowpass wall is reported as band-limited (e.g. a 32 kHz
    DAT long-play recording: lossless, but nothing above ~16 kHz)."""
    m = {k: (np.nan if v is None else v) for k, v in result['measurements'].items()}
    m.setdefault('side_cliff_db', np.nan)
    m.setdefault('cliff_consistency', 0.0)
    verdict, pl, _, upsampled = lossy_verdict(m, result['format'], result['lossless_original'])
    # When a lossy encode already explains the lowpass wall, the wall says nothing about
    # the device, so it's neutralised for the phone estimate. (In the 2024-26 training set
    # lossy uploads were mostly phones; in 2010-18 MP3 uploads were common for everything,
    # and without this every unlabelled MP3 came out "phone".)
    mp = dict(m)
    if verdict == 'lossy':
        mp['cliff_db'] = MODEL['mean'][MODEL['features'].index('cliff_db')]
    pp, _ = classify(mp)
    stated = stated_equipment(source, date)
    phone = stated == 'phone' or (stated is None and pp >= PHONE_ESTIMATE_MIN)
    f = result['format']
    chain = stated_chain(source, lineage)
    lossy_from = 'analysis'
    band_limited = None
    if not result['lossless_original']:
        lossy_from = 'format'                    # verdict is already 'lossy' (p = 1)
    elif chain == 'lossy':
        verdict, lossy_from = 'lossy', 'notes'
    elif chain == 'lossless':
        if verdict == 'lossy':                   # a wall, but no codec in the chain
            band_limited = round(m['cliff_hz'] / 1000, 1)
        verdict, lossy_from = 'lossless', 'notes'
    out = {'phone': phone, 'stated': stated, 'p_phone': round(pp, 2), 'p_lossy': round(pl, 2),
           'lossy': verdict, 'lossy_from': lossy_from,
           'format': f"{f.get('codec') or '?'}" + (f" {f['bits']}-bit" if f.get('bits') else '') +
                     f" / {f['sample_rate'] / 1000:g} kHz"}
    if upsampled and upsampled.startswith(str(f['sample_rate'] // 1000)):
        out['upsampled'] = True
    if band_limited:
        out['band_limited_khz'] = band_limited
    return out


def site_spectrum(result):
    """44-point mid spectrum (0–22 kHz, 500 Hz steps, dB re 1–4 kHz) plus the numbers the
    shows tab prints beside it."""
    b = result.get('bands') or []
    m = result['measurements']
    pts = []
    for i in range(0, 88, 2):
        pair = [v for v in b[i:i + 2] if v is not None]
        pts.append(round(sum(pair) / len(pair)) if pair else None)
    side = m.get('side_cliff_db')
    return {'bands': pts, 'wall_db': round(lossy_wall({'cliff_db': m['cliff_db'],
                                                       'side_cliff_db': np.nan if side is None else side}), 1),
            'wall_hz': m['cliff_hz'], 'side_db': round(m['side_db'], 1),
            'top_db': round(m['hf_ratio_db'], 1), 'crest_db': round(m['crest_db'], 1)}


def export_site(cache_path, setlists_path='setlists.json', out_dir='.'):
    """Write recording-analysis.json (labels, loaded on every page) and
    recording-spectra.json (fetched when the shows tab's spectrogram view is turned on)
    for every recording in setlists.json that has a cached analysis."""
    import os
    with open(cache_path, encoding='utf-8') as fh:
        cache = json.load(fh)
    with open(setlists_path, encoding='utf-8') as fh:
        shows = json.load(fh)
    labels, spectra = {}, {}
    for s in shows:
        for rec in s.get('recordings', []):
            r = cache.get(rec['id'])
            if not r or 'error' in r:
                continue
            labels[rec['id']] = site_labels(r, rec.get('source'), s['date'], rec.get('lineage'))
            spectra[rec['id']] = site_spectrum(r)
    for name, data in (('recording-analysis.json', labels), ('recording-spectra.json', spectra)):
        with open(os.path.join(out_dir, name), 'w', encoding='utf-8') as fh:
            json.dump(data, fh, separators=(',', ':'), sort_keys=True)
    return labels, spectra


def print_report(r):
    print(f"\n=== {r['identifier']} ===")
    f = r['format']
    print(f"Format:  {f.get('codec')} {f.get('bits') or '?'}-bit / {f['sample_rate']} Hz, "
          f"{f['channels']} ch, lossless original: {r['lossless_original']}")
    for k, v in r['metadata'].items():
        print(f'{k.capitalize():8} {v}')
    m = r['measurements']
    print(f"Stereo:  corr {m['corr']:.2f}, side {m['side_db']:.1f} dB")
    print(f"Spectrum: cutoff ~{m['hf_cutoff_hz']/1000:.1f} kHz, HF(10–16k) {m['hf_ratio_db']:.1f} dB, "
          f"LF(40–80) {m['lf_ratio_db']:.1f} dB")
    print(f"Dynamics: LRA {m['lra_db']:.1f} dB, crest {m['crest_db']:.1f} dB, level {m['level_dbfs']:.1f} dBFS")
    print('Model contributions (largest first):')
    for w in r['reasons']:
        print('  -', w)
    if r['metadata_mentions']:
        print('Metadata mentions: ' + ', '.join(f"{h['word']} ({h['kind']})"
                                                for h in r['metadata_mentions']))
    print(f"VERDICT: {r['verdict'].upper()}   (p_phone {r['p_phone']:.0%})")
    print(f"LOSSY:   {r['lossy_verdict'].upper()}   (upload is "
          f"{'lossless' if r['lossless_original'] else 'lossy'} format)")
    for w in r['lossy_reasons']:
        print('  -', w)
    if r['sample_rate_check']:
        print(f"RATE:    {r['sample_rate_check']}")


def main():
    if hasattr(sys.stdout, 'reconfigure'):  # Windows consoles default to cp1252
        sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('identifiers', nargs='*')
    ap.add_argument('--from-setlists', metavar='FILE', nargs='?', const='setlists.json',
                    help='also scan every recording listed in this setlists file '
                         '(default setlists.json); use with --cache so only new ones are scanned')
    ap.add_argument('--export-site', action='store_true',
                    help='after scanning, write recording-analysis.json and recording-spectra.json '
                         'for the website from --cache (with no identifiers: export only)')
    ap.add_argument('--tracks', type=int, default=3, help='tracks to sample (longest first)')
    ap.add_argument('--clips', type=int, default=2, help='clips per track')
    ap.add_argument('--clip-len', type=float, default=20.0, help='seconds per clip')
    ap.add_argument('--workers', type=int, default=24,
                    help='parallel downloads, shared across all shows (archive.org throughput '
                         'scales to ~30-50 connections)')
    ap.add_argument('--json', action='store_true', help='emit JSON instead of a report')
    ap.add_argument('--no-metadata', action='store_true',
                    help='skip the metadata keyword note (the verdict never uses metadata)')
    ap.add_argument('--cache', metavar='FILE',
                    help='JSON file of past results keyed by identifier; shows already in it '
                         'are not re-scanned, new results are added as they finish')
    ap.add_argument('--refresh', action='store_true', help='with --cache: re-scan everything')
    args = ap.parse_args()
    if args.export_site and not args.cache:
        ap.error('--export-site needs --cache')
    ids = list(args.identifiers)
    if args.from_setlists:
        with open(args.from_setlists, encoding='utf-8') as fh:
            ids += [r['id'] for s in json.load(fh) for r in s.get('recordings', [])]
    if not ids and not args.export_site:
        ap.error('give identifiers, --from-setlists, or --export-site')

    results = analyze_many(ids, args.tracks, args.clips, args.clip_len,
                           workers=args.workers, verbose=not args.json,
                           use_metadata=not args.no_metadata, cache=args.cache,
                           refresh=args.refresh) if ids else {}
    if args.export_site:
        labels, _ = export_site(args.cache, args.from_setlists or 'setlists.json')
        print(f'exported labels for {len(labels)} recordings', file=sys.stderr)
    if args.from_setlists or not args.identifiers:
        return  # bulk runs: the cache and exported files are the output
    ordered = [results[i] for i in args.identifiers if i in results]
    if args.json:
        print(json.dumps(ordered if len(ordered) > 1 else ordered[0], indent=2))
    else:
        for r in ordered:
            if 'error' in r:
                print(f"\n=== {r['identifier']} ===\nERROR: {r['error']}")
            else:
                print_report(r)


if __name__ == '__main__':
    main()
