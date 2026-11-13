"""Small processed-profile fixtures check units, prefix stacks and privacy labels."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "analysis", Path(__file__).with_name("analyze-exported-profiles.py")
)
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)


class ExportedProfileAnalysisTest(unittest.TestCase):
    def test_processed_delta_stacks_units_and_marker_clipping(self):
        profile = {
            "meta": {"preprocessedProfileVersion": 77, "categories": [{"name": "JavaScript"}]},
            "pages": [
                {"innerWindowID": 7, "url": analysis.ORIGIN + "/?localDiagnostic=motion-story&secret=hidden"},
                {"innerWindowID": 8, "url": analysis.ORIGIN + "/"},
                {"innerWindowID": 9, "url": "https://private.invalid/never-output"},
            ],
            "shared": {
                "stringArray": ["caller", "draw", "Paint"],
                "stackTable": {"frame": [0, 1], "prefixOffset": [0, 1]},
                "frameTable": {"func": [0, 1], "innerWindowID": [7, 8], "line": [1, 2],
                               "column": [0, 3], "category": [0, 0]},
                "funcTable": {"name": [0, 1]},
            },
            "threads": [{
                "name": "GeckoMain", "pid": 1, "usedInnerWindowIDs": [7, 8, 9],
                "samples": {"stack": [1, 1, 1], "timeDeltas": [100, 10, 10],
                            "threadCPUDelta": [999999, 1000000, 2000000], "eventDelay": [0, 2, 4]},
                "markers": {"name": [2, 2], "startTime": [90, None], "endTime": [None, 125],
                            "phase": [2, 3]},
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "fixture.json.gz"
            with gzip.open(source, "wt") as stream:
                json.dump(profile, stream)
            report = analysis.summarize(source)
        thread = report["threads"][0]
        self.assertEqual(thread["capture_ms"], 20)
        self.assertEqual(thread["cpu_ms"], 3)
        self.assertEqual(thread["cpu_ms_per_s"], 150)
        self.assertEqual(thread["inclusive_cpu"][0]["cpu_ms"], 3)
        self.assertEqual(thread["self_cpu"][0]["symbol"], "draw")
        self.assertEqual(thread["app_inclusive_cpu"][0]["inner_window_id"], 8)
        self.assertEqual(thread["markers"]["Paint"]["total_wall_ms"], 20)
        self.assertEqual(thread["own_windows"], [7, 8])
        self.assertEqual(report["pages"][7], "/ (diagnostic: motion-story)")
        self.assertEqual(report["pages"][8], "/")
        self.assertNotIn("hidden", json.dumps(report))
        self.assertNotIn("private.invalid", json.dumps(report))
        self.assertIn("multiple local windows", thread["scope"])


if __name__ == "__main__":
    unittest.main()
