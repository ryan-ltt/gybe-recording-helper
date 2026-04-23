#!/usr/bin/env python3
"""
add-band.py — interactive wizard to add a new band to the pipeline.

Walks you through entering the band name, setlist.fm URL, and archive.org
creator query, verifies each against the live services, writes the entry to
bands.json, then runs the full scrape + recording import automatically.

Usage:
    python add-band.py
"""

import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BANDS_PATH = os.path.join(SCRIPT_DIR, 'bands.json')
ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php'


# ─── Helpers ──────────────────────────────────────────────────────────────────

def ask(prompt, default=None):
    suffix = f' [{default}]' if default else ''
    val = input(f'{prompt}{suffix}: ').strip()
    return val if val else default


def slugify(name):
    s = name.lower()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode('utf-8', errors='replace'))


def search_archive(creator_query, rows=5):
    """Return (total_count, list_of_sample_docs)."""
    q = creator_query
    url = (f'{ARCHIVE_SEARCH}?q={urllib.parse.quote(q)}'
           f'&fl[]=identifier&fl[]=title&fl[]=date&fl[]=creator'
           f'&rows={rows}&output=json')
    try:
        data = fetch_json(url)
        resp = data.get('response', {})
        return resp.get('numFound', 0), resp.get('docs', [])
    except Exception as e:
        print(f'  archive.org error: {e}')
        return 0, []


def load_bands():
    with open(BANDS_PATH) as f:
        return json.load(f)


def save_bands(data):
    with open(BANDS_PATH, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'\nSaved bands.json.')


# ─── Wizard steps ─────────────────────────────────────────────────────────────

def step_name():
    print('\n── Step 1: Band name ──────────────────────────────────────────')
    name = ''
    while not name:
        name = ask('Band name').strip()
        if not name:
            print('  Name cannot be empty.')
    return name


def step_slug(name):
    default = slugify(name)
    print(f'\n── Step 2: Slug ───────────────────────────────────────────────')
    print(f'  The slug is used for filenames and CLI flags (e.g. --band {default}).')
    slug = ask('Slug', default=default)
    slug = re.sub(r'[^\w-]', '-', slug).strip('-').lower()

    registry = load_bands()
    existing = {b['slug'] for b in registry['bands']}
    if slug in existing:
        print(f'  ERROR: slug "{slug}" already exists in bands.json.')
        sys.exit(1)

    return slug


def step_setlistfm():
    print('\n── Step 3: setlist.fm URL ─────────────────────────────────────')
    print('  Find the artist page on setlist.fm. The URL looks like:')
    print('  https://www.setlist.fm/setlists/artist-name-XXXXXXXX.html')
    url = ''
    while True:
        url = ask('setlist.fm artist page URL').strip()
        if re.match(r'https://www\.setlist\.fm/setlists/.+\.html', url):
            break
        print('  That doesn\'t look right — paste the full artist page URL.')
    return url


def step_archive(name):
    print('\n── Step 4: archive.org creator query ─────────────────────────')
    print('  We\'ll search archive.org\'s etree collection for this band.')
    print('  The creator name must match exactly as it appears on archive.org.')

    suggestion = f'creator:"{name}" collection:etree'

    while True:
        print(f'\n  Current query: {suggestion}')
        print('  Testing against archive.org...')
        count, samples = search_archive(suggestion)

        if count == 0:
            print('  No recordings found.')
        else:
            print(f'  Found {count} recording(s). Sample:')
            for doc in samples[:3]:
                creator = doc.get('creator', '?')
                if isinstance(creator, list):
                    creator = ', '.join(creator)
                print(f'    [{doc.get("date","?")[:10]}] {doc.get("title","?")}')
                print(f'              creator: {creator}')

        print()
        action = ask('  (a)ccept / (e)dit query / (q)uit', default='a').lower()

        if action.startswith('a'):
            if count == 0:
                confirm = ask('  No recordings found — accept anyway?', default='n').lower()
                if not confirm.startswith('y'):
                    continue
            return suggestion, count
        elif action.startswith('e'):
            raw = ask('  New query', default=suggestion).strip()
            # Let user type just the creator name as a shortcut
            if not raw.startswith('creator:') and 'collection:' not in raw:
                raw = f'creator:"{raw}" collection:etree'
            suggestion = raw
        elif action.startswith('q'):
            print('Aborted.')
            sys.exit(0)


def step_confirm(name, slug, sfm_url, archive_query, archive_count):
    entry = {
        'slug': slug,
        'name': name,
        'setlistfm_url': sfm_url,
        'archive_creator_query': archive_query,
        'data_file': f'{slug}_setlists.json',
        'managed_by': 'setlistfm',
    }

    print('\n── Step 5: Confirm ────────────────────────────────────────────')
    print('  Entry to add to bands.json:')
    print()
    print(json.dumps(entry, indent=4))
    print()
    print(f'  archive.org recordings matched: {archive_count}')
    print()

    confirm = ask('Add this band and run the import scripts? (y/n)', default='y').lower()
    if not confirm.startswith('y'):
        print('Aborted — nothing was written.')
        sys.exit(0)

    return entry


def step_write(entry):
    registry = load_bands()
    registry['bands'].append(entry)
    save_bands(registry)


def step_run_scripts(slug):
    print('\n── Running scripts ────────────────────────────────────────────')

    print(f'\n[1/2] Scraping setlist.fm for all shows (--all)...\n')
    r1 = subprocess.run(
        [sys.executable, os.path.join(SCRIPT_DIR, 'scrape-setlistfm.py'), '--band', slug, '--all'],
    )

    print(f'\n[2/2] Importing all archive.org recordings (--all-recordings)...\n')
    r2 = subprocess.run(
        [sys.executable, os.path.join(SCRIPT_DIR, 'update-band-recordings.py'), '--band', slug, '--all-recordings'],
    )

    print()
    if r1.returncode == 0 and r2.returncode == 0:
        print('Done! Both scripts completed successfully.')
        print(f'Data written to {slug}_setlists.json.')
    else:
        if r1.returncode != 0:
            print(f'WARNING: scrape-setlistfm.py exited with code {r1.returncode}')
        if r2.returncode != 0:
            print(f'WARNING: update-band-recordings.py exited with code {r2.returncode}')
        print(f'\nPartial data may have been written to {slug}_setlists.json.')
        print('You can re-run either script manually with --band', slug)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print('═' * 64)
    print('  add-band.py — add a new band to the recording helper')
    print('═' * 64)

    name          = step_name()
    slug          = step_slug(name)
    sfm_url       = step_setlistfm()
    archive_query, archive_count = step_archive(name)
    entry         = step_confirm(name, slug, sfm_url, archive_query, archive_count)

    step_write(entry)
    step_run_scripts(slug)


if __name__ == '__main__':
    main()
