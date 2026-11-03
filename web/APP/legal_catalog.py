"""Validated, container-local legal catalog boundary (no runtime docs/ dependency)."""

import hashlib
import json
import re
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DOCUMENT_IDS = {"terms", "offer", "privacy", "cookies", "details"}
REQUIRED_IDS = DOCUMENT_IDS - {"offer"}


def canonical_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


class CatalogRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class LegalRelease(CatalogRecord):
    sequence: int = Field(ge=0)
    effective_at: str | None
    legal_review_approved: bool
    evidence_retention_days: int | None = Field(gt=0)


class LegalDocument(CatalogRecord):
    id: Literal["terms", "offer", "privacy", "cookies", "details"]
    revision: str = Field(pattern=r"^[a-zA-Z0-9_-]+$", max_length=100)
    status: Literal["draft", "effective", "archived"]
    language: Literal["ru"]
    title: str = Field(min_length=1)
    published_at: str
    effective_at: str | None
    body: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    url: str

    @model_validator(mode="after")
    def validate_document(self):
        if self.url != f"/legal/{self.id}/{self.revision}":
            raise ValueError("Noncanonical document URL")
        if "\r" in self.body or hashlib.sha256(self.body.encode("utf-8")).hexdigest() != self.sha256:
            raise ValueError("Document body/hash mismatch")
        for value in (self.published_at, self.effective_at):
            if value is not None and date.fromisoformat(value).isoformat() != value:
                raise ValueError("Expected YYYY-MM-DD")
        return self


class LegalCatalog(CatalogRecord):
    schema_version: Literal[1]
    catalog_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    release: LegalRelease
    documents: list[LegalDocument]

    @model_validator(mode="after")
    def validate_catalog(self):
        payload = self.model_dump(exclude={"catalog_sha256"})
        if canonical_hash(payload) != self.catalog_sha256:
            raise ValueError("Catalog fingerprint mismatch")
        if len({(d.id, d.revision) for d in self.documents}) != len(self.documents):
            raise ValueError("Duplicate document revision")
        if {d.id for d in self.documents} != DOCUMENT_IDS:
            raise ValueError("Incomplete public catalog")
        effective = self.effective_documents
        if len({d.id for d in effective}) != len(effective):
            raise ValueError("Multiple effective revisions")
        if any(d.id == "offer" and d.status != "draft" for d in self.documents):
            raise ValueError("Sales are closed: offer must remain draft")
        release = self.release
        if release.effective_at is not None:
            if date.fromisoformat(release.effective_at).isoformat() != release.effective_at:
                raise ValueError("Expected release YYYY-MM-DD")
        if effective:
            if (release.sequence <= 0 or not release.legal_review_approved
                    or release.evidence_retention_days is None or release.effective_at is None):
                raise ValueError("Effective release needs sequence, signoff, date and retention")
            if {d.id for d in effective} != REQUIRED_IDS:
                raise ValueError("Effective terms require privacy, cookies and details")
            for document in effective:
                if (document.effective_at != release.effective_at
                        or document.published_at > document.effective_at
                        or re.search(r"\[\[|\]\]", document.body + document.title)):
                    raise ValueError("Effective document has placeholders or inconsistent dates")
        elif release.sequence != 0 or release.effective_at is not None:
            raise ValueError("Draft-only catalogs must use sequence zero and no effective date")
        return self

    @property
    def effective_documents(self) -> list[LegalDocument]:
        return [d for d in self.documents if d.status == "effective"]

    @property
    def active_fingerprint(self) -> str:
        # Draft edits are deliberately excluded from an already activated release identity.
        return canonical_hash({"release": self.release.model_dump(), "documents": [
            d.model_dump() for d in sorted(self.effective_documents, key=lambda d: d.id)
        ]})

    def manifest(self) -> dict:
        return {"schema_version": 1, "catalog_sha256": self.catalog_sha256,
                "release_sequence": self.release.sequence, "documents": [
                    {k: getattr(d, k) for k in ("id", "revision", "sha256", "url")}
                    for d in self.documents]}


def load_catalog(path: Path | None = None) -> LegalCatalog:
    path = path or Path(__file__).with_name("legal_catalog.generated.json")
    return LegalCatalog.model_validate_json(path.read_text(encoding="utf-8"))
