"""Summarize local Firefox processed exports without publishing unrelated pages.

Run under the repository resource limiter. Inputs are read-only; output contains
only the selected local application's page paths, thread aggregates and symbols.
Marker wall durations may overlap and are not CPU time or presented-frame FPS.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ORIGIN = "https://172.21.0.7:8443"


def percentile(values, quantile):
    values = sorted(values)
    return values[min(len(values) - 1, int((len(values) - 1) * quantile))] if values else None


def page_label(url):
    parts = urlsplit(url)
    diagnostic = parse_qs(parts.query).get("localDiagnostic", [""])[0]
    if diagnostic and diagnostic.replace("-", "").isalnum():
        return f"{parts.path} (diagnostic: {diagnostic})"
    return parts.path


def summarize(path):
    with gzip.open(path, "rt") as stream:
        profile = json.load(stream)
    assert profile["meta"]["preprocessedProfileVersion"] == 77
    shared = profile["shared"]
    strings = shared["stringArray"]
    stacks, frames, funcs = (shared[name] for name in ("stackTable", "frameTable", "funcTable"))
    pages = {page["innerWindowID"]: page_label(page["url"])
             for page in profile["pages"] if page.get("url", "").startswith(ORIGIN + "/")}
    categories = [category["name"] for category in profile["meta"]["categories"]]
    report = {"file": path.name, "pages": pages, "threads": []}
    for thread in profile["threads"]:
        own = set(thread.get("usedInnerWindowIDs", [])) & pages.keys()
        if not own and thread["name"] not in ("Renderer", "Compositor"):
            continue
        samples = thread["samples"]
        times = []
        current = 0
        for delta in samples["timeDeltas"]:
            current += delta
            times.append(current)
        if len(times) < 2:
            continue
        duration = times[-1] - times[0]
        cpu = samples.get("threadCPUDelta", [])
        cpu_ms = sum(value for value in cpu[1:] if value is not None) / 1e6
        leaf_cpu, inclusive_cpu, category_cpu = Counter(), Counter(), Counter()
        app_inclusive_cpu = Counter()
        for index, stack in enumerate(samples["stack"]):
            if index == 0 or stack is None or index >= len(cpu) or cpu[index] is None:
                continue
            weight = cpu[index] / 1e6
            seen, app_seen = set(), set()
            first = True
            while stack is not None:
                frame = stacks["frame"][stack]
                func = frames["func"][frame]
                name = strings[funcs["name"][func]]
                window = frames["innerWindowID"][frame]
                if first:
                    leaf_cpu[name] += weight
                    category_cpu[categories[frames["category"][frame]]] += weight
                    first = False
                if name not in seen:
                    inclusive_cpu[name] += weight
                    seen.add(name)
                if window in pages:
                    label = (name, pages[window], frames["line"][frame], frames["column"][frame], window)
                    if label not in app_seen:
                        app_inclusive_cpu[label] += weight
                        app_seen.add(label)
                offset = stacks["prefixOffset"][stack]
                stack = stack - offset if offset else None
        markers = thread["markers"]
        intervals, open_markers = defaultdict(list), defaultdict(list)
        marker_counts = Counter()
        for index, name_index in enumerate(markers["name"]):
            name = strings[name_index]
            marker_counts[name] += 1
            start, end, phase = (markers[key][index] for key in ("startTime", "endTime", "phase"))
            if phase == 2:
                open_markers[name].append(start)
                continue
            if phase == 3:
                if not open_markers[name]:
                    continue
                start = open_markers[name].pop()
            if phase not in (1, 3) or start is None or end is None:
                continue
            length = min(end, times[-1]) - max(start, times[0])
            if length > 0:
                intervals[name].append(length)
        def top(counter):
            return [{"symbol": name, "cpu_ms": round(value, 3), "cpu_ms_per_s": round(value / duration * 1000, 3)}
                    for name, value in counter.most_common(22)]
        delays = [value for value in samples.get("eventDelay", []) if value is not None]
        report["threads"].append({
            "name": thread["name"], "pid": thread["pid"], "own_windows": sorted(own),
            "scope": ("shared browser thread; not page-exclusive" if not own
                      else "process samples; multiple local windows" if len(own) > 1
                      else "process samples; other windows may share this process"),
            "capture_ms": round(duration, 3), "cpu_ms": round(cpu_ms, 3),
            "cpu_ms_per_s": round(cpu_ms / duration * 1000, 3),
            "event_delay_ms": {"p95": percentile(delays, .95), "max": max(delays) if delays else None},
            "leaf_categories_cpu_ms": category_cpu,
            "self_cpu": top(leaf_cpu), "inclusive_cpu": top(inclusive_cpu),
            "app_inclusive_cpu": [{"symbol": key[0], "page": key[1], "line": key[2], "column": key[3], "inner_window_id": key[4], "cpu_ms": round(value, 3)}
                                  for key, value in app_inclusive_cpu.most_common(22)],
            "marker_counts": dict(marker_counts.most_common(35)),
            "markers": {name: {"count": len(values), "total_wall_ms": round(sum(values), 3),
                               "wall_ms_per_s": round(sum(values) / duration * 1000, 3),
                               "p95_ms": percentile(values, .95), "max_ms": max(values)}
                        for name, values in sorted(intervals.items(), key=lambda pair: -sum(pair[1]))[:30]},
        })
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = summarize(args.source)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({"file": result["file"], "thread_count": len(result["threads"]), "output": str(args.output)}))
