"""Attribute a processed Firefox export to recorded local motion stacks.

CPU deltas weight sampled stacks, not exact function timers. Categories are
inclusive and may overlap; the browser Renderer thread is not page-exclusive.
Run sequentially under the project's resource limiter. No profile is uploaded.
"""
import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
from urllib.parse import urlsplit


def attribute(source):
    with gzip.open(source, 'rt') as stream:
        profile = json.load(stream)
    assert profile['meta']['preprocessedProfileVersion'] == 77
    shared = profile['shared']
    strings = shared['stringArray']
    stacks, frames, funcs = (shared[key] for key in ('stackTable', 'frameTable', 'funcTable'))
    # The original, symbolicated home export records both ordinary and diagnostic windows.
    ordinary = {page['innerWindowID'] for page in profile['pages']
                if page.get('url') == 'https://172.21.0.7:8443/'}
    reports = []
    for thread in profile['threads']:
        if thread['name'] != 'GeckoMain' or not ordinary.intersection(thread.get('usedInnerWindowIDs', [])):
            continue
        samples = thread['samples']
        duration_ms = sum(samples['timeDeltas'][1:])
        totals, ghost_functions = Counter(), Counter()
        non_motion_leaves, non_motion_js = Counter(), Counter()
        for index, stack in enumerate(samples['stack']):
            if index == 0 or stack is None:
                continue
            cpu = samples['threadCPUDelta'][index]
            if cpu is None:
                continue
            weight_ms = cpu / 1e6
            groups, symbols, ghost_names = set(), set(), set()
            leaf, nearest_js = None, None
            while stack is not None:
                frame = stacks['frame'][stack]
                func = frames['func'][frame]
                name = strings[funcs['name'][func]]
                symbols.add(name)
                if leaf is None:
                    leaf = name
                source_index = funcs['source'][func]
                source_url = shared['sources']['filename'][source_index] if source_index is not None else ''
                if isinstance(source_url, int):
                    source_url = strings[source_url]
                if isinstance(source_url, str) and frames['innerWindowID'][frame] in ordinary:
                    filename = urlsplit(source_url).path
                    if nearest_js is None and filename.startswith('/assets/'):
                        nearest_js = (filename, name, frames['line'][frame], frames['column'][frame])
                    if '/assets/GhostFibers-' in filename:
                        groups.add('GhostFibers JavaScript stack, including native descendants')
                        ghost_names.add((name, frames['line'][frame], frames['column'][frame]))
                    if (filename == '/assets/index-Bac7u9r8.js' and name == 'V'
                            and frames['line'][frame] == 297 and frames['column'][frame] == 25963):
                        groups.add('recorded radar driver stack, including native descendants')
                offset = stacks['prefixOffset'][stack]
                stack = stack - offset if offset else None
            totals['all process samples'] += weight_ms
            for group in groups:
                totals[group] += weight_ms
            if not groups:
                totals['neither identified motion stack'] += weight_ms
                non_motion_leaves[leaf] += weight_ms
                non_motion_js[nearest_js] += weight_ms
            for symbol in symbols:
                if any(key in symbol for key in ('clearRect', 'stroke', 'DoFlushLayout', 'PaintFrame', 'glDraw', 'drawArraysInstanced')):
                    totals['inclusive native: ' + symbol] += weight_ms
            for key in ghost_names:
                ghost_functions[key] += weight_ms
        reports.append({
            'pid': thread['pid'], 'capture_ms': duration_ms,
            'groups': [{'name': name, 'sampled_cpu_ms': round(value, 3),
                        'sampled_cpu_ms_per_s': round(value * 1000 / duration_ms, 3)}
                       for name, value in totals.most_common()],
            'non_motion_leaf_functions': [
                {'name': key, 'sampled_cpu_ms': round(value, 3)}
                for key, value in non_motion_leaves.most_common(20)],
            'non_motion_nearest_app_functions': [
                {'source_name_line_column': key, 'sampled_cpu_ms': round(value, 3)}
                for key, value in non_motion_js.most_common(20)],
            'ghost_functions': [{'name': key[0], 'line': key[1], 'column': key[2],
                                 'sampled_cpu_ms': round(value, 3)}
                                for key, value in ghost_functions.most_common(12)],
        })
    return reports


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = attribute(args.source)
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
