#!/usr/bin/env python3
# scrape-gybe.py
# Scrapes gybecc.neocities.org and outputs / merges setlist data.
#
# Usage:
#   python scrape-gybe.py                        # full scrape, print JSON to stdout
#   python scrape-gybe.py --year 25              # scrape one year, merge into setlists.json
#   python scrape-gybe.py --show 2025-03-10      # re-scrape one show, merge into setlists.json

import urllib.request
import re
import json
import time
import sys
import os
import html as html_mod

BASE = 'https://gybecc.neocities.org/gybecc/'

MONTHS = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
}

YEAR_PAGES = [
    '95','96','97','98','99',
    '00','01','02','03',
    '10','11','12','13','14','15','16','17','18','19','20',
    '22','23','24','25','26',
]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(SCRIPT_DIR, 'setlists.json')
DATA_PATH = os.path.join(SCRIPT_DIR, 'setlists-data.js')

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode('utf-8', errors='replace')

def strip_tags(s):
    return html_mod.unescape(re.sub(r'<[^>]+>', '', s)).strip()

def normalize_date(d):
    parts = d.split('-')
    if len(parts[0]) == 2:
        y = int(parts[0])
        parts[0] = ('19' if y >= 90 else '20') + parts[0]
    return '-'.join(parts)

def extract_show_links(html):
    """Find all YYYY-MM-DD.html or YY-MM-DD.html links."""
    links = []
    seen = set()
    for m in re.finditer(r'href="((\d{2,4}-\d{2}-\d{2})\.html)"', html):
        href, date_raw = m.group(1), m.group(2)
        date = normalize_date(date_raw)
        if date not in seen:
            seen.add(date)
            links.append({'url': BASE + href, 'date': date})
    return links

def parse_year_page_table(html, year_suffix):
    """Parse shows from the year page table that don't have individual .html pages."""
    shows = []
    full_year = ('19' if int(year_suffix) >= 90 else '20') + year_suffix

    # Split into <tr> blocks
    rows = re.split(r'<tr(?:\s[^>]*)?>',  html, flags=re.I)
    current_month = None

    for row in rows:
        cells = re.findall(r'<td[^>]*>([\s\S]*?)(?=<td|</tr>)', row, re.I)

        # Month header: COLSPAN=2 row with a month name
        if re.search(r'COLSPAN\s*=\s*["\s]?2', row, re.I) and len(cells) >= 1:
            text = strip_tags(cells[0]).strip().lower()
            for name, num in MONTHS.items():
                if name in text:
                    # Year may be stated in the header (e.g. "march 1997")
                    ym = re.search(r'\b(19\d{2}|20\d{2})\b', text)
                    if ym:
                        full_year = ym.group(1)
                    current_month = num
                    break
            continue

        if not current_month or len(cells) < 4:
            continue

        day_text = strip_tags(cells[0]).strip()
        location  = re.sub(r'\s+', ' ', strip_tags(cells[1])).strip()
        venue_raw = cells[2]
        extra     = re.sub(r'\s+', ' ', strip_tags(cells[3])).strip()

        # Skip uncertain dates
        if '?' in day_text:
            continue

        day_digits = re.sub(r'[^\d]', '', day_text)
        if not day_digits:
            continue
        day = int(day_digits)
        if day < 1 or day > 31:
            continue

        date = f'{full_year}-{current_month}-{day:02d}'

        # If this row links to an individual .html show page, skip it —
        # the main loop will fetch that page and get the proper setlist.
        if re.search(r'href\s*=\s*["\s]*\d{2,4}-\d{2}-\d{2}\.html', venue_raw, re.I):
            continue

        venue = re.sub(r'\s+', ' ', strip_tags(venue_raw)).strip()
        note  = extra if extra and extra != '-' else ''

        show = {'date': date, 'venue': f'{venue}, {location}' if venue else location, 'songs': [], 'recordings': []}
        if note:
            show['note'] = note
        shows.append(show)

    return shows


def parse_show(html, date):
    # Venue: find the first BGCOLOR="#000000" cell whose stripped text looks like a venue.
    # Skip cells that are: the page title, a date (YYYY-MM-DD), a duration (HH:MM), or "setlist".
    venue = ''
    for vm in re.finditer(r'BGCOLOR="#000000"[^>]*>([\s\S]*?)(?=</td)', html, re.I):
        text = re.sub(r'\s+', ' ', strip_tags(vm.group(1))).strip()
        tl = text.lower()
        if not text: continue
        if 'concert chronology' in tl: continue
        if 'godspeed' in tl: continue
        if re.match(r'^\d{4}-\d{2}-\d{2}$', text): continue   # date cell
        if re.match(r'^\d+:\d+$', text): continue              # duration cell
        if tl == 'setlist': continue
        venue = text
        break
    if not venue:
        tm = re.search(r'<title[^>]*>([^<]+)</title>', html, re.I)
        if tm:
            venue = tm.group(1).strip()

    songs = []

    # <li> items (old HTML 4 style, may lack closing tags)
    # Stop at the next <li>, </li>, </td>, or </tr> — but NOT at <br> since some
    # show pages put notes/credits inside the last <li> after a <br> or <p>.
    for m in re.finditer(r'<li[^>]*>([\s\S]*?)(?=<li|</li|</td|</tr|$)', html, re.I):
        raw = m.group(1)
        # Strip everything from the first block-level tag (<p>, <br>) onwards
        # so inline notes/credits inside the <li> don't bleed into the song name.
        raw = re.split(r'<(?:p|br)\b', raw, maxsplit=1, flags=re.I)[0]
        text = re.sub(r'\s+', ' ', strip_tags(raw)).strip()
        # Strip trailing "back" link artifact
        text = re.sub(r'\s*back\s*$', '', text, flags=re.I).strip()
        text = re.sub(r'\s+', ' ', text).strip()
        # Remove trailing "note : ..." annotations - keep just the song name
        text = re.sub(r'\s+note\s*:.*$', '', text, flags=re.I).strip()
        text = re.sub(r'\s*\[incomplete\].*$', '', text, flags=re.I).strip()
        if re.match(r'^note\s*:', text, re.I):
            continue
        if text and 1 < len(text) < 80:
            songs.append(text)

    # Fallback: <br>-separated lines in body
    if not songs:
        bm = re.search(r'<body[^>]*>([\s\S]*)</body>', html, re.I)
        if bm:
            parts = re.split(r'<br\s*/?>',  bm.group(1), flags=re.I)
            for part in parts:
                text = re.sub(r'\s+', ' ', strip_tags(part)).strip()
                if text and 1 < len(text) < 120 and not text.startswith('['):
                    songs.append(text)

    note = parse_note(html)
    result = {'date': date, 'venue': venue, 'songs': songs}
    if note:
        result['note'] = note
    return result

def parse_note(html):
    """Extract page-level notes: 'note : ...' annotations and 'thanks to ...' credits."""
    parts = []
    m = re.search(r'(?<![a-z])note\s*:\s*([\s\S]*?)(?=</(?:em|i|p|td|li|font)\b)', html, re.I)
    if m:
        text = re.sub(r'<[^>]+>', '', m.group(1))
        text = re.sub(r'\s+', ' ', text).strip().rstrip('.')
        if text:
            parts.append('note : ' + text)
    m = re.search(r'thanks\s+to\s+([\s\S]*?)(?=</(?:font|i|td|p|li)\b)', html, re.I)
    if m:
        text = re.sub(r'<[^>]+>', '', m.group(0))
        text = re.sub(r'\s+', ' ', text).strip().rstrip('.')
        if text:
            parts.append(text)
    return '  '.join(parts)


def scrape_year(yr, seen_dates):
    """Scrape one year page, return list of shows."""
    shows = []
    url = BASE + yr + '.html'
    print(f'Year page: {url}', file=sys.stderr)
    try:
        html = fetch(url)
    except Exception as e:
        print(f'  ERROR: {e}', file=sys.stderr)
        return shows

    links = extract_show_links(html)
    print(f'  {len(links)} linked shows found', file=sys.stderr)

    for link in links:
        date = link['date']
        if date in seen_dates:
            continue
        seen_dates.add(date)
        print(f'  Fetching {link["url"]}', file=sys.stderr)
        try:
            show_html = fetch(link['url'])
        except Exception as e:
            print(f'    ERROR: {e}', file=sys.stderr)
            continue
        shows.append(parse_show(show_html, date))
        time.sleep(0.15)

    table_shows = parse_year_page_table(html, yr)
    added = 0
    for show in table_shows:
        if show['date'] not in seen_dates:
            seen_dates.add(show['date'])
            shows.append(show)
            added += 1
    print(f'  {added} no-setlist shows from table', file=sys.stderr)
    return shows


def merge_and_write(new_shows):
    """Merge new_shows into setlists.json (overwrite by date), write both output files."""
    with open(JSON_PATH) as f:
        existing = json.load(f)
    by_date = {s['date']: s for s in existing}
    for show in new_shows:
        # Preserve existing recordings when overwriting
        if show['date'] in by_date:
            show.setdefault('recordings', by_date[show['date']].get('recordings', []))
        by_date[show['date']] = show
    merged = sorted(by_date.values(), key=lambda s: s['date'])
    with open(JSON_PATH, 'w') as f:
        json.dump(merged, f, indent=2)
    print(f'Wrote setlists.json ({len(merged)} shows)', file=sys.stderr)
    with open(DATA_PATH, 'w') as f:
        f.write('const SETLISTS_DATA = ' + json.dumps(merged, indent=2) + ';\n')
    print(f'Wrote setlists-data.js', file=sys.stderr)


def main():
    args = sys.argv[1:]

    # --show YYYY-MM-DD  →  re-scrape one show, merge into setlists.json
    if '--show' in args:
        idx = args.index('--show')
        date = args[idx + 1]
        urls_to_try = [BASE + date + '.html', BASE + date[2:4] + date[4:] + '.html']
        show_html = None
        for url in urls_to_try:
            try:
                print(f'Fetching {url}', file=sys.stderr)
                show_html = fetch(url)
                break
            except Exception as e:
                print(f'  {e}', file=sys.stderr)
        if show_html is None:
            print('ERROR: show page not found', file=sys.stderr)
            sys.exit(1)
        show = parse_show(show_html, date)
        print(f'  {show["venue"]}  ({len(show["songs"])} songs)', file=sys.stderr)
        merge_and_write([show])
        return

    # --year YY  →  scrape one year, merge into setlists.json
    if '--year' in args:
        idx = args.index('--year')
        yr = args[idx + 1]
        shows = scrape_year(yr, set())
        merge_and_write(shows)
        return

    # Default: full scrape, print JSON to stdout
    all_shows = []
    seen_dates = set()
    for yr in YEAR_PAGES:
        all_shows.extend(scrape_year(yr, seen_dates))
    all_shows.sort(key=lambda s: s['date'])
    print(json.dumps(all_shows, indent=2))
    print(f'\nDone. {len(all_shows)} shows.', file=sys.stderr)

if __name__ == '__main__':
    main()
