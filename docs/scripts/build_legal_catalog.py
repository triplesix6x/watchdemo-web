#!/usr/bin/env python3
"""Build the public legal snapshot using only the Python standard library."""

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys


DOCUMENT_IDS = frozenset({"terms", "offer", "privacy", "cookies", "details"})
ACTIVE_COMPANIONS = DOCUMENT_IDS - {"offer"}
OUTPUTS = (
    "frontend/src/content/legal.generated.json",
    "web/APP/legal_catalog.generated.json",
    "frontend/public/legal/catalog-manifest.json",
)
REVISION = re.compile(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", re.ASCII)
FIELD = re.compile(r"\[\[([A-Z][A-Z0-9_]*)\]\]")
DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", re.ASCII)
DOCUMENT_KEYS = {
    "id", "revision", "status", "language", "title", "published_at",
    "effective_at", "body_file",
}
RELEASE_KEYS = {
    "sequence", "effective_at", "legal_review_approved", "evidence_retention_days",
}


class CatalogError(ValueError):
    """Invalid or unsafe source, or stale generated output."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CatalogError(message)


def canonical(payload: dict) -> bytes:
    return json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def serialized(payload: dict) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def unique_keys(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> dict:
    value = json.loads(path.read_bytes().decode("utf-8"), object_pairs_hook=unique_keys)
    require(type(value) is dict, f"expected JSON object: {path}")
    return value


def keys(value: object, expected: set, label: str) -> None:
    require(type(value) is dict and set(value) == expected, f"invalid {label} keys")


def strict_date(value: object, label: str) -> str:
    require(isinstance(value, str) and DATE.fullmatch(value) is not None, f"invalid {label}: {value!r}")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise CatalogError(f"invalid {label}: {value!r}") from exc
    return value


def local_path(base: Path, relative: str) -> Path:
    require(isinstance(relative, str) and relative != "", "empty local path")
    parts = relative.split("/")
    require(not Path(relative).is_absolute() and "\\" not in relative
            and all(part not in {"", ".", ".."} for part in parts), f"unsafe path: {relative}")
    path = base
    require(not base.is_symlink(), f"symlink directory: {base}")
    for part in parts:
        path = path / part
        require(not path.is_symlink(), f"symlink path: {path}")
    require(path.resolve().is_relative_to(base.resolve()), f"path escapes source: {relative}")
    return path


def build_catalog(root: Path) -> dict:
    source_dir = local_path(root, "docs/legal")
    source = load_json(local_path(source_dir, "catalog.json"))
    keys(source, {"schema_version", "release", "documents"}, "catalog")
    require(type(source["schema_version"]) is int and source["schema_version"] == 1, "unsupported schema_version")
    fields = load_json(local_path(source_dir, "fields.json"))
    require(all(isinstance(key, str) and re.fullmatch(r"[A-Z][A-Z0-9_]*", key)
                and isinstance(value, str) for key, value in fields.items()), "invalid fields mapping")
    release = source["release"]
    keys(release, RELEASE_KEYS, "release")
    require(type(release["sequence"]) is int and release["sequence"] >= 0, "invalid release sequence")
    require(type(release["legal_review_approved"]) is bool, "invalid legal_review_approved")
    retention = release["evidence_retention_days"]
    require(retention is None or (type(retention) is int and retention > 0), "invalid evidence_retention_days")
    if release["effective_at"] is not None:
        strict_date(release["effective_at"], "release effective_at")
    require(type(source["documents"]) is list and source["documents"], "documents must be a nonempty list")
    documents = []
    seen = set()
    active = {}
    for document in source["documents"]:
        keys(document, DOCUMENT_KEYS, "document")
        doc_id, revision = document["id"], document["revision"]
        require(isinstance(doc_id, str) and doc_id in DOCUMENT_IDS, f"nonpublic document id: {doc_id!r}")
        require(isinstance(revision, str) and len(revision) <= 100 and REVISION.fullmatch(revision), "unsafe revision")
        require((doc_id, revision) not in seen, f"duplicate revision: {doc_id}/{revision}")
        seen.add((doc_id, revision))
        status = document["status"]
        require(isinstance(status, str) and status in {"draft", "effective", "archived"}, "invalid status")
        require(doc_id != "offer" or status == "draft", "offer must remain draft; sales are closed")
        require(document["language"] == "ru", "legal original must be Russian")
        title = document["title"]
        require(isinstance(title, str) and title.strip() == title and bool(title)
                and not any(ord(char) < 32 or char in "<>" for char in title), "invalid document title")
        published = strict_date(document["published_at"], "published_at")
        effective = document["effective_at"]
        if status == "draft":
            require(effective is None, "draft effective_at must be null")
        else:
            strict_date(effective, "document effective_at")
            require(effective >= published, "effective_at precedes published_at")
        body_file = document["body_file"]
        require(body_file == f"texts/{doc_id}/{revision}.txt", "body_file must match id/revision local TXT path")
        body = local_path(source_dir, body_file).read_bytes().decode("utf-8")
        body = body.replace("\r\n", "\n").replace("\r", "\n")
        require(bool(body.strip()) and "\x00" not in body and "\ufeff" not in body, "empty or invalid text body")
        # Per-revision dates override shared fields; replacement is intentionally one pass.
        replacements = {**fields, "VERSION": revision, "DATE": published, "YEAR": published[:4]}
        if effective is not None:
            replacements["EFFECTIVE_DATE"] = effective
        else:
            replacements["EFFECTIVE_DATE"] = ""
        body = FIELD.sub(lambda match: replacements.get(match[1]) or match[0], body)
        body = body.replace("\r\n", "\n").replace("\r", "\n")
        require("\x00" not in body and "\ufeff" not in body, "invalid substituted text body")
        if status != "draft":
            require("[[" not in body and "]]" not in body and "[[" not in title and "]]" not in title,
                    f"unresolved placeholders in {doc_id}/{revision}")
        if status == "effective":
            require(doc_id not in active, f"multiple effective revisions: {doc_id}")
            require(effective == release["effective_at"], "effective dates must match release")
            active[doc_id] = document
        documents.append({
            key: value for key, value in document.items() if key != "body_file"
        } | {"body": body, "sha256": sha256(body.encode("utf-8")), "url": f"/legal/{doc_id}/{revision}"})
    require({doc["id"] for doc in documents} == DOCUMENT_IDS, "catalog must contain all five public documents")
    if active:
        require(set(active) == ACTIVE_COMPANIONS, "effective release requires terms/privacy/cookies/details")
        require(release["sequence"] > 0, "effective release requires positive sequence")
        require(release["legal_review_approved"] is True, "effective release requires legal review")
        require(retention is not None, "effective release requires evidence retention")
    else:
        require(release == {"sequence": 0, "effective_at": None, "legal_review_approved": False,
                            "evidence_retention_days": None}, "inactive release must remain sequence 0 and unapproved")
    documents.sort(key=lambda doc: (doc["id"], doc["published_at"], doc["revision"]))
    payload = {"schema_version": 1, "release": release, "documents": documents}
    return payload | {"catalog_sha256": sha256(canonical(payload))}


def manifest(catalog: dict) -> dict:
    return {
        "schema_version": 1,
        "catalog_sha256": catalog["catalog_sha256"],
        "release_sequence": catalog["release"]["sequence"],
        "documents": [{key: doc[key] for key in ("id", "revision", "sha256", "url")}
                      for doc in catalog["documents"]],
    }


def preserve_revisions(previous: dict, catalog: dict) -> None:
    """An existing generated snapshot is an additional local immutability guard.

    The backend's persistent history remains authoritative across clean builds.
    """
    previous_payload = {key: value for key, value in previous.items() if key != "catalog_sha256"}
    require(previous.get("catalog_sha256") == sha256(canonical(previous_payload)), "existing catalog hash mismatch")
    current = {(doc["id"], doc["revision"]): doc for doc in catalog["documents"]}
    require(type(previous.get("documents")) is list, "invalid existing documents")
    for old in previous["documents"]:
        require(type(old) is dict and isinstance(old.get("body"), str), "invalid existing document")
        require(old.get("sha256") == sha256(old["body"].encode("utf-8")), "existing body hash mismatch")
        key = (old["id"], old["revision"])
        require(key in current, f"cannot remove published revision: {key}")
        if old["status"] != "draft":
            new = current[key]
            require(old["sha256"] == new["sha256"], f"immutable revision hash changed: {key}")
            require(all(old[field] == new[field] for field in (
                "id", "revision", "language", "title", "published_at", "effective_at", "url",
            )), f"immutable revision metadata changed: {key}")
            require(new["status"] != "draft", f"cannot demote historical revision to draft: {key}")


def generate(root: Path, check: bool = False) -> None:
    catalog = build_catalog(root)
    paths = [local_path(root, relative) for relative in OUTPUTS]
    for path in paths[:2]:
        if path.exists():
            preserve_revisions(load_json(path), catalog)
    outputs = (serialized(catalog), serialized(catalog), serialized(manifest(catalog)))
    if check:
        stale = [str(path.relative_to(root)) for path, data in zip(paths, outputs)
                 if not path.is_file() or path.read_bytes() != data]
        require(not stale, "stale or missing generated artifacts: " + ", ".join(stale))
        return
    for path, data in zip(paths, outputs):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate exact artifacts without writing anything")
    args = parser.parse_args(argv)
    try:
        generate(Path(__file__).resolve().parents[2], check=args.check)
    except (CatalogError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"legal catalog: {exc}", file=sys.stderr)
        return 1
    print("legal catalog: " + ("up to date" if args.check else "generated"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
