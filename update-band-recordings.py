#!/usr/bin/env python3
"""
update-band-recordings.py — fetch new archive.org recordings for a non-legacy band.

Usage:
    python update-band-recordings.py --band <slug> [--all-recordings] [--since YYYY-MM-DD] [--dry-run]
"""

import argparse
import os
import sys
import time
from datetime import datetime

import band_common

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def last_update_path(slug):
    return os.path.join(SCRIPT_DIR, f'.{slug}-last-update')


def get_cutoff(slug, since_arg):
    if since_arg:
        return since_arg
    path = last_update_path(slug)
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    return '2026-03-01'


def write_last_update(slug, timestamp):
    with open(last_update_path(slug), 'w') as f:
        f.write(timestamp)


def update_band(band, all_recordings=False, since=None, dry_run=False):
    slug = band['slug']
    shows = band_common.load_data(band['data_file'])

    show_by_date = {}
    for s in shows:
        show_by_date.setdefault(s['date'], []).append(s)

    known_ids = {
        r['id']
        for s in shows
        for r in s.get('recordings', [])
    }

    if all_recordings:
        print(f'Fetching all recordings for {band["name"]} ...')
        archive_recs = band_common.fetch_archive_recordings(band['archive_creator_query'])
    else:
        cutoff = get_cutoff(slug, since)
        print(f'Fetching recordings for {band["name"]} added since {cutoff} ...')
        archive_recs = band_common.fetch_archive_recordings(
            band['archive_creator_query'],
            extra_filter=f'addeddate:[{cutoff} TO *]',
            rows=100,
        )

    print(f'  {len(archive_recs)} recording(s) returned\n')

    rec_updates = {}
    new_stubs = {}

    for rec in archive_recs:
        date = rec['concert_date']
        if not date:
            continue
        if rec['id'] in known_ids:
            continue

        date_shows = show_by_date.get(date, [])
        is_new_stub = not date_shows and date not in new_stubs
        label = 'not in data — fetching track list' if is_new_stub else 'fetching details'
        print(f'  {date}: {label} for [{rec["id"]}] ... ', end='', flush=True)

        details = band_common.fetch_archive_details(rec['id'])
        print(f'{len(details["songs"])} track(s)' if is_new_stub else 'done')

        entry = {
            'id': rec['id'],
            'url': rec['url'],
            'title': rec['title'],
            'lineage': details['lineage'] or 'unknown',
            'source': details['source'] or 'unknown',
        }

        if date_shows:
            rec_updates.setdefault(date, []).append(entry)
        elif date in new_stubs:
            new_stubs[date]['recordings'].append(entry)
        else:
            new_stubs[date] = {
                'date': date,
                'venue': '',
                'songs': details['songs'],
                'recordings': [entry],
                'setlist_pending': True,
            }

        known_ids.add(rec['id'])
        time.sleep(0.1)

    # Apply updates to existing shows
    for date, recs in sorted(rec_updates.items()):
        for existing_show in show_by_date[date]:
            existing_show['recordings'].extend(recs)
        print(f'  {date}: added {len(recs)} recording(s)')

    for stub in new_stubs.values():
        shows.append(stub)
        print(f'  {stub["date"]}: created pending stub')

    # Prune dead recordings
    if not new_stubs and not rec_updates:
        print('No new recordings — checking for dead recordings ...')
        shows, pruned = band_common.prune_dead_recordings(shows)
        if not pruned:
            print('All recordings live. Nothing to update.')
            if not dry_run:
                write_last_update(slug, datetime.now().strftime('%Y-%m-%d'))
            return
        print(f'Removed {len(pruned)} dead recording(s)')
    else:
        pruned = []

    shows_sorted = sorted(shows, key=lambda s: s['date'])
    timestamp = datetime.now().strftime('%Y-%m-%d')

    if dry_run:
        print(f'\n[dry-run] Would write {len(shows_sorted)} shows to {band["data_file"]}')
    else:
        band_common.save_data(band['data_file'], shows_sorted)
        print(f'\nWrote {len(shows_sorted)} shows to {band["data_file"]}')
        write_last_update(slug, timestamp)
    

def main():
    parser = argparse.ArgumentParser(description='Update archive.org recordings for a band.')
    parser.add_argument('--band', required=True, help='Band slug (from bands.json)')
    parser.add_argument('--all-recordings', action='store_true',
                        help='Fetch all recordings (ignore cutoff date)')
    parser.add_argument('--since', help='Override cutoff date (YYYY-MM-DD)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Report changes without writing files')
    args = parser.parse_args()

    try:
        band = band_common.get_band(args.band)
    except KeyError as e:
        print(f'ERROR: {e}')
        sys.exit(1)

    if band.get('managed_by') == 'legacy':
        print(f'ERROR: "{args.band}" is managed by the legacy GY!BE pipeline.')
        print('Use update-shows.py instead.')
        sys.exit(1)

    update_band(band, all_recordings=args.all_recordings, since=args.since, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
