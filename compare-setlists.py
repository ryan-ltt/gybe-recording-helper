#!/usr/bin/env python3
# compare-setlists.py
# Compares song lists on gybecc.neocities.org against setlists.json.
# Only reports shows where the song lists differ.
#
# Usage:
#   python compare-setlists.py                      # check all years
#   python compare-setlists.py 25 26                # check specific year suffixes
#   python compare-setlists.py 2022-03-05           # check a single show by date
#   python compare-setlists.py 2022-03-05 --verbose # also print scraped songs when they match
#   python compare-setlists.py --fix                # apply gybecc songs to all differing shows

import urllib.request
import re
import json
import time
import sys
import os

BASE = 'https://gybecc.neocities.org/gybecc/'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(SCRIPT_DIR, 'setlists.json')
DATA_PATH = os.path.join(SCRIPT_DIR, 'setlists-data.js')

YEAR_PAGES = [
    '95','96','97','98','99',
    '00','01','02','03',
    '10','11','12','13','14','15','16','17','18','19','20',
    '22','23','24','25','26',
]

args = sys.argv[1:]
verbose = '--verbose' in args
fix = '--fix' in args
date_args = [a for a in args if re.match(r'^\d{4}-\d{2}-\d{2}$', a)]
year_args = [a for a in args if re.match(r'^\d{2}$', a)]

# If specific dates given, derive year suffixes from them
if date_args:
    years_to_check = list(dict.fromkeys(d[2:4] for d in date_args))
elif year_args:
    years_to_check = year_args
else:
    years_to_check = YEAR_PAGES

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode('utf-8', errors='replace')

def strip_tags(s):
    return re.sub(r'<[^>]+>', '', s).strip()

def normalize_date(d):
    parts = d.split('-')
    if len(parts[0]) == 2:
        y = int(parts[0])
        parts[0] = ('19' if y >= 90 else '20') + parts[0]
    return '-'.join(parts)

def extract_show_links(html):
    links, seen = [], set()
    for m in re.finditer(r'href="((\d{2,4}-\d{2}-\d{2})\.html)"', html):
        date = normalize_date(m.group(2))
        if date not in seen:
            seen.add(date)
            links.append({'url': BASE + m.group(1), 'date': date})
    return links

def parse_songs(html):
    songs = []
    for m in re.finditer(r'<li[^>]*>([\s\S]*?)(?=<li|</li|<br|</td|</tr|$)', html, re.I):
        raw = m.group(1)
        text = re.sub(r'\s+', ' ', strip_tags(raw)).strip()
        text = re.sub(r'\s*back\s*$', '', text, flags=re.I).strip()
        text = re.sub(r'&[a-z]+;', ' ', text).strip()
        text = re.sub(r'\s+', ' ', text).strip()
        text = re.sub(r'\s+note\s*:.*$', '', text, flags=re.I).strip()
        text = re.sub(r'\s*\[incomplete\].*$', '', text, flags=re.I).strip()
        if text and 1 < len(text) < 80:
            songs.append(text)
    if not songs:
        bm = re.search(r'<body[^>]*>([\s\S]*)</body>', html, re.I)
        if bm:
            for part in re.split(r'<br\s*/?>', bm.group(1), flags=re.I):
                text = re.sub(r'\s+', ' ', strip_tags(part)).strip()
                if text and 1 < len(text) < 120 and not text.startswith('['):
                    songs.append(text)
    return songs

def parse_note(html):
    """Extract 'thanks to ...' acknowledgment from the page, if present."""
    m = re.search(r'thanks\s+to\s+([\s\S]*?)(?=</(?:font|i|td|p|li)\b)', html, re.I)
    if m:
        text = re.sub(r'<[^>]+>', '', m.group(0))
        text = re.sub(r'\s+', ' ', text).strip().rstrip('.')
        return text
    return ''

def normalise(song):
    """Lowercase + collapse whitespace for fuzzy comparison."""
    return re.sub(r'\s+', ' ', song.lower().strip())

def main():
    with open(JSON_PATH) as f:
        existing = json.load(f)
    local = {s['date']: s for s in existing}

    diffs = []
    total_checked = 0

    for yr in years_to_check:
        url = BASE + yr + '.html'
        print(f'Scanning {url} ...', flush=True)
        try:
            html = fetch(url)
        except Exception as e:
            print(f'  ERROR: {e}')
            continue

        links = extract_show_links(html)
        for link in links:
            date = link['date']
            if date_args and date not in date_args:
                continue
            if date not in local:
                continue  # missing shows are update-shows.py's job
            total_checked += 1
            try:
                show_html = fetch(link['url'])
            except Exception as e:
                print(f'  {date}: fetch error — {e}')
                continue

            live_songs = parse_songs(show_html)
            live_note = parse_note(show_html)
            local_songs = local[date].get('songs', [])

            live_norm = [normalise(s) for s in live_songs]
            local_norm = [normalise(s) for s in local_songs]

            if live_norm != local_norm:
                only_live = [s for s, n in zip(live_songs, live_norm) if n not in local_norm]
                only_local = [s for s, n in zip(local_songs, local_norm) if n not in live_norm]
                diffs.append({
                    'date': date,
                    'venue': local[date].get('venue', ''),
                    'live': live_songs,
                    'live_note': live_note,
                    'local': local_songs,
                    'only_live': only_live,
                    'only_local': only_local,
                })
            elif verbose:
                print(f'  {date}  {local[date].get("venue", "")}  (match)')
                for s in live_songs:
                    print(f'    {s}')

            time.sleep(0.15)

    print(f'\nChecked {total_checked} shows across {len(years_to_check)} year page(s).')

    if not diffs:
        print('No song-list differences found.')
        return

    print(f'{len(diffs)} show(s) with differences:\n')
    for d in diffs:
        print(f'  {d["date"]}  {d["venue"]}')
        if d['only_live']:
            print(f'    on gybecc only:')
            for s in d['only_live']:
                print(f'      + {s}')
        if d['only_local']:
            print(f'    in setlists.json only:')
            for s in d['only_local']:
                print(f'      - {s}')
        if not d['only_live'] and not d['only_local']:
            # Same songs, different order or whitespace
            print(f'    gybecc order: {d["live"]}')
            print(f'    local order:  {d["local"]}')
        print()

    if not fix:
        print('Run with --fix to apply gybecc songs to all differing shows.')
        return

    # Apply gybecc songs to differing shows
    print('Applying gybecc songs to differing shows...')
    for d in diffs:
        show = local[d['date']]
        show['songs'] = d['live']
        if d['live_note']:
            show['note'] = d['live_note']
        elif 'note' in show:
            del show['note']
        print(f'  fixed {d["date"]}  ({len(d["live"])} songs)')

    merged = sorted(existing, key=lambda s: s['date'])

    with open(JSON_PATH, 'w') as f:
        json.dump(merged, f, indent=2)
    print(f'\nWrote setlists.json')

    with open(DATA_PATH, 'w') as f:
        f.write('const SETLISTS_DATA = ' + json.dumps(merged, indent=2) + ';\n')
    print(f'Wrote setlists-data.js')

if __name__ == '__main__':
    main()
