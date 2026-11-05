from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool


class LegalAcceptance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy_id: str = Field(max_length=100)
    terms_revision: str = Field(max_length=100)
    terms_sha256: str = Field(max_length=64)
    accepted: StrictBool


class RequiredTerms(BaseModel):
    document_id: Literal["terms"] = "terms"
    revision: str
    sha256: str
    url: str


class SignupPolicy(BaseModel):
    mode: Literal["draft", "enforced"]
    policy_id: str | None
    catalog_sha256: str
    required_terms: RequiredTerms | None
    privacy_url: str
