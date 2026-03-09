#!/usr/bin/env python3
# scrape-gybe.py
# Run with: python scrape-gybe.py > setlists.json
# Scrapes gybecc.neocities.org and outputs JSON of all shows with setlists.

import urllib.request
import re
import json
import time
import sys

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
        text = re.sub(r'&[a-z#0-9]+;', ' ', vm.group(1))  # decode entities first
        text = re.sub(r'\s+', ' ', strip_tags(text)).strip()
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
    # Split on <li> and grab text until next tag block
    for m in re.finditer(r'<li[^>]*>([\s\S]*?)(?=<li|</li|<br|</td|</tr|$)', html, re.I):
        raw = m.group(1)
        text = re.sub(r'\s+', ' ', strip_tags(raw)).strip()
        # Strip trailing "back" link artifact
        text = re.sub(r'\s*back\s*$', '', text, flags=re.I).strip()
        # Strip HTML entities like &nbsp;
        text = re.sub(r'&[a-z]+;', ' ', text).strip()
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

def main():
    all_shows = []
    seen_dates = set()

    for yr in YEAR_PAGES:
        url = BASE + yr + '.html'
        print(f'Year page: {url}', file=sys.stderr)
        try:
            html = fetch(url)
        except Exception as e:
            print(f'  ERROR: {e}', file=sys.stderr)
            continue

        # Shows with individual pages (have setlists)
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

            show = parse_show(show_html, date)
            all_shows.append(show)
            time.sleep(0.15)  # be polite

        # Shows without individual pages (no setlist)
        table_shows = parse_year_page_table(html, yr)
        added = 0
        for show in table_shows:
            if show['date'] not in seen_dates:
                seen_dates.add(show['date'])
                all_shows.append(show)
                added += 1
        print(f'  {added} no-setlist shows from table', file=sys.stderr)

    all_shows.sort(key=lambda s: s['date'])
    print(json.dumps(all_shows, indent=2))
    print(f'\nDone. {len(all_shows)} shows.', file=sys.stderr)

if __name__ == '__main__':
    main()
