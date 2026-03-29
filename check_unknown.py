#!/usr/bin/env python3
"""Report recordings with unknown lineage and/or source."""

import json, pathlib

with open(pathlib.Path(__file__).parent / 'setlists.json') as f:
    shows = json.load(f)

unknown_both = []
unknown_lineage_only = []
unknown_source_only = []

for show in shows:
    for rec in show.get('recordings', []):
        lin = rec.get('lineage', '')
        src = rec.get('source', '')
        lin_unknown = lin == 'unknown'
        src_unknown = src == 'unknown'
        if lin_unknown and src_unknown:
            unknown_both.append((show['date'], rec['id']))
        elif lin_unknown:
            unknown_lineage_only.append((show['date'], rec['id']))
        elif src_unknown:
            unknown_source_only.append((show['date'], rec['id']))

def print_group(title, items):
    print(f'\n{title} ({len(items)}):')
    for date, rid in items:
        print(f'  {date}  [{rid}]')

print_group('Unknown lineage only', unknown_lineage_only)
print_group('Unknown source only', unknown_source_only)
print_group('Unknown both', unknown_both)

print(f'\n--- Summary ---')
print(f'  Unknown lineage only : {len(unknown_lineage_only)}')
print(f'  Unknown source only  : {len(unknown_source_only)}')
print(f'  Unknown both         : {len(unknown_both)}')
print(f'  Total affected       : {len(unknown_lineage_only) + len(unknown_source_only) + len(unknown_both)}')
