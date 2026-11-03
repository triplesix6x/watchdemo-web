"""Container-local catalog validation (no docs dependency or network)."""

import copy
import hashlib

import pytest
from pydantic import ValidationError

from APP.legal_catalog import LegalCatalog, canonical_hash


def catalog(*, sequence=0, revision="r1", draft_note="draft"):
    effective = sequence > 0
    payload = {
        "schema_version": 1,
        "release": {"sequence": sequence, "effective_at": "2026-01-01" if effective else None,
                    "legal_review_approved": effective, "evidence_retention_days": 30 if effective else None},
        "documents": [],
    }
    for doc_id in ("terms", "offer", "privacy", "cookies", "details"):
        active = effective and doc_id != "offer"
        body = f"Текст {doc_id}\n" if active else draft_note + "\n"
        payload["documents"].append({
            "id": doc_id, "revision": revision, "status": "effective" if active else "draft",
            "language": "ru", "title": f"Документ {doc_id}", "published_at": "2026-01-01",
            "effective_at": "2026-01-01" if active else None, "body": body,
            "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(), "url": f"/legal/{doc_id}/{revision}",
        })
    return validate_payload(payload)


def validate_payload(payload):
    payload = copy.deepcopy(payload)
    payload.pop("catalog_sha256", None)
    payload["catalog_sha256"] = canonical_hash(payload)
    return LegalCatalog.model_validate(payload)


def test_catalog_hash_exact_utf8_and_draft_excluded_from_active_fingerprint():
    one, two = catalog(sequence=1), catalog(sequence=1, draft_note="edited offer")
    assert one.catalog_sha256 != two.catalog_sha256
    assert one.active_fingerprint == two.active_fingerprint
    assert canonical_hash({"x": "я"}) == hashlib.sha256('{"x":"я"}'.encode("utf-8")).hexdigest()


@pytest.mark.parametrize("mutation", [
    lambda p: p["release"].update(legal_review_approved=False),
    lambda p: p["release"].update(evidence_retention_days=None),
    lambda p: p["release"].update(evidence_retention_days=0),
    lambda p: p["release"].update(sequence=0),
    lambda p: p["release"].update(effective_at="2026-1-1"),
    lambda p: p["documents"][0].update(published_at="2026-01-02"),
    lambda p: p["documents"][0].update(effective_at="2026-01-02"),
    lambda p: p["documents"][0].update(title="[[operator]]"),
    lambda p: p["documents"][1].update(status="effective"),
    lambda p: p["documents"][2].update(status="draft"),
    lambda p: p["documents"][0].update(body="changed without hash"),
    lambda p: p["documents"][0].update(url="https://evil.invalid/terms"),
])
def test_catalog_rejects_unready_or_noncanonical_effective_release(mutation):
    payload = catalog(sequence=1).model_dump()
    mutation(payload)
    with pytest.raises(ValidationError):
        validate_payload(payload)


def test_catalog_rejects_stale_generated_hash():
    payload = catalog().model_dump()
    payload["release"]["legal_review_approved"] = True
    with pytest.raises(ValidationError, match="Catalog fingerprint mismatch"):
        LegalCatalog.model_validate(payload)
