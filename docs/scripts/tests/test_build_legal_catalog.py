"""Fixture-only tests; no project dependencies, network, mail, or database."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "build_legal_catalog.py"
SPEC = importlib.util.spec_from_file_location("build_legal_catalog", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class BuildLegalCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source_dir = self.root / "docs/legal"
        self.source_dir.mkdir(parents=True)
        self.source = {
            "schema_version": 1,
            "release": {"sequence": 0, "effective_at": None,
                        "legal_review_approved": False, "evidence_retention_days": None},
            "documents": [self.document(doc_id) for doc_id in sorted(builder.DOCUMENT_IDS)],
        }
        self.fields = {"KNOWN": "известно", "UNKNOWN": "", "FIRST": "[[SECOND]]", "SECOND": "не подставлять"}
        for document in self.source["documents"]:
            path = self.source_dir / document["body_file"]
            path.parent.mkdir(parents=True)
            path.write_bytes("Редакция [[VERSION]], [[DATE]], [[YEAR]].\r\n[[KNOWN]] [[UNKNOWN]] [[FIRST]]\r\n".encode("utf-8"))
        self.save()

    def document(self, doc_id):
        return {"id": doc_id, "revision": "2026-11-03-draft-1", "status": "draft", "language": "ru",
                "title": "Документ " + doc_id, "published_at": "2026-11-03", "effective_at": None,
                "body_file": f"texts/{doc_id}/2026-11-03-draft-1.txt"}

    def save(self):
        (self.source_dir / "catalog.json").write_text(json.dumps(self.source, ensure_ascii=False), encoding="utf-8")
        (self.source_dir / "fields.json").write_text(json.dumps(self.fields, ensure_ascii=False), encoding="utf-8")

    def activate(self):
        self.source["release"] = {"sequence": 1, "effective_at": "2026-11-04",
                                  "legal_review_approved": True, "evidence_retention_days": 30}
        for document in self.source["documents"]:
            if document["id"] != "offer":
                document.update(status="effective", effective_at="2026-11-04")
                (self.source_dir / document["body_file"]).write_text("Согласованный fixture текст.\n", encoding="utf-8")
        self.save()

    def snapshot(self):
        return {str(path.relative_to(self.root)): (path.read_bytes(), path.stat().st_mtime_ns)
                for path in self.root.rglob("*") if path.is_file()}

    def test_exact_hashes_lf_one_pass_and_safe_manifest(self):
        catalog = builder.build_catalog(self.root)
        body = catalog["documents"][0]["body"]
        self.assertEqual(body, "Редакция 2026-11-03-draft-1, 2026-11-03, 2026.\nизвестно [[UNKNOWN]] [[SECOND]]\n")
        self.assertEqual(catalog["documents"][0]["sha256"], hashlib.sha256(body.encode("utf-8")).hexdigest())
        payload = {key: value for key, value in catalog.items() if key != "catalog_sha256"}
        exact = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        self.assertEqual(catalog["catalog_sha256"], hashlib.sha256(exact).hexdigest())
        self.assertEqual(set(catalog), {"schema_version", "catalog_sha256", "release", "documents"})
        manifest = builder.manifest(catalog)
        self.assertEqual(manifest["catalog_sha256"], catalog["catalog_sha256"])
        self.assertEqual(manifest["release_sequence"], 0)
        for document in manifest["documents"]:
            self.assertEqual(set(document), {"id", "revision", "sha256", "url"})

    def test_substituted_fields_cannot_introduce_cr_nul_or_bom(self):
        self.fields["KNOWN"] = "первая\r\nвторая\rтретья"
        self.save()
        body = builder.build_catalog(self.root)["documents"][0]["body"]
        self.assertNotIn("\r", body)
        self.assertIn("первая\nвторая\nтретья", body)
        for invalid in ("\x00", "\ufeff"):
            with self.subTest(invalid=repr(invalid)):
                self.fields["KNOWN"] = invalid
                self.save()
                with self.assertRaisesRegex(builder.CatalogError, "invalid substituted"):
                    builder.build_catalog(self.root)

    def test_determinism_and_check_never_writes_even_when_stale(self):
        builder.generate(self.root)
        before = self.snapshot()
        builder.generate(self.root, check=True)
        self.assertEqual(before, self.snapshot())
        self.source["documents"].reverse()
        self.save()
        self.assertEqual(builder.build_catalog(self.root), json.loads((self.root / builder.OUTPUTS[0]).read_bytes()))
        path = self.root / builder.OUTPUTS[2]
        path.write_bytes(b"stale\n")
        before = self.snapshot()
        with self.assertRaisesRegex(builder.CatalogError, "stale or missing"):
            builder.generate(self.root, check=True)
        self.assertEqual(before, self.snapshot())
        self.assertEqual((self.root / builder.OUTPUTS[0]).read_bytes(), (self.root / builder.OUTPUTS[1]).read_bytes())

    def test_check_missing_outputs_does_not_create_directories(self):
        before = self.snapshot()
        with self.assertRaisesRegex(builder.CatalogError, "stale or missing"):
            builder.generate(self.root, check=True)
        self.assertEqual(before, self.snapshot())
        self.assertFalse((self.root / "frontend").exists())
        self.assertFalse((self.root / "web").exists())

    def test_rejects_unsafe_paths_ids_and_metadata(self):
        original = copy.deepcopy(self.source)
        mutations = [
            ("body_file", "../secret.txt"), ("body_file", "/etc/passwd"),
            ("body_file", "texts\\terms\\revision.txt"), ("body_file", "https://example.invalid/x"),
            ("revision", "../bad"), ("revision", "with space"), ("id", "internal"),
            ("id", "resend_consent"), ("title", "<script>"), ("title", "bad\nmetadata"),
            ("language", "en"), ("status", "published"), ("published_at", "2026-11-03T00:00:00Z"),
            ("published_at", "2026-2-03"), ("published_at", "2026-02-30"),
            ("effective_at", "2026-11-04"),
        ]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                self.source = copy.deepcopy(original)
                self.source["documents"][0][key] = value
                self.save()
                with self.assertRaises(builder.CatalogError):
                    builder.build_catalog(self.root)

    def test_rejects_symlink_body_even_inside_source(self):
        path = self.source_dir / self.source["documents"][0]["body_file"]
        target = self.source_dir / "target.txt"
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaisesRegex(builder.CatalogError, "symlink"):
            builder.build_catalog(self.root)

    def test_rejects_duplicate_revision_json_keys_and_unexpected_keys(self):
        self.source["documents"].append(copy.deepcopy(self.source["documents"][0]))
        self.save()
        with self.assertRaisesRegex(builder.CatalogError, "duplicate revision"):
            builder.build_catalog(self.root)
        self.source["documents"].pop()
        self.source["sales_open"] = True
        self.save()
        with self.assertRaisesRegex(builder.CatalogError, "invalid catalog keys"):
            builder.build_catalog(self.root)
        (self.source_dir / "fields.json").write_text('{"FIELD":"a","FIELD":"b"}', encoding="utf-8")
        with self.assertRaisesRegex(builder.CatalogError, "duplicate JSON key"):
            builder.load_json(self.source_dir / "fields.json")

    def test_requires_all_five_public_documents(self):
        self.source["documents"].pop()
        self.save()
        with self.assertRaisesRegex(builder.CatalogError, "all five"):
            builder.build_catalog(self.root)

    def test_effective_fixture_validates_companions_review_retention_dates_and_sales_closed(self):
        self.activate()
        self.assertEqual(builder.build_catalog(self.root)["release"]["sequence"], 1)
        original = copy.deepcopy(self.source)
        for field, value in (("sequence", 0), ("sequence", True), ("legal_review_approved", False),
                             ("evidence_retention_days", None), ("evidence_retention_days", True),
                             ("evidence_retention_days", 0), ("effective_at", "2026-11-05")):
            with self.subTest(field=field, value=value):
                self.source = copy.deepcopy(original)
                self.source["release"][field] = value
                self.save()
                with self.assertRaises(builder.CatalogError):
                    builder.build_catalog(self.root)
        self.source = copy.deepcopy(original)
        self.source["documents"][0].update(status="draft", effective_at=None)
        self.save()
        with self.assertRaisesRegex(builder.CatalogError, "requires terms/privacy/cookies/details"):
            builder.build_catalog(self.root)
        self.source = copy.deepcopy(original)
        offer = next(doc for doc in self.source["documents"] if doc["id"] == "offer")
        offer.update(status="effective", effective_at="2026-11-04")
        self.save()
        with self.assertRaisesRegex(builder.CatalogError, "sales are closed"):
            builder.build_catalog(self.root)

    def test_effective_body_and_title_cannot_have_placeholders(self):
        self.activate()
        document = self.source["documents"][0]
        path = self.source_dir / document["body_file"]
        path.write_text("[[UNKNOWN]]\n", encoding="utf-8")
        with self.assertRaisesRegex(builder.CatalogError, "unresolved placeholders"):
            builder.build_catalog(self.root)
        path.write_text("Готово.\n", encoding="utf-8")
        document["title"] = "[[TITLE]]"
        self.save()
        with self.assertRaisesRegex(builder.CatalogError, "unresolved placeholders"):
            builder.build_catalog(self.root)

    def test_per_revision_dates_do_not_use_global_fields(self):
        self.fields.update(VERSION="wrong", DATE="wrong", YEAR="wrong", EFFECTIVE_DATE="wrong")
        self.save()
        body = builder.build_catalog(self.root)["documents"][0]["body"]
        self.assertIn("2026-11-03-draft-1, 2026-11-03, 2026", body)
        path = self.source_dir / self.source["documents"][0]["body_file"]
        path.write_text("[[EFFECTIVE_DATE]]\n", encoding="utf-8")
        self.assertEqual(builder.build_catalog(self.root)["documents"][0]["body"], "[[EFFECTIVE_DATE]]\n")

    def test_old_effective_revision_cannot_be_modified_or_removed(self):
        self.activate()
        builder.generate(self.root)
        document = self.source["documents"][0]
        path = self.source_dir / document["body_file"]
        path.write_text("Другой текст.\n", encoding="utf-8")
        before = self.snapshot()
        with self.assertRaisesRegex(builder.CatalogError, "immutable revision hash changed"):
            builder.generate(self.root)
        self.assertEqual(before, self.snapshot())
        previous = json.loads((self.root / builder.OUTPUTS[0]).read_bytes())
        current = copy.deepcopy(previous)
        current["documents"].pop(0)
        with self.assertRaisesRegex(builder.CatalogError, "cannot remove published revision"):
            builder.preserve_revisions(previous, current)

    def test_new_revision_keeps_archived_text(self):
        self.activate()
        builder.generate(self.root)
        old = self.source["documents"][0]
        new = copy.deepcopy(old)
        old["status"] = "archived"
        new.update(revision="2026-11-04-final-2", published_at="2026-11-04")
        new["body_file"] = f'texts/{new["id"]}/{new["revision"]}.txt'
        (self.source_dir / new["body_file"]).write_text("Новая редакция.\n", encoding="utf-8")
        self.source["documents"].append(new)
        self.source["release"]["sequence"] = 2
        self.save()
        builder.generate(self.root)
        builder.generate(self.root, check=True)
        self.assertEqual(len(builder.build_catalog(self.root)["documents"]), 6)

    def test_tampered_existing_body_or_catalog_hash_is_rejected(self):
        builder.generate(self.root)
        path = self.root / builder.OUTPUTS[0]
        previous = json.loads(path.read_bytes())
        previous["documents"][0]["body"] = "tampered"
        path.write_bytes(builder.serialized(previous))
        with self.assertRaisesRegex(builder.CatalogError, "existing catalog hash mismatch"):
            builder.generate(self.root)
        payload = {key: value for key, value in previous.items() if key != "catalog_sha256"}
        previous["catalog_sha256"] = builder.sha256(builder.canonical(payload))
        path.write_bytes(builder.serialized(previous))
        with self.assertRaisesRegex(builder.CatalogError, "existing body hash mismatch"):
            builder.generate(self.root)


if __name__ == "__main__":
    unittest.main()
