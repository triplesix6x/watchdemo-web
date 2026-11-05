"""Legal signup, activation and outbox behavior; all transports are explicit fakes.

DB cases are opt-in and restricted to the contract's disposable localhost database
at Alembic head. No infrastructure is created here. Run only by the coordinator.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import os
import pytest
from fastapi import FastAPI
from pydantic import ValidationError as SchemaError
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from API.views.auth.views import router as auth_router
from API.views.legal.views import router as legal_router
from APP.constants import EmailMessageType, Locale
from APP.dependencies import get_auth_service, get_legal_service
from APP.entities.legal import LegalAcceptance
from APP.exception_handlers import register_exception_handlers
from APP.exceptions import ValidationError
from APP.rate_limiter import register_rate_limit
from APP.services import legal_service as svc
from APP.services.auth_service import AuthService
from SPI.db_adapter.models.legal import (
    LegalAcceptanceModel, LegalActivationModel, LegalDocumentSnapshotModel, LegalNotificationModel,
)
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.models.token import OneTimeTokenModel
from SPI.db_adapter.models.user import UserModel
from SPI.db_adapter.repositories.session_repo import SessionRepository
from SPI.db_adapter.repositories.subscription_repo import SubscriptionRepository
from SPI.db_adapter.repositories.token_repo import OneTimeTokenRepository
from SPI.db_adapter.repositories.user_repo import UserRepository
from SPI.mq_adapter.schemas import EmailMessage
from test_legal_catalog import catalog, validate_payload

DB_URL = os.environ.get("TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not DB_URL, reason="TEST_DATABASE_URL is not set")


class Publisher:
    def __init__(self):
        self.messages = []
        self.fail = False

    async def publish_email(self, message):
        if self.fail:
            raise RuntimeError("fake broker failure")
        self.messages.append(message)


def accepted(policy):
    return LegalAcceptance(policy_id=policy.policy_id, terms_revision=policy.required_terms.revision,
                           terms_sha256=policy.required_terms.sha256, accepted=True)


def db_case(fn):
    url = make_url(DB_URL)
    assert (url.drivername == "postgresql+asyncpg" and url.host in {"127.0.0.1", "localhost"}
            and url.port == 55438 and url.database == "watchdemo_prelaunch_qa"
            and url.username == "watchdemo_qa" and url.password == "watchdemo_qa_local_only"), \
        "Legal tests may only use the contract's disposable QA database"

    async def run():
        engine = create_async_engine(url, pool_size=3, max_overflow=0)
        try:
            async with engine.begin() as connection:
                await connection.execute(text(
                    "TRUNCATE legal_notifications, legal_acceptances, legal_activations, "
                    "legal_document_snapshots, users CASCADE"
                ))
            return await fn(async_sessionmaker(engine, expire_on_commit=False))
        finally:
            await engine.dispose()
    return asyncio.run(run())


def auth(session, bundle, publisher):
    service = AuthService(
        UserRepository(session), SessionRepository(session), SubscriptionRepository(session),
        OneTimeTokenRepository(session), publisher, AsyncMock(), AsyncMock(), svc.LegalService(session, bundle),
    )
    # Password rules still execute; avoid expensive bcrypt in these DB behavior tests.
    service._hash_password = lambda password: "test-only-hash"
    return service


async def add_user(sm, *, verified=True, active=True, locale="ru"):
    async with sm() as session, session.begin():
        user = UserModel(id=uuid.uuid4(), email=f"{uuid.uuid4().hex}@example.invalid",
                         username=uuid.uuid4().hex, password_hash="x", is_verified=verified,
                         is_active=active, locale=locale)
        session.add(user)
        await session.flush()
        return user.id


async def activate(sm, bundle):
    async with sm() as session, session.begin():
        return await svc.LegalService(session, bundle).reconcile(AsyncMock(return_value=bundle.manifest()))


async def policy(sm, bundle):
    async with sm() as session, session.begin():
        return await svc.LegalService(session, bundle).signup_policy()


async def count(sm, model):
    async with sm() as session:
        return await session.scalar(select(func.count()).select_from(model))


def test_draft_reconciliation_has_no_database_or_network_io():
    session, fetcher = AsyncMock(), AsyncMock(side_effect=AssertionError("network forbidden"))
    assert asyncio.run(svc.LegalService(session, catalog()).reconcile(fetcher)) is False
    session.execute.assert_not_called()
    fetcher.assert_not_called()


def test_auth_dependency_does_not_load_legal_catalog_until_signup(monkeypatch):
    def broken():
        raise OSError("missing bundle")

    monkeypatch.setattr(svc, "load_catalog", broken)
    # Constructing shared auth dependencies must not break login/reset paths.
    service = svc.LegalService(AsyncMock())
    assert service._catalog is None
    with pytest.raises(svc.LegalPolicyUnavailable):
        _ = service.catalog


def test_legal_message_requires_stable_identity_utc_and_exact_data():
    base = dict(type=EmailMessageType.LEGAL_REVISION_UPDATED, to_email="qa@example.invalid", to_name="QA",
                data={"document_title": "Условия", "document_revision": "r1", "effective_date": "2026-01-01",
                      "document_url": "https://frontend.example.invalid/legal/terms/r1"})
    with pytest.raises(SchemaError):
        EmailMessage(**base)
    with pytest.raises(SchemaError):
        EmailMessage(**base, notification_id=uuid.uuid4(), created_at=datetime(2026, 1, 1))
    message = EmailMessage(**base, notification_id=uuid.uuid4(), created_at=datetime.now(timezone.utc))
    assert message.created_at.utcoffset() == timedelta(0)
    assert EmailMessage(type=EmailMessageType.VERIFY_EMAIL, to_email="a@example.invalid", to_name="a", data={}).notification_id is None
    for data in ({}, {**base["data"], "ip_address": "203.0.113.1"},
                 {**base["data"], "document_url": "javascript:alert(1)"}):
        with pytest.raises(SchemaError):
            EmailMessage(**{**base, "data": data}, notification_id=uuid.uuid4(), created_at=datetime.now(timezone.utc))


def test_signup_http_wire_and_statuses_without_network(monkeypatch):
    bundle = catalog(sequence=1)
    active = LegalActivationModel(id=uuid.uuid4(), sequence=1, fingerprint=bundle.active_fingerprint,
        catalog_sha256=bundle.catalog_sha256, release=bundle.release.model_dump(),
        documents=[d.model_dump() for d in bundle.effective_documents], created_at=datetime.now(timezone.utc))
    monkeypatch.setattr(svc, "policy_lock", AsyncMock())
    active_lookup = AsyncMock(return_value=None)
    monkeypatch.setattr(svc, "latest_activation", active_lookup)
    service = svc.LegalService(AsyncMock(), catalog())
    app = FastAPI()
    app.include_router(legal_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    register_exception_handlers(app)
    app.dependency_overrides[get_legal_service] = lambda: service
    app.dependency_overrides[register_rate_limit] = lambda: None

    class Auth:
        async def register(self, **kwargs):
            await service.require_acceptance(kwargs["legal_acceptance"])

    app.dependency_overrides[get_auth_service] = Auth

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            body = {"email": "qa@example.com", "username": "qauser", "password": "ValidPassword1"}
            draft = await client.get("/api/v1/legal/signup-policy")
            assert draft.status_code == 200 and draft.headers["cache-control"] == "no-store"
            assert draft.json() == {"mode": "draft", "policy_id": None, "catalog_sha256": service.catalog.catalog_sha256,
                                    "required_terms": None, "privacy_url": "/legal/privacy/r1"}
            assert (await client.post("/api/v1/auth/register", json=body)).status_code == 201
            fake = {"policy_id": "fake", "terms_revision": "r1", "terms_sha256": "0" * 64, "accepted": True}
            rejected = await client.post("/api/v1/auth/register", json={**body, "legal_acceptance": fake})
            assert rejected.status_code == 422 and rejected.json()["reason"] == "legal_draft_acceptance"
            service._catalog = bundle
            active_lookup.return_value = active
            enforced = (await client.get("/api/v1/legal/signup-policy")).json()
            assert enforced["mode"] == "enforced" and enforced["required_terms"]["document_id"] == "terms"
            valid = accepted(svc.LegalService._policy(active)).model_dump()
            for acceptance in (None, {**valid, "accepted": False}):
                response = await client.post("/api/v1/auth/register", json={**body, "legal_acceptance": acceptance})
                assert response.status_code == 422 and response.json()["reason"] == "legal_acceptance_required"
            for field in ("policy_id", "terms_revision", "terms_sha256"):
                response = await client.post("/api/v1/auth/register", json={**body, "legal_acceptance": {**valid, field: "stale"}})
                assert response.status_code == 409 and response.json()["reason"] == "legal_policy_stale"
            assert (await client.post("/api/v1/auth/register", json={**body, "legal_acceptance": valid})).status_code == 201
            # Server-owned evidence fields cannot be smuggled into the acceptance.
            response = await client.post("/api/v1/auth/register", json={**body, "legal_acceptance": {**valid, "ip_address": "fake"}})
            assert response.status_code == 422
    asyncio.run(run())


@needs_db
def test_registration_commits_account_basic_evidence_and_token_before_email():
    async def run(sm):
        bundle, publisher = catalog(sequence=1), Publisher()
        await activate(sm, bundle)
        current = await policy(sm, bundle)
        original_publish = publisher.publish_email

        async def after_commit(message):
            # Independent connection must see every write before MQ is invoked.
            for model in (UserModel, SubscriptionModel, LegalAcceptanceModel, OneTimeTokenModel):
                assert await count(sm, model) == 1
            await original_publish(message)
        publisher.publish_email = after_commit
        async with sm() as session:
            user = await auth(session, bundle, publisher).register(
                "new@example.invalid", "newuser", "ValidPassword1", Locale.EN, accepted(current),
                "2001:0db8::1", "U" * 900,
            )
        async with sm() as session:
            evidence = await session.scalar(select(LegalAcceptanceModel))
            assert evidence.user_id == user.id and evidence.action == "accept_terms" and evidence.locale == "en"
            assert evidence.ip_address == "2001:db8::1" and len(evidence.user_agent) == 512
            assert evidence.created_at.utcoffset() == timedelta(0)
            assert evidence.retain_until - evidence.created_at == timedelta(days=30)
            assert evidence.sha256 == current.required_terms.sha256
        assert publisher.messages[0].type == EmailMessageType.VERIFY_EMAIL
        assert "/en/verify-email?token=" in publisher.messages[0].data["verification_url"]
        assert await count(sm, LegalNotificationModel) == 0
        assert await activate(sm, bundle) is False
    db_case(run)


@needs_db
@pytest.mark.parametrize("failure", ["evidence", "token", "commit"])
def test_registration_failure_rolls_back_every_write_and_never_publishes(failure):
    async def run(sm):
        bundle, publisher = catalog(sequence=1), Publisher()
        await activate(sm, bundle)
        current = await policy(sm, bundle)
        async with sm() as session:
            service = auth(session, bundle, publisher)
            if failure == "evidence":
                record = service._legal.record_acceptance

                async def broken(*args):
                    await record(*args)
                    raise RuntimeError("fake evidence failure")
                service._legal.record_acceptance = broken
            elif failure == "token":
                service._token_repo.create = AsyncMock(side_effect=RuntimeError("fake token failure"))
            else:
                session.commit = AsyncMock(side_effect=RuntimeError("fake commit failure"))
            with pytest.raises(RuntimeError):
                await service.register("new@example.invalid", "newuser", "ValidPassword1", legal_acceptance=accepted(current))
            await session.rollback()
        for model in (UserModel, SubscriptionModel, LegalAcceptanceModel, OneTimeTokenModel):
            assert await count(sm, model) == 0
        assert publisher.messages == []
    db_case(run)


@needs_db
def test_draft_registration_remains_compatible_but_cannot_accept_fake_terms():
    async def run(sm):
        publisher, bundle = Publisher(), catalog()
        async with sm() as session:
            await auth(session, bundle, publisher).register("new@example.invalid", "newuser", "ValidPassword1")
        assert await count(sm, UserModel) == 1
        assert await count(sm, LegalAcceptanceModel) == 0
        async with sm() as session:
            with pytest.raises(ValidationError):
                await auth(session, bundle, publisher).register("fake@example.invalid", "fakeuser", "ValidPassword1",
                    legal_acceptance=LegalAcceptance(policy_id="fake", terms_revision="fake", terms_sha256="0" * 64, accepted=True))
            await session.rollback()
        assert await count(sm, UserModel) == 1
    db_case(run)


@needs_db
def test_activation_manifest_failure_is_atomic_and_signup_fails_closed():
    async def run(sm):
        bundle = catalog(sequence=1)
        for fetch in (AsyncMock(return_value={}), AsyncMock(side_effect=TimeoutError("fake timeout"))):
            async with sm() as session:
                with pytest.raises(svc.LegalPolicyUnavailable):
                    await svc.LegalService(session, bundle).reconcile(fetch)
                await session.rollback()
            for model in (LegalActivationModel, LegalDocumentSnapshotModel, LegalNotificationModel):
                assert await count(sm, model) == 0
        async with sm() as session:
            with pytest.raises(svc.LegalPolicyUnavailable):
                await svc.LegalService(session, bundle).require_acceptance(None)
    db_case(run)


@needs_db
def test_monotonic_policy_old_workers_draft_changes_and_immutable_revisions():
    async def run(sm):
        first, second = catalog(sequence=1), catalog(sequence=2, revision="r2")
        await activate(sm, first)
        await activate(sm, second)
        current = await policy(sm, second)
        for old in (first, catalog()):
            assert await activate(sm, old) is False
            assert (await policy(sm, old)).policy_id == current.policy_id
            async with sm() as session, session.begin():
                with pytest.raises(ValidationError):
                    await svc.LegalService(session, old).require_acceptance(None)
        assert await activate(sm, catalog(sequence=2, revision="r2", draft_note="edited offer")) is False
        # Reuse a sequence with another effective fingerprint, or mutate a published revision.
        for changed in (catalog(sequence=2, revision="other"), catalog(sequence=3)):
            if changed.release.sequence == 3:
                payload = changed.model_dump()
                payload["documents"][0]["title"] = "Changed published metadata"
                changed = validate_payload(payload)
            async with sm() as session:
                with pytest.raises(svc.LegalPolicyUnavailable):
                    await svc.LegalService(session, changed).reconcile(AsyncMock(return_value=changed.manifest()))
                await session.rollback()
        assert await count(sm, LegalActivationModel) == 2
        async with sm() as session:
            for old_terms in (await policy(sm, first),):
                # An old worker returns the DB policy, not its local terms.
                assert old_terms == current
    db_case(run)


@needs_db
def test_activation_failure_after_snapshot_flush_rolls_back_snapshot_cutoff_and_jobs():
    async def run(sm):
        await add_user(sm)
        bundle = catalog(sequence=1)
        async with sm() as session:
            execute = session.execute

            async def broken(statement, *args, **kwargs):
                table = getattr(statement, "table", None)
                if table is not None and table.name == "legal_notifications":
                    raise RuntimeError("fake outbox insert failure")
                return await execute(statement, *args, **kwargs)
            session.execute = broken
            with pytest.raises(RuntimeError, match="fake outbox insert failure"):
                await svc.LegalService(session, bundle).reconcile(AsyncMock(return_value=bundle.manifest()))
            await session.rollback()
        for model in (LegalActivationModel, LegalDocumentSnapshotModel, LegalNotificationModel):
            assert await count(sm, model) == 0
    db_case(run)


@needs_db
def test_higher_sequence_can_reuse_immutable_text_without_duplicate_notification():
    async def run(sm):
        await add_user(sm)
        first, second = catalog(sequence=1), catalog(sequence=2)
        await activate(sm, first)
        old_policy = await policy(sm, first)
        # A later verified signup must not get an unchanged revision on release 2.
        await add_user(sm)
        assert await activate(sm, second) is True
        current = await policy(sm, second)
        assert current.policy_id != old_policy.policy_id
        assert await count(sm, LegalDocumentSnapshotModel) == 4
        assert await count(sm, LegalNotificationModel) == 4
        async with sm() as session:
            with pytest.raises(svc.ConflictError):
                await svc.LegalService(session, first).require_acceptance(accepted(old_policy))
    db_case(run)


@needs_db
def test_future_effective_date_does_not_check_manifest_or_activate():
    async def run(sm):
        payload = catalog(sequence=1).model_dump()
        future = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
        payload["release"]["effective_at"] = future
        for document in payload["documents"]:
            if document["status"] == "effective":
                document["effective_at"] = future
        bundle, fetch = validate_payload(payload), AsyncMock()
        async with sm() as session:
            with pytest.raises(svc.LegalPolicyUnavailable):
                await svc.LegalService(session, bundle).reconcile(fetch)
        fetch.assert_not_called()
        assert await count(sm, LegalActivationModel) == 0
    db_case(run)


@needs_db
def test_concurrent_activations_dedupe_and_shared_signup_lock_holds_until_commit():
    async def run(sm):
        await add_user(sm)
        bundle = catalog(sequence=1)
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def manifest():
            calls.append(True)
            entered.set()
            await release.wait()
            return bundle.manifest()

        async def reconcile():
            async with sm() as session, session.begin():
                return await svc.LegalService(session, bundle).reconcile(manifest)

        # Registration/read acquires a shared transaction lock before an activation.
        async with sm() as registration:
            assert await svc.LegalService(registration, catalog()).require_acceptance(None) is None
            first = asyncio.create_task(reconcile())
            await asyncio.sleep(0.05)
            assert not entered.is_set()
            await registration.commit()
            await asyncio.wait_for(entered.wait(), timeout=3)
            second = asyncio.create_task(reconcile())
            release.set()
            result = await asyncio.wait_for(asyncio.gather(first, second), timeout=5)
        assert sorted(result) == [False, True] and len(calls) == 1
        assert await count(sm, LegalActivationModel) == 1
        assert await count(sm, LegalNotificationModel) == 4
        assert await activate(sm, bundle) is False
        assert await count(sm, LegalNotificationModel) == 4
    db_case(run)


@needs_db
def test_outbox_cutoff_suppression_parallel_publish_and_stable_retry_identity():
    async def run(sm):
        english = await add_user(sm, locale="en")
        deactivated = await add_user(sm)
        await add_user(sm, verified=False)
        await add_user(sm, active=False)
        bundle, publisher = catalog(sequence=1), Publisher()
        await activate(sm, bundle)
        late = await add_user(sm)
        assert await count(sm, LegalNotificationModel) == 8
        async with sm() as session, session.begin():
            await session.execute(update(UserModel).where(UserModel.id == deactivated).values(is_active=False))
        # Simulate broker acceptance followed by an uncertain DB commit: stable replay.
        async with sm() as session:
            assert await svc.publish_pending_notifications(session, publisher) == 8
            first_ids = {(m.notification_id, m.created_at) for m in publisher.messages}
            await session.rollback()
        publisher.messages.clear()

        async def publish():
            async with sm() as session, session.begin():
                return await svc.publish_pending_notifications(session, publisher)
        assert sum(await asyncio.gather(publish(), publish())) == 8
        assert {(m.notification_id, m.created_at) for m in publisher.messages} == first_ids
        assert len({m.notification_id for m in publisher.messages}) == 4
        for message in publisher.messages:
            assert message.data["document_url"].startswith("https://frontend.example.invalid/en/legal/")
            assert set(message.data) == {"document_title", "document_revision", "effective_date", "document_url"}
        async with sm() as session:
            rows = (await session.scalars(select(LegalNotificationModel))).all()
            assert {r.user_id for r in rows} == {english, deactivated}
            assert late not in {r.user_id for r in rows}
            assert sum(r.status == "published" and r.published_at is not None for r in rows) == 4
            assert sum(r.status == "suppressed" and r.published_at is None for r in rows) == 4
        assert await publish() == 0
    db_case(run)


@needs_db
def test_outbox_broker_failure_keeps_pending_jobs_for_restart():
    async def run(sm):
        await add_user(sm)
        bundle, publisher = catalog(sequence=1), Publisher()
        await activate(sm, bundle)
        publisher.fail = True
        async with sm() as session:
            with pytest.raises(RuntimeError, match="fake broker failure"):
                await svc.publish_pending_notifications(session, publisher)
            await session.rollback()
        async with sm() as session:
            assert (await session.scalars(select(LegalNotificationModel.status))).all() == ["pending"] * 4
        publisher.fail = False
        async with sm() as session, session.begin():
            assert await svc.publish_pending_notifications(session, publisher) == 4
    db_case(run)


@needs_db
def test_evidence_survives_account_delete_is_append_only_and_expires_at_approved_cutoff():
    async def run(sm):
        bundle = catalog(sequence=1)
        await activate(sm, bundle)
        current = await policy(sm, bundle)
        async with sm() as session:
            user = await auth(session, bundle, Publisher()).register("new@example.invalid", "newuser", "ValidPassword1",
                                                                   legal_acceptance=accepted(current))
        # Existing normal account deletion is anonymization, not legal evidence deletion.
        async with sm() as session, session.begin():
            await UserRepository(session).anonymize(user.id, "deleted@example.invalid", "deleted", "x")
        assert await count(sm, LegalAcceptanceModel) == 1
        for statement in (
            update(LegalAcceptanceModel).values(user_agent="tampered"), delete(LegalAcceptanceModel),
            update(LegalDocumentSnapshotModel).values(sha256="0" * 64), delete(LegalActivationModel),
        ):
            async with sm() as session:
                with pytest.raises(DBAPIError):
                    await session.execute(statement)
                await session.rollback()
        async with sm() as session, session.begin():
            evidence = await session.scalar(select(LegalAcceptanceModel))
            old = evidence.created_at - timedelta(days=60)
            session.add(LegalAcceptanceModel(user_id=user.id, activation_id=evidence.activation_id,
                document_id=evidence.document_id, revision=evidence.revision, sha256=evidence.sha256,
                action="accept_terms", locale="ru", created_at=old, retain_until=old + timedelta(days=30)))
        async with sm() as session, session.begin():
            assert await svc.purge_expired_legal_evidence(session, datetime.now(timezone.utc)) == 1
        assert await count(sm, LegalAcceptanceModel) == 1
        # Even an administrative hard delete cannot cascade into the independent evidence.
        async with sm() as session, session.begin():
            await session.execute(delete(OneTimeTokenModel).where(OneTimeTokenModel.user_id == user.id))
            await session.execute(delete(SubscriptionModel).where(SubscriptionModel.user_id == user.id))
            await session.execute(delete(UserModel).where(UserModel.id == user.id))
        assert await count(sm, LegalAcceptanceModel) == 1
    db_case(run)
