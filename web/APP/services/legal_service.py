"""File-driven activation; all policy decisions are serialized with registration.

Network readiness is checked only by reconciliation, never by a draft request.
A newer unactivated bundle fails closed for signup. Older workers use the DB's
immutable policy, never their own stale text. Nothing here gates existing logins.
"""

import asyncio
import ipaddress
import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from sqlalchemy import DateTime, delete, func, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from APP.config import settings
from APP.constants import EmailMessageType, Locale
from APP.entities.legal import LegalAcceptance, RequiredTerms, SignupPolicy
from APP.exceptions import AppException, ConflictError, ErrorCode, ValidationError
from APP.legal_catalog import LegalCatalog, load_catalog
from SPI.db_adapter.models.legal import (
    LegalAcceptanceModel,
    LegalActivationModel,
    LegalDocumentSnapshotModel,
    LegalNotificationModel,
)
from SPI.db_adapter.models.user import UserModel
from SPI.mq_adapter.publisher import MQPublisher
from SPI.mq_adapter.schemas import EmailMessage

# Fixed, distinct from the housekeeping lock. Shared signup/read; exclusive activation.
POLICY_LOCK_KEY = 0x57444C47
MAX_USER_AGENT = 512
MAX_MANIFEST_BYTES = 1024 * 1024
ManifestFetcher = Callable[[], Awaitable[dict]]


class LegalPolicyUnavailable(AppException):
    status = 503

    def __init__(self, message: str):
        super().__init__(message, code=ErrorCode.VALIDATION_FAILED, reason="legal_policy_unavailable")


def frontend_origin() -> str:
    value = settings.app.frontend_url.rstrip("/")
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username
            or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise LegalPolicyUnavailable("Legal publication needs one configured frontend origin")
    return value


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Refusing all redirects is stricter than refusing cross-origin redirects.
        return None


async def fetch_publication_manifest() -> dict:
    url = frontend_origin() + "/legal/catalog-manifest.json"
    timeout = settings.app.legal_manifest_timeout_seconds

    def read() -> dict:
        opener = build_opener(ProxyHandler({}), _NoRedirect())
        with opener.open(Request(url, headers={"Accept": "application/json"}), timeout=timeout) as response:
            if response.status != 200:
                raise ValueError("Manifest HTTP status is not 200")
            body = response.read(MAX_MANIFEST_BYTES + 1)
            if len(body) > MAX_MANIFEST_BYTES:
                raise ValueError("Manifest exceeds size limit")
            return json.loads(body)

    return await asyncio.wait_for(asyncio.to_thread(read), timeout=timeout)


async def policy_lock(session: AsyncSession, *, shared: bool) -> None:
    lock = func.pg_advisory_xact_lock_shared if shared else func.pg_advisory_xact_lock
    await session.execute(select(lock(POLICY_LOCK_KEY)))


async def latest_activation(session: AsyncSession) -> LegalActivationModel | None:
    return await session.scalar(select(LegalActivationModel).order_by(LegalActivationModel.sequence.desc()).limit(1))


class LegalService:
    def __init__(self, session: AsyncSession, catalog: LegalCatalog | None = None):
        self.session = session
        self._catalog = catalog

    @property
    def catalog(self) -> LegalCatalog:
        # AuthService is shared by login/reset/etc. Do not make those operations
        # depend on legal bundle readiness; only policy/signup reads load it.
        if self._catalog is None:
            try:
                self._catalog = load_catalog()
            except (OSError, ValueError) as exc:
                raise LegalPolicyUnavailable("Legal catalog is unavailable") from exc
        return self._catalog

    async def _active_policy(self) -> LegalActivationModel | None:
        # The caller's commit/rollback releases this, including registration writes.
        await policy_lock(self.session, shared=True)
        active = await latest_activation(self.session)
        if self.catalog.effective_documents:
            sequence = self.catalog.release.sequence
            if active is None or sequence > active.sequence:
                raise LegalPolicyUnavailable("Legal publication has not been activated; please retry later")
            if sequence == active.sequence and self.catalog.active_fingerprint != active.fingerprint:
                raise LegalPolicyUnavailable("Legal release sequence conflicts with the published policy")
        return active

    @staticmethod
    def _policy(active: LegalActivationModel) -> SignupPolicy:
        terms = next(d for d in active.documents if d["id"] == "terms")
        privacy = next(d for d in active.documents if d["id"] == "privacy")
        return SignupPolicy(
            mode="enforced", policy_id=str(active.id), catalog_sha256=active.catalog_sha256,
            required_terms=RequiredTerms(revision=terms["revision"], sha256=terms["sha256"], url=terms["url"]),
            privacy_url=privacy["url"],
        )

    async def signup_policy(self) -> SignupPolicy:
        active = await self._active_policy()
        if active:
            return self._policy(active)
        privacy = next(d for d in reversed(self.catalog.documents) if d.id == "privacy")
        return SignupPolicy(mode="draft", policy_id=None, catalog_sha256=self.catalog.catalog_sha256,
                            required_terms=None, privacy_url=privacy.url)

    async def require_acceptance(self, acceptance: LegalAcceptance | None) -> LegalActivationModel | None:
        active = await self._active_policy()
        if active is None:
            if acceptance is not None:
                raise ValidationError("Draft documents cannot be accepted", code=ErrorCode.VALIDATION_FAILED,
                                      reason="legal_draft_acceptance")
            return None
        if acceptance is None or not acceptance.accepted:
            raise ValidationError("Accept the current terms to register", code=ErrorCode.VALIDATION_FAILED,
                                  reason="legal_acceptance_required")
        terms = self._policy(active).required_terms
        if (acceptance.policy_id != str(active.id) or acceptance.terms_revision != terms.revision
                or acceptance.terms_sha256 != terms.sha256):
            raise ConflictError("Terms changed; reload and review the current policy", code=ErrorCode.VALIDATION_FAILED,
                                reason="legal_policy_stale")
        return active

    async def record_acceptance(
        self, active: LegalActivationModel | None, user_id: uuid.UUID, locale: Locale,
        ip_address: str | None, user_agent: str | None,
    ) -> None:
        if active is None:
            return
        terms = self._policy(active).required_terms
        now = datetime.now(timezone.utc)
        try:
            ip = str(ipaddress.ip_address(ip_address)) if ip_address else None
        except ValueError:
            ip = None
        self.session.add(LegalAcceptanceModel(
            user_id=user_id, activation_id=active.id, document_id="terms", revision=terms.revision,
            sha256=terms.sha256, action="accept_terms", locale=locale.value, ip_address=ip,
            user_agent=user_agent[:MAX_USER_AGENT] if user_agent else None, created_at=now,
            retain_until=now + timedelta(days=active.release["evidence_retention_days"]),
        ))
        await self.session.flush()

    async def reconcile(self, fetch_manifest: ManifestFetcher = fetch_publication_manifest) -> bool:
        """Activate + enqueue atomically; caller owns commit. A draft performs no IO."""
        catalog = self.catalog
        if not catalog.effective_documents:
            return False
        # Avoid even a readiness request on restarts/draft-only edits/older workers.
        await policy_lock(self.session, shared=False)
        active = await latest_activation(self.session)
        if active and catalog.release.sequence < active.sequence:
            return False
        if active and catalog.release.sequence == active.sequence:
            if catalog.active_fingerprint != active.fingerprint:
                raise LegalPolicyUnavailable("Release sequence cannot be reused with different effective content")
            return False
        now = await self.session.scalar(select(func.clock_timestamp()))
        if date.fromisoformat(catalog.release.effective_at) > now.astimezone(timezone.utc).date():
            raise LegalPolicyUnavailable("Legal release effective date has not arrived")
        try:
            manifest = await fetch_manifest()
        except Exception as exc:
            raise LegalPolicyUnavailable("Legal publication manifest is unavailable") from exc
        if manifest != catalog.manifest():
            raise LegalPolicyUnavailable("Legal publication manifest does not match this catalog")
        new_documents = []
        for document in catalog.effective_documents:
            snapshot = await self.session.get(LegalDocumentSnapshotModel, (document.id, document.revision))
            if snapshot:
                if snapshot.sha256 != document.sha256 or snapshot.document != document.model_dump():
                    raise LegalPolicyUnavailable("A published document revision cannot be changed")
            else:
                new_documents.append(document)
                self.session.add(LegalDocumentSnapshotModel(
                    document_id=document.id, revision=document.revision, sha256=document.sha256,
                    document=document.model_dump(),
                ))
        await self.session.flush()
        # Sample cutoff after readiness too, under the lock held through commit.
        cutoff = await self.session.scalar(select(func.clock_timestamp()))
        activation = LegalActivationModel(
            id=uuid.uuid4(), sequence=catalog.release.sequence, fingerprint=catalog.active_fingerprint,
            catalog_sha256=catalog.catalog_sha256, release=catalog.release.model_dump(),
            documents=[d.model_dump() for d in catalog.effective_documents], created_at=cutoff,
        )
        self.session.add(activation)
        await self.session.flush()
        # Reusing a published revision is not an update. Its original outbox
        # remains authoritative; never widen the cutoff to later signups.
        for document in new_documents:
            eligible = select(
                func.gen_random_uuid(), UserModel.id, literal(activation.id, type_=LegalNotificationModel.activation_id.type),
                literal(document.id), literal(document.revision), literal("pending"),
                literal(cutoff, type_=DateTime(timezone=True)),
            ).where(
                UserModel.is_active.is_(True), UserModel.is_verified.is_(True),
                UserModel.created_at <= cutoff.astimezone(timezone.utc).replace(tzinfo=None),
            )
            await self.session.execute(insert(LegalNotificationModel).from_select(
                ["id", "user_id", "activation_id", "document_id", "revision", "status", "created_at"], eligible,
            ).on_conflict_do_nothing(index_elements=["user_id", "document_id", "revision"]))
        return True


async def publish_pending_notifications(session: AsyncSession, publisher: MQPublisher, *, limit: int = 100) -> int:
    """Return consumed rows (published or suppressed), not delivered messages.

    Broker-confirmed only. Replays retain ID/time after a lost commit.

    Recipient row locks serialize account deactivation with the final eligibility
    check. Locks and outbox status are held through caller commit, never over a
    separate mail-provider call.
    """
    jobs = (await session.scalars(select(LegalNotificationModel).where(
        LegalNotificationModel.status == "pending",
    ).order_by(LegalNotificationModel.created_at, LegalNotificationModel.id).limit(limit)
        .with_for_update(skip_locked=True))).all()
    for job in jobs:
        user = await session.scalar(select(UserModel).where(UserModel.id == job.user_id).with_for_update())
        if not user or not user.is_active or not user.is_verified:
            job.status = "suppressed"
            continue
        snapshot = await session.get(LegalDocumentSnapshotModel, (job.document_id, job.revision))
        document = snapshot.document
        prefix = "/en" if user.locale == "en" else ""
        message = EmailMessage(
            type=EmailMessageType.LEGAL_REVISION_UPDATED, notification_id=job.id, created_at=job.created_at,
            to_email=user.email, to_name=user.username, locale=Locale(user.locale), data={
                "document_title": document["title"], "document_revision": job.revision,
                "effective_date": document["effective_at"],
                "document_url": frontend_origin() + prefix + document["url"],
            },
        )
        await publisher.publish_email(message)
        job.status = "published"
        job.published_at = datetime.now(timezone.utc)
    await session.flush()
    return len(jobs)


async def purge_expired_legal_evidence(session: AsyncSession, now: datetime) -> int:
    # DB trigger independently enforces retention against premature delete/update.
    result = await session.execute(delete(LegalAcceptanceModel).where(
        LegalAcceptanceModel.retain_until <= func.now(),
    ))
    return result.rowcount
