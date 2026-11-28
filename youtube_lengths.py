#!/usr/bin/env python3
# youtube_lengths.py
# Sets recording['length'] (seconds) for YouTube recordings that lack one, using
# yt-dlp for the video's duration (a playlist's videos are added up), then
# recomputes show lengths via track_lengths.finalize().
#
# track_lengths.py --backfill only knows archive.org, so YouTube recordings need
# this. Run it by hand after adding a YouTube recording; needs yt-dlp installed
# (pip install yt-dlp).
#
# Usage:
#   python youtube_lengths.py             # fill in missing lengths, write if changed
#   python youtube_lengths.py --refetch   # re-fetch lengths YouTube recordings already have
#   python youtube_lengths.py --dry-run   # print what would change, don't write

import json
import sys

import yt_dlp

import track_lengths

JSON_PATH = track_lengths.JSON_PATH


def is_youtube(rec):
    url = rec.get('url', '')
    return 'youtube.com' in url or 'youtu.be' in url


def youtube_length(url):
    """Seconds of video at url (summed over a playlist's entries), or None."""
    opts = {'quiet': True, 'no_warnings': True, 'skip_download': True, 'extract_flat': 'in_playlist'}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get('_type') == 'playlist':
        durs = [e.get('duration') for e in info.get('entries') or []]
        if not durs or any(d is None for d in durs):
            return None
        return int(round(sum(durs)))
    d = info.get('duration')
    return int(round(d)) if d else None


def main():
    args = sys.argv[1:]
    with open(JSON_PATH, encoding='utf-8') as f:
        shows = json.load(f)

    todo = [(s, r) for s in shows for r in s.get('recordings', [])
            if is_youtube(r) and ('--refetch' in args or not r.get('length'))]
    print(f'Fetching lengths for {len(todo)} YouTube recording(s)...')
    changed = False
    for s, r in todo:
        try:
            length = youtube_length(r['url'])
        except Exception as e:
            print(f'  {s["date"]} [{r["id"]}] error: {e}')
            continue
        if not length:
            print(f'  {s["date"]} [{r["id"]}] no duration found')
            continue
        h, m = divmod(length // 60, 60)
        print(f'  {s["date"]} [{r["id"]}] {h}:{m:02d}:{length % 60:02d}')
        if r.get('length') != length:
            r['length'] = length
            changed = True

    if '--dry-run' in args:
        print('[dry run] not written')
        return
    if not changed:
        print('setlists.json unchanged')
        return
    track_lengths.finalize(shows)
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        f.write(json.dumps(shows, indent=2))
    print('Wrote setlists.json')


if __name__ == '__main__':
    main()
