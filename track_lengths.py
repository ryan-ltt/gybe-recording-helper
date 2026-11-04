#!/usr/bin/env python3
# track_lengths.py
# Lengths shown on the site:
#   recording['length']  seconds: the recording's audio files on archive.org added up
#                        (soundcheck/bonus tracks left out)
#   show['length']       the preferred recording's length (best-recordings.json),
#                        else the longest recording's
#   show['song_lengths'] seconds per setlist song, aligned with show['songs'], taken
#                        only from human timings in human-song-lengths.csv; null for
#                        songs nobody has timed
#
# human-song-lengths.csv is an export of the song-lengths sheet: Show, Source, then
# "Song N length" columns in m:ss. Song N is the Nth song of the show's setlist
# (soundcheck entries and notes like "[pause]" don't count). Replace the file with a
# new export and run this script (or let the daily update run it).
#
# Usage:
#   python track_lengths.py               # apply human timings + show lengths, write if changed
#   (every run prints coverage and any sheet rows that don't fit their setlist)
#   python track_lengths.py --backfill    # fetch lengths for recordings that lack one
#   (--dry-run to skip writing setlists.json)

import csv
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(SCRIPT_DIR, 'setlists.json')
SONGS_JS = os.path.join(SCRIPT_DIR, 'songs.js')
HUMAN_PATH = os.path.join(SCRIPT_DIR, 'human-song-lengths.csv')
BEST_PATH = os.path.join(SCRIPT_DIR, 'best-recordings.json')
ARCHIVE_META = 'https://archive.org/metadata/'

AUDIO_FORMATS = {'flac', 'shorten', 'vbr mp3', 'ogg vorbis', '24bit flac', 'mp3', 'wav', 'aiff', 'apple lossless audio'}
AUDIO_EXTS = ('.flac', '.shn', '.mp3', '.wav', '.aif', '.aiff', '.m4a', '.ogg')
# Tracks that aren't part of the show: left out of the recording length.
EXCLUDE_RE = re.compile(r'\b(sound ?check|bonus|filler|hidden track|opening act|support act|dj set)\b', re.I)


# ─── Setlist songs (songs.js aliases) ───────────────────────────────────────
def _load_song_map():
    src = open(SONGS_JS, encoding='utf-8').read()
    body = src[src.index('const MAP = {'):]
    body = body[:body.index('};')]
    return {k: v for _, k, _, v in re.findall(r"""(['"])(.*?)\1\s*:\s*(['"])(.*?)\3""", body)}

SONG_MAP = _load_song_map()

def normalize_song(raw):
    """Port of normalizeSong() in songs.js — keep the two in step."""
    s = raw.lower()
    s = re.sub(r'\s+thanks to\b.*', '', s)
    s = re.sub(r'\s+\[.*', '', s)
    s = re.sub(r'\s+note\s*:.*', '', s)
    s = re.sub(r'\s+(order not confirmed|only the confirmed|unconfirmed).*', '', s)
    s = re.sub(r'\s+".*', '', s)
    s = re.sub(r'\(soundcheck\)|\(tape\)', '', s)
    s = re.sub(r'\s*\(w/[^)]+\)', '', s)
    s = re.sub(r'\s*\(aborted\)', '', s)
    s = re.sub(r'\s*\(\?\)', '', s)
    s = s.replace('motherfucking', 'motherfucker')
    s = s.replace('motherfucker=redeemer', 'motherfucker = redeemer', 1)
    return SONG_MAP.get(s.strip())

def setlist_song(raw):
    """Canonical song for a setlist entry, or None for entries that aren't part of
    the set (soundchecks, notes)."""
    return None if re.search(r'sound ?check', raw, re.I) else normalize_song(raw)

def song_slots(show):
    """Indexes of show['songs'] that count as the set's songs, in order."""
    return [j for j, raw in enumerate(show.get('songs') or []) if setlist_song(raw)]


# ─── Recording lengths from archive.org ─────────────────────────────────────
def _to_sec(v):
    if v in (None, ''):
        return None
    v = str(v).strip()
    try:
        if ':' in v:
            sec = 0.0
            for part in v.split(':'):
                sec = sec * 60 + float(part)
            return sec
        return float(v)
    except ValueError:
        return None

def recording_length(meta):
    """Seconds of show audio in an IA metadata dict, or None if it has no audio."""
    files = meta.get('files', [])
    originals = [
        f for f in files
        if f.get('source') == 'original'
        and (f.get('format', '').lower() in AUDIO_FORMATS or f['name'].lower().endswith(AUDIO_EXTS))
    ]
    if not originals:
        return None
    # Items often hold one set of tracks per format/bit depth (flac16 + flac24, or
    # flac + mp3). Take the largest set, preferring lossless when sizes tie.
    groups = {}
    for f in originals:
        groups.setdefault((os.path.dirname(f['name']), os.path.splitext(f['name'])[1].lower()), []).append(f)
    rank = {'.flac': 0, '.shn': 1, '.wav': 2, '.aiff': 2, '.aif': 2, '.m4a': 3, '.ogg': 4, '.mp3': 5}
    best = min(groups.items(), key=lambda kv: (-len(kv[1]), rank.get(kv[0][1], 9)))[1]
    # originals sometimes lack a length; their derivatives usually carry one
    derived = {f['original']: _to_sec(f['length']) for f in files if f.get('original') and f.get('length')}
    total = 0.0
    for f in best:
        title = (f.get('title') or '') + ' ' + os.path.basename(f['name'])
        if not EXCLUDE_RE.search(title):
            total += _to_sec(f.get('length')) or derived.get(f['name']) or 0
    return int(round(total)) or None

def fetch_metadata(identifier, retries=3):
    req = urllib.request.Request(ARCHIVE_META + identifier, headers={'User-Agent': 'Mozilla/5.0'})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8', errors='replace'))
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))


# ─── Human timings ──────────────────────────────────────────────────────────
def load_human(path=HUMAN_PATH):
    """→ [(sheet date, source id, [seconds, ...])] for rows with any timing."""
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            cols = sorted((k for k in row if k and re.match(r'Song \d+ length', k)), key=lambda k: int(k.split()[1]))
            vals = [(row[k] or '').strip() for k in cols]
            while vals and not vals[-1]:
                vals.pop()
            if not vals:
                continue
            secs = [int(round(_to_sec(v))) if _to_sec(v) else None for v in vals]
            source = (row.get('Source') or '').strip().rstrip('/').split('/')[-1]
            rows.append(((row.get('Show') or '').strip(), source, secs))
    return rows

def apply_human(shows, rows=None):
    """Set show['song_lengths'] from human timings only. Returns problems found."""
    rows = load_human() if rows is None else rows
    by_date = {}
    for s in shows:
        by_date.setdefault(s['date'][:10], []).append(s)
        s.pop('song_lengths', None)
    problems = []
    for date, source, secs in rows:
        cands = by_date.get(date, [])
        if not cands:
            problems.append(f'{date}: no show with this date')
            continue
        # two shows on one date (early/late): the source recording tells them apart
        show = next((s for s in cands if any(r['id'] == source for r in s['recordings'])), cands[0])
        slots = song_slots(show)
        if len(secs) < len(slots):
            problems.append(f'{date}: {len(secs)} timings for {len(slots)} setlist songs; not used')
            continue
        if len(secs) > len(slots):
            problems.append(f'{date}: {len(secs)} timings for {len(slots)} setlist songs; extra ones at the end ignored')
        lengths = [None] * len(show['songs'])
        for j, sec in zip(slots, secs):
            lengths[j] = sec
        if any(lengths):
            show['song_lengths'] = lengths
    return problems


# ─── Show lengths ───────────────────────────────────────────────────────────
def load_best_recordings():
    try:
        with open(BEST_PATH, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}

def apply_show_lengths(shows):
    best = load_best_recordings()
    for s in shows:
        s.pop('length', None)
        recs = [r for r in s.get('recordings', []) if r.get('length')]
        if not recs:
            continue
        pick = next((r for r in recs if r['id'] == best.get(s['date'])), None) or max(recs, key=lambda r: r['length'])
        s['length'] = pick['length']

def finalize(shows):
    """Recompute show lengths and song lengths. Call before writing setlists.json."""
    apply_show_lengths(shows)
    return apply_human(shows)


# ─── CLI ────────────────────────────────────────────────────────────────────
def backfill(shows):
    todo = [r for s in shows for r in s.get('recordings', []) if 'length' not in r]
    print(f'Fetching lengths for {len(todo)} recording(s)...')

    def work(r):
        try:
            return r, recording_length(fetch_metadata(r['id']))
        except Exception as e:
            print(f'  [{r["id"]}] error: {e}')
            return r, None

    with ThreadPoolExecutor(6) as ex:
        for r, length in ex.map(work, todo):
            if length:
                r['length'] = length

def report(shows, problems):
    timed = [s for s in shows if s.get('song_lengths')]
    songs = sum(1 for s in timed for x in s['song_lengths'] if x)
    print(f'shows with human song timings: {len(timed)} ({songs} songs)')
    print(f'shows with a show length:      {sum(1 for s in shows if s.get("length"))}')
    for p in problems:
        print('  sheet:', p)

def main():
    args = sys.argv[1:]
    with open(JSON_PATH, encoding='utf-8') as f:
        before = f.read()
    shows = json.loads(before)
    if '--backfill' in args:
        backfill(shows)
    problems = finalize(shows)
    report(shows, problems)
    after = json.dumps(shows, indent=2)
    if '--dry-run' in args or after == json.dumps(json.loads(before), indent=2):
        print('setlists.json unchanged' if '--dry-run' not in args else '[dry run] not written')
        return
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        f.write(after)
    print('Wrote setlists.json')

if __name__ == '__main__':
    main()
