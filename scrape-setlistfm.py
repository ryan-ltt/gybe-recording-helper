#!/usr/bin/env python3
"""
scrape-setlistfm.py — crawl setlist.fm for a band and merge into {slug}_setlists.json

Usage:
    python scrape-setlistfm.py --band <slug> [--all | --page N] [--dry-run]

Default (no flags) = daily-incremental mode: paginate from page 1, short-circuit
after 2 consecutive pages where every show URL is already known-complete.
"""

import argparse
import re
import sys
import time
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import HTTPError

import add_concert
import band_common


UA = 'Mozilla/5.0 (compatible; band-recording-helper/1.0)'
INTER_SHOW_SLEEP = 1.0
INTER_PAGE_SLEEP = 2.0
MAX_PAGES = 200


def fetch_page(url, retries=3):
    """Fetch URL with polite backoff on 429/503."""
    delay = 30
    for attempt in range(retries):
        try:
            req = Request(url, headers={'User-Agent': UA})
            with urlopen(req, timeout=20) as r:
                return r.read().decode('utf-8', errors='replace')
        except HTTPError as e:
            if e.code in (429, 503) and attempt < retries - 1:
                print(f'  [{e.code}] rate-limited — sleeping {delay}s ...')
                time.sleep(delay)
                delay *= 2
            else:
                raise
    return None


def listing_url(band_url, page):
    """Build a paginated listing URL from the band's setlist.fm page URL."""
    base = band_url.rstrip('/')
    if base.endswith('.html'):
        base = base[:-5]
    return f'{base}.html?page={page}'


def extract_show_urls(html):
    """Return list of absolute setlist.fm show-page URLs from a listing page."""
    # Links appear as relative paths: ../setlist/<artist>/<year>/<venue-id>.html
    relative = re.findall(r'href="\.\./setlist/([^"]+\.html)"', html)
    seen = set()
    urls = []
    for path in relative:
        url = f'https://www.setlist.fm/setlist/{path}'
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def scrape_band(band, page_start=1, all_pages=False, dry_run=False):
    slug = band['slug']
    shows = band_common.load_data(band['data_file'])

    known_complete = {
        s['setlistfm_url']
        for s in shows
        if s.get('setlistfm_url') and s.get('songs') and not s.get('setlist_pending')
    }
    known_pending = {
        s['setlistfm_url']
        for s in shows
        if s.get('setlistfm_url') and (s.get('setlist_pending') or not s.get('songs'))
    }

    show_by_url = {s['setlistfm_url']: s for s in shows if s.get('setlistfm_url')}
    show_by_date = {}
    for s in shows:
        d = s['date']
        show_by_date.setdefault(d, []).append(s)

    consecutive_complete_pages = 0
    page = page_start
    changed = False

    while True:
        url = listing_url(band['setlistfm_url'], page)
        print(f'  [page {page}] {url}')
        try:
            html = fetch_page(url)
        except Exception as e:
            print(f'  ERROR fetching listing page {page}: {e}')
            break

        show_urls = extract_show_urls(html)
        if not show_urls:
            print(f'  No show links found on page {page} — stopping.')
            break

        print(f'  Found {len(show_urls)} show URL(s) on page {page}')

        all_complete = True
        for show_url in show_urls:
            if show_url in known_complete:
                continue
            all_complete = False

            if show_url in known_pending or show_url not in show_by_url:
                print(f'    Fetching: {show_url}')
                try:
                    show_html = fetch_page(show_url)
                except Exception as e:
                    print(f'    ERROR: {e}')
                    time.sleep(INTER_SHOW_SLEEP)
                    continue

                parsed = add_concert.parse_show_page(show_html, show_url)
                if parsed is None:
                    print(f'    parse_show_page returned None — skipping')
                    time.sleep(INTER_SHOW_SLEEP)
                    continue

                date = parsed['date']

                if show_url in show_by_url:
                    existing = show_by_url[show_url]
                    existing['venue'] = parsed['venue']
                    existing['songs'] = parsed['songs']
                    existing.pop('setlist_pending', None)
                    print(f'    Updated pending show {date} ({len(parsed["songs"])} songs)')
                else:
                    # Try to promote a pending stub that matches by date
                    stubs = [s for s in show_by_date.get(date, []) if s.get('setlist_pending') and not s.get('setlistfm_url')]
                    if len(stubs) == 1:
                        stub = stubs[0]
                        stub['setlistfm_url'] = show_url
                        stub['venue'] = parsed['venue']
                        stub['songs'] = parsed['songs']
                        stub.pop('setlist_pending', None)
                        show_by_url[show_url] = stub
                        print(f'    Promoted stub {date} ({len(parsed["songs"])} songs)')
                    elif len(stubs) > 1:
                        print(f'    WARNING: multiple pending stubs for {date} — inserting as new (manual resolution needed)')
                        new_show = {
                            'date': date,
                            'venue': parsed['venue'],
                            'songs': parsed['songs'],
                            'recordings': [],
                            'setlistfm_url': show_url,
                        }
                        shows.append(new_show)
                        show_by_url[show_url] = new_show
                        show_by_date.setdefault(date, []).append(new_show)
                    else:
                        new_show = {
                            'date': date,
                            'venue': parsed['venue'],
                            'songs': parsed['songs'],
                            'recordings': [],
                            'setlistfm_url': show_url,
                        }
                        shows.append(new_show)
                        show_by_url[show_url] = new_show
                        show_by_date.setdefault(date, []).append(new_show)
                        print(f'    Inserted new show {date} ({len(parsed["songs"])} songs)')

                known_complete.add(show_url)
                known_pending.discard(show_url)
                changed = True
                time.sleep(INTER_SHOW_SLEEP)

        if all_complete:
            consecutive_complete_pages += 1
            print(f'  All shows known-complete (streak: {consecutive_complete_pages})')
            if not all_pages and consecutive_complete_pages >= 2:
                print('  Short-circuit: 2 consecutive all-complete pages — done.')
                break
        else:
            consecutive_complete_pages = 0

        page += 1
        if page > page_start + MAX_PAGES:
            print(f'  Safety cap ({MAX_PAGES} pages) reached — stopping.')
            break

        time.sleep(INTER_PAGE_SLEEP)

    if not changed:
        print(f'  No changes for {slug}.')
        return

    shows_sorted = sorted(shows, key=lambda s: s['date'])

    if dry_run:
        print(f'  [dry-run] Would write {len(shows_sorted)} shows to {band["data_file"]}')
    else:
        band_common.save_data(band['data_file'], shows_sorted)
        print(f'  Wrote {len(shows_sorted)} shows to {band["data_file"]}')


def main():
    parser = argparse.ArgumentParser(description='Scrape setlist.fm for a band.')
    parser.add_argument('--band', required=True, help='Band slug (from bands.json)')
    parser.add_argument('--all', dest='all_pages', action='store_true',
                        help='Paginate all pages (no short-circuit)')
    parser.add_argument('--page', type=int, default=1,
                        help='Start from this page number (default: 1)')
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
        print('Use scrape-gybe.py and update-shows.py instead.')
        sys.exit(1)

    if not band.get('setlistfm_url'):
        print(f'ERROR: band "{args.band}" has no setlistfm_url in bands.json.')
        sys.exit(1)

    print(f'Scraping setlist.fm for {band["name"]} (slug: {band["slug"]})...')
    scrape_band(band, page_start=args.page, all_pages=args.all_pages, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
