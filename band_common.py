#!/usr/bin/env python3
"""
band_common.py — shared helpers for the multi-band pipeline.

Functions copied from update-shows.py intentionally (not imported from it)
so that update-shows.py remains bit-identical and its daily GY!BE job cannot
break due to changes here.
"""

import urllib.request
import urllib.parse
import re
import html as html_mod
import json
import os
import time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php'
ARCHIVE_META = 'https://archive.org/metadata/'

# ─── HTTP helper ──────────────────────────────────────────────────────────────

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode('utf-8', errors='replace')


# ─── Archive.org helpers ──────────────────────────────────────────────────────

def fetch_archive_recordings(creator_query, extra_filter='', rows=500):
    """Fetch recordings from archive.org using the given creator query."""
    q = creator_query
    if extra_filter:
        q += f' {extra_filter}'
    url = (f'{ARCHIVE_SEARCH}?q={urllib.parse.quote(q)}'
           f'&fl[]=identifier&fl[]=title&fl[]=date&rows={rows}&output=json')
    try:
        data = fetch(url)
        results = json.loads(data)
        docs = results.get('response', {}).get('docs', [])
        recordings = []
        for doc in docs:
            identifier = doc.get('identifier', '')
            if not identifier:
                continue
            raw_date = doc.get('date', '')
            concert_date = raw_date[:10] if len(raw_date) >= 10 else ''
            recordings.append({
                'id': identifier,
                'url': f'https://archive.org/details/{identifier}',
                'title': doc.get('title', identifier),
                'concert_date': concert_date,
            })
        return recordings
    except Exception as e:
        print(f'  archive.org fetch error: {e}')
        return []


def fetch_archive_metadata(identifier):
    """Fetch and return raw metadata dict for an archive.org item."""
    try:
        data = fetch(ARCHIVE_META + identifier)
        return json.loads(data)
    except Exception as e:
        print(f'    metadata fetch error: {e}')
        return {}


def _parse_info_txt(txt, lineage='', source=''):
    """Parse a .txt info file for Lineage/Source fields, including multi-line chain continuations."""
    lines = txt.splitlines()
    collecting = None
    collected = []

    for line in lines:
        stripped = line.strip()
        m = re.match(r'^(lineage|source(?:\s+info)?)\s*:\s*(.*)', stripped, re.IGNORECASE)
        if m:
            field = 'source' if 'source' in m.group(1).lower() else 'lineage'
            value = m.group(2).strip()
            if field == 'lineage' and not lineage:
                collecting = 'lineage'
                collected = [value] if value else []
            elif field == 'source' and not source:
                collecting = 'source'
                collected = [value] if value else []
            else:
                collecting = None
        elif collecting:
            if stripped == '' or re.match(r'^-{4,}', stripped):
                result = ' '.join(collected).strip()
                if collecting == 'lineage':
                    lineage = result
                else:
                    source = result
                collecting = None
                collected = []
            elif stripped:
                collected.append(stripped)

    if collecting and collected:
        result = ' '.join(collected).strip()
        if collecting == 'lineage':
            lineage = result
        else:
            source = result

    return lineage, source


def fetch_archive_details(identifier):
    """Fetch metadata once and return {'lineage': str, 'source': str, 'songs': list}."""
    meta = fetch_archive_metadata(identifier)

    def extract_str(key):
        val = meta.get('metadata', {}).get(key, '')
        if isinstance(val, list):
            val = ' '.join(val)
        return val.strip()

    lineage = extract_str('lineage')
    source = extract_str('source')

    if not lineage or not source:
        desc = meta.get('metadata', {}).get('description', '')
        if isinstance(desc, list):
            desc = '\n'.join(desc)
        for line in re.split(r'[\n\r]+|<br\s*/?>', desc):
            line_clean = html_mod.unescape(re.sub(r'<[^>]+>', '', line)).strip()
            m = re.match(r'^(lineage|source(?:\s+info)?)\s*:\s*(.*)', line_clean, re.IGNORECASE)
            if m:
                field = 'source' if 'source' in m.group(1).lower() else 'lineage'
                value = m.group(2).strip()
                if field == 'lineage' and not lineage:
                    lineage = value
                elif field == 'source' and not source:
                    source = value

    if not lineage or not source:
        txt_file = next((f['name'] for f in meta.get('files', []) if f.get('format') == 'Text'), None)
        if txt_file:
            try:
                txt_url = f'https://archive.org/download/{identifier}/{urllib.parse.quote(txt_file)}'
                txt = fetch(txt_url)
                lineage, source = _parse_info_txt(txt, lineage, source)
            except Exception:
                pass

    songs = []
    audio_formats = {'flac', 'shorten', 'vbr mp3', 'ogg vorbis', '24bit flac', 'mp3', 'wav'}
    tracks = []
    for f in meta.get('files', []):
        if f.get('format', '').lower() not in audio_formats:
            continue
        if f.get('source', '') == 'derivative':
            continue
        title = f.get('title', '').strip()
        if not title:
            continue
        try:
            num = int(str(f.get('track', '999')).split('/')[0])
        except ValueError:
            num = 999
        tracks.append((num, title))

    if tracks:
        tracks.sort()
        songs = [t[1] for t in tracks]
    else:
        desc = meta.get('metadata', {}).get('description', '')
        if isinstance(desc, list):
            desc = '\n'.join(desc)
        if desc:
            for line in re.split(r'[\n\r]+|<br\s*/?>', desc):
                line = re.sub(r'<[^>]+>', '', line)
                line = re.sub(r'^\d+[\.\)]\s*', '', line).strip()
                if line and 2 < len(line) < 80:
                    songs.append(line)

    return {'lineage': lineage, 'source': source, 'songs': songs}


def check_recording_live(url):
    """Return True if the archive.org URL resolves (not 404)."""
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status < 400
    except urllib.error.HTTPError as e:
        return e.code != 404
    except Exception:
        return True


def prune_dead_recordings(shows):
    """Remove recordings that 404 on archive.org. Returns (pruned_shows, removed_list)."""
    removed = []
    for show in shows:
        live = []
        for rec in show.get('recordings', []):
            if check_recording_live(rec['url']):
                live.append(rec)
            else:
                removed.append({'date': show['date'], 'venue': show.get('venue', ''), 'id': rec['id']})
                print(f'  - [{rec["id"]}] on {show["date"]} is dead (404) — removing')
            time.sleep(0.1)
        show['recordings'] = live
    return shows, removed


# ─── Band registry helpers ────────────────────────────────────────────────────

def load_bands(path=None):
    if path is None:
        path = os.path.join(SCRIPT_DIR, 'bands.json')
    with open(path) as f:
        return json.load(f)


def get_band(slug, path=None):
    registry = load_bands(path)
    for band in registry['bands']:
        if band['slug'] == slug:
            return band
    raise KeyError(f'Band "{slug}" not found in bands.json')


def load_data(data_file):
    path = os.path.join(SCRIPT_DIR, data_file)
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)


def save_data(data_file, shows):
    path = os.path.join(SCRIPT_DIR, data_file)
    with open(path, 'w') as f:
        json.dump(shows, f, indent=2)


