"""Support: routing, staff replies, delivery, access control and the periodic sweeps.

Database tests need a Postgres at alembic head: set TEST_DATABASE_URL, for example
postgresql+asyncpg://test:test@localhost:55432/support_test. Without it they skip.
"""

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from APP.config import settings
from APP.dependencies import AuthContext, get_current_auth, get_publisher
from APP.entities.user import UserEntity
from APP.exceptions import ConflictError, ErrorCode, InvalidTokenError, ValidationError
from APP.services import support_service as svc
from SPI.db_adapter.models.support import SupportContactModel, SupportMessageModel, SupportTicketModel
from SPI.db_adapter.db import db as app_db

DB_URL = os.environ.get("TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not DB_URL, reason="TEST_DATABASE_URL is not set")

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 32
WEBP = b"RIFF\x24\0\0\0WEBPVP8 " + b"\0" * 32
T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def support_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings.support, "dir", str(tmp_path))
    return tmp_path


def db_run(fn):
    """Runs `fn(sessionmaker)` on a clean support schema in a fresh event loop."""

    async def main():
        engine = create_async_engine(DB_URL)
        async with engine.begin() as conn:
            await conn.execute(text("TRUNCATE support_messages, support_tickets, support_contacts, users CASCADE"))
        try:
            return await fn(async_sessionmaker(engine, expire_on_commit=False))
        finally:
            await engine.dispose()

    return asyncio.run(main())


async def add_user(sm, role="user", name=None) -> uuid.UUID:
    uid = uuid.uuid7()
    name = name or f"u{uid.hex[-8:]}"
    async with sm() as s, s.begin():
        await s.execute(
            text(
                "INSERT INTO users (id, email, username, password_hash, role, is_verified, is_beta_tester,"
                " locale, is_active, created_at, updated_at)"
                " VALUES (:id, :email, :name, 'x', :role, true, false, 'ru', true, now(), now())"
            ),
            {"id": uid, "email": f"{name}@example.com", "name": name, "role": role},
        )
    return uid


async def inbound(sm, user_id, body, now, **kw) -> svc.Routed:
    async with sm() as s, s.begin():
        contact = await svc.web_contact(s, user_id, "someone", "ru")
        return await svc.route_inbound(s, contact, body, now=now, **kw)


async def ticket_rows(sm):
    async with sm() as s:
        return (await s.scalars(select(SupportTicketModel).order_by(SupportTicketModel.number))).all()


# ---------- Images ----------


def test_sniff_image_by_magic_bytes():
    assert svc.sniff_image(PNG).mime == "image/png"
    assert svc.sniff_image(JPEG, "image/jpg").ext == "jpg"
    assert svc.sniff_image(WEBP, "image/webp").mime == "image/webp"
    with pytest.raises(ValidationError) as e:
        svc.sniff_image(b"GIF89a" + b"\0" * 32, "image/gif")
    assert e.value.code == "support_image_invalid"
    with pytest.raises(ValidationError) as e:
        svc.sniff_image(PNG, "image/jpeg")
    assert e.value.code == "support_image_invalid"
    with pytest.raises(ValidationError) as e:
        svc.sniff_image(PNG + b"\0" * svc.MAX_IMAGE_BYTES)
    assert e.value.code == "support_image_too_large" and e.value.extra == {"max_mb": 10}
    assert svc.sniff_image(PNG + b"\0" * (svc.MAX_IMAGE_BYTES - len(PNG))).mime == "image/png"


# ---------- Routing ----------


@needs_db
def test_first_message_opens_ticket_next_appends():
    async def go(sm):
        uid = await add_user(sm)
        a = await inbound(sm, uid, "hello", T0)
        b = await inbound(sm, uid, "anyone?", T0 + timedelta(minutes=5))
        [t] = await ticket_rows(sm)
        return a.new_ticket, b.new_ticket, a.ticket.id == b.ticket.id, t.status, t.unread_count, t.waiting_since, t.last_activity_at

    assert db_run(go) == (True, False, True, "open", 2, T0, T0 + timedelta(minutes=5))


@needs_db
def test_resolved_reopens_within_72h_new_ticket_after():
    async def go(sm):
        uid = await add_user(sm)
        first = await inbound(sm, uid, "q1", T0)
        async with sm() as s, s.begin():
            await s.execute(
                text("UPDATE support_tickets SET status='resolved', resolved_at=:t"), {"t": T0 + timedelta(hours=1)}
            )
        reopened = await inbound(sm, uid, "still broken", T0 + timedelta(hours=72))
        async with sm() as s, s.begin():
            await s.execute(text("UPDATE support_tickets SET status='resolved', resolved_at=:t"), {"t": T0})
        fresh = await inbound(sm, uid, "new issue", T0 + timedelta(hours=72, seconds=1))
        rows = await ticket_rows(sm)
        return (
            reopened.ticket.id == first.ticket.id,
            reopened.new_ticket,
            fresh.new_ticket,
            [(r.status, r.closed_at) for r in rows],
        )

    same, reopened_new, fresh_new, rows = db_run(go)
    assert (same, reopened_new, fresh_new) == (True, False, True)
    assert rows == [("closed", T0 + timedelta(hours=72, seconds=1)), ("open", None)]


@needs_db
def test_concurrent_first_messages_share_one_ticket():
    async def go(sm):
        uid = await add_user(sm)
        async with sm() as s, s.begin():
            await svc.web_contact(s, uid, "someone", "ru")
        sessions = [sm() for _ in range(5)]
        for s in sessions:
            await s.execute(text("SELECT 1"))  # connected and in a transaction before anyone routes

        async def one(s, i):
            contact = await svc.web_contact(s, uid, "someone", "ru")
            routed = await svc.route_inbound(s, contact, f"m{i}", now=T0)
            await s.commit()
            await s.close()
            return routed

        results = await asyncio.gather(*(one(s, i) for i, s in enumerate(sessions)))
        rows = await ticket_rows(sm)
        return sorted(r.new_ticket for r in results), len({r.ticket.id for r in results}), [(r.status, r.unread_count) for r in rows]

    assert db_run(go) == ([False, False, False, False, True], 1, [("open", 5)])


@needs_db
def test_unique_index_refuses_second_open_ticket():
    async def go(sm):
        uid = await add_user(sm)
        first = await inbound(sm, uid, "hi", T0)
        async with sm() as s:
            s.add(SupportTicketModel(contact_id=first.ticket.contact_id, status="open", created_at=T0))
            try:
                await s.commit()
            except Exception as e:  # noqa: BLE001
                return type(e).__name__, "uq_support_tickets_open_contact" in str(e)

    assert db_run(go) == ("IntegrityError", True)


# ---------- Staff replies and delivery ----------


class FakePublisher:
    """Stands in for MQPublisher. Each job records whether its message was already
    committed when it was published, as the bot would see it."""

    def __init__(self, sm=None, fail=False):
        self.sm, self.fail = sm, fail
        self.jobs: list[tuple[uuid.UUID, bool]] = []

    async def publish_telegram(self, message_id):
        committed = None
        if self.sm:
            async with self.sm() as s:
                committed = await s.get(SupportMessageModel, message_id) is not None
        self.jobs.append((message_id, committed))
        if self.fail:
            raise ConnectionError("rabbitmq is down")


async def tg_ticket(sm, now=T0):
    async with sm() as s, s.begin():
        contact = await svc.telegram_contact(s, 5550001, 5550001, "gamer", "Gamer One", "en")
        return (await svc.route_inbound(s, contact, "help", now=now, tg_message_id=10)).ticket.id


async def reply(sm, ticket_id, staff_id, body, *, note=False, publisher=None, image=None, now=T0 + timedelta(hours=1)):
    publisher = publisher or FakePublisher()
    async with sm() as s:
        try:
            msg = await svc.staff_message(
                s, ticket_id, staff_id, body, note=note, image=image, publish=publisher.publish_telegram, now=now
            )
        finally:
            await s.commit()
    async with sm() as s:
        ticket = await s.get(SupportTicketModel, ticket_id)
        return msg, ticket, await s.get(SupportContactModel, ticket.contact_id)


@needs_db
def test_staff_reply_sets_pending_and_assigns_once():
    async def go(sm):
        uid = await add_user(sm)
        staff = await add_user(sm, "support")
        other = await add_user(sm, "admin")
        tid = (await inbound(sm, uid, "hello", T0)).ticket.id
        msg, t, _ = await reply(sm, tid, staff, "on it")
        first = (msg.direction, msg.delivery, t.status, t.waiting_since, t.first_reply_at, t.assignee_id == staff, t.unread_count)
        _, t2, _ = await reply(sm, tid, other, "more", now=T0 + timedelta(hours=2))
        again = await inbound(sm, uid, "thanks, but", T0 + timedelta(hours=3))
        return first, (t2.first_reply_at, t2.assignee_id == staff), (again.ticket.status, again.ticket.waiting_since)

    first, second, back = db_run(go)
    assert first == ("out", "sent", "pending", None, T0 + timedelta(hours=1), True, 0)
    assert second == (T0 + timedelta(hours=1), True)
    assert back == ("open", T0 + timedelta(hours=3))


@needs_db
def test_note_is_never_delivered_and_keeps_status():
    publisher = FakePublisher()

    async def go(sm):
        staff = await add_user(sm, "support")
        tid = await tg_ticket(sm)
        msg, t, _ = await reply(sm, tid, staff, "internal: refund?", note=True, publisher=publisher)
        return msg.direction, msg.delivery, t.status, t.unread_count, t.first_reply_at

    assert db_run(go) == ("note", None, "open", 1, None)
    assert publisher.jobs == []


@needs_db
def test_telegram_reply_is_queued_once_after_commit():
    async def go(sm):
        publisher = FakePublisher(sm)
        staff = await add_user(sm, "support")
        tid = await tg_ticket(sm)
        msg, t, _ = await reply(sm, tid, staff, "try F8", publisher=publisher)
        return publisher.jobs == [(msg.id, True)], msg.delivery, t.status

    assert db_run(go) == (True, None, "pending")


@needs_db
def test_telegram_reply_fails_when_the_queue_is_down():
    async def go(sm):
        staff = await add_user(sm, "support")
        tid = await tg_ticket(sm)
        msg, t, _ = await reply(sm, tid, staff, "try F8", publisher=FakePublisher(fail=True))
        async with sm() as s:
            stored = await s.get(SupportMessageModel, msg.id)
        return stored.delivery, stored.delivery_error, t.status

    assert db_run(go) == ("failed", "delivery queue is unavailable", "pending")


class ReportsThenFails(FakePublisher):
    """The broker took the job and the bot reported it sent, but the publish confirm failed."""

    async def publish_telegram(self, message_id):
        async with self.sm() as s, s.begin():
            await s.execute(text("UPDATE support_messages SET delivery = 'sent' WHERE id = :id"), {"id": message_id})
        raise TimeoutError("publisher confirm timed out")


@needs_db
def test_publish_failure_never_overwrites_a_reported_outcome():
    async def go(sm):
        staff = await add_user(sm, "support")
        tid = await tg_ticket(sm)
        msg, _, _ = await reply(sm, tid, staff, "try F8", publisher=ReportsThenFails(sm))
        async with sm() as s:
            stored = await s.get(SupportMessageModel, msg.id)
        return msg.delivery, stored.delivery, stored.delivery_error

    assert db_run(go) == (None, "sent", None)


@needs_db
def test_web_reply_is_sent_and_never_queued():
    publisher = FakePublisher()

    async def go(sm):
        uid = await add_user(sm)
        staff = await add_user(sm, "support")
        tid = (await inbound(sm, uid, "hello", T0)).ticket.id
        msg, _, _ = await reply(sm, tid, staff, "on it", publisher=publisher)
        return msg.delivery

    assert db_run(go) == "sent"
    assert publisher.jobs == []


@needs_db
def test_reply_to_closed_ticket_is_refused_note_is_not():
    async def go(sm):
        uid = await add_user(sm)
        staff = await add_user(sm, "support")
        tid = (await inbound(sm, uid, "hello", T0)).ticket.id
        async with sm() as s, s.begin():
            await s.execute(text("UPDATE support_tickets SET status='closed'"))
        try:
            await reply(sm, tid, staff, "late")
        except ConflictError as e:
            refused = e.code
        msg, t, _ = await reply(sm, tid, staff, "fyi", note=True)
        return refused, msg.direction, t.status

    assert db_run(go) == ("support_ticket_closed", "note", "closed")


# ---------- Periodic sweeps ----------


@needs_db
def test_periodic_steps_are_idempotent():
    async def go(sm):
        a, b, c = [await add_user(sm) for _ in range(3)]
        ta = (await inbound(sm, a, "a", T0)).ticket.id
        tb = (await inbound(sm, b, "b", T0)).ticket.id
        tc = (await inbound(sm, c, "c", T0)).ticket.id
        now = T0 + timedelta(days=10)
        async with sm() as s, s.begin():
            await s.execute(text("UPDATE support_tickets SET status='resolved', resolved_at=:t WHERE id=:id"), {"t": now - timedelta(hours=73), "id": ta})
            await s.execute(text("UPDATE support_tickets SET status='pending', last_activity_at=:t WHERE id=:id"), {"t": now - timedelta(days=8), "id": tb})
            await s.execute(text("UPDATE support_tickets SET status='pending', last_activity_at=:t WHERE id=:id"), {"t": now - timedelta(days=6), "id": tc})
        counts = []
        for _ in range(2):
            async with sm() as s, s.begin():
                counts.append((await svc.close_stale_resolved(s, now), await svc.resolve_idle_pending(s, now)))
        async with sm() as s:
            rows = {t.id: (t.status, t.resolved_at, t.closed_at) for t in await s.scalars(select(SupportTicketModel))}
        return counts, rows[ta], rows[tb], rows[tc], now

    counts, ra, rb, rc, now = db_run(go)
    assert counts == [(1, 1), (0, 0)]
    assert ra == ("closed", now - timedelta(hours=73), now)
    assert rb == ("resolved", now, None)
    assert rc == ("pending", None, None)


@needs_db
def test_periodic_pass_skips_while_another_worker_holds_the_lock():
    from APP import periodic

    async def go(sm):
        async with sm() as holder, holder.begin():
            await holder.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": periodic.LOCK_KEY})
            blocked = await periodic.run_once(sm, T0)
        free = await periodic.run_once(sm, T0)
        return blocked, free

    assert db_run(go) == (None, {"close_stale_resolved": 0, "resolve_idle_pending": 0, "purge_old_crash_reports": 0})


# ---------- HTTP API ----------


class Api:
    """The real app over ASGI, with the DB pointed at the test database and the caller
    chosen per request (JWT and sessions are covered elsewhere)."""

    def __init__(self, sm):
        from main import app

        self.app, self.sm, self.users = app, sm, {}
        self.as_user: uuid.UUID | None = None

        async def get_db():
            async with sm() as s:
                try:
                    yield s
                    await s.commit()
                except Exception:
                    await s.rollback()
                    raise

        def auth():
            if self.as_user is None:
                raise InvalidTokenError("Authorization header missing", code=ErrorCode.TOKEN_MISSING)
            return AuthContext(user=self.users[self.as_user], session_id=uuid.uuid4())

        self.publisher = FakePublisher(sm)
        app.dependency_overrides[app_db.get_db] = get_db
        app.dependency_overrides[get_current_auth] = auth
        app.dependency_overrides[get_publisher] = lambda: self.publisher
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1")

    async def user(self, role="user") -> uuid.UUID:
        uid = await add_user(self.sm, role)
        self.users[uid] = UserEntity(
            id=uid, email=f"u{uid.hex[-8:]}@example.com", username=f"u{uid.hex[-8:]}", role=role, is_verified=True
        )
        return uid

    async def call(self, who, method, path, **kw) -> httpx.Response:
        self.as_user = who
        return await self.http.request(method, path, **kw)

    async def close(self):
        self.app.dependency_overrides.clear()
        await self.http.aclose()


def api_run(fn):
    async def go(sm):
        api = Api(sm)
        try:
            return await fn(api)
        finally:
            await api.close()

    return db_run(go)


@needs_db
def test_customer_stream_is_own_and_never_has_notes():
    async def go(api: Api):
        alice, bob, staff = await api.user(), await api.user(), await api.user("support")
        r = await api.call(alice, "POST", "/support/messages", data={"body": "my replay is black"})
        assert r.status_code == 201, r.text
        first = r.json()
        await api.call(bob, "POST", "/support/messages", data={"body": "bob here"})
        tickets = (await api.call(staff, "GET", "/admin/support/tickets")).json()
        alice_ticket = next(t for t in tickets["items"] if t["preview"] == "my replay is black")
        tid = alice_ticket["id"]
        await api.call(staff, "POST", f"/admin/support/tickets/{tid}/messages", data={"body": "checking logs", "note": "true"})
        await api.call(staff, "POST", f"/admin/support/tickets/{tid}/messages", data={"body": "update WebView2"})
        stream = (await api.call(alice, "GET", "/support/messages")).json()
        newer = (await api.call(alice, "GET", "/support/messages", params={"after": first["id"]})).json()
        bobs = (await api.call(bob, "GET", "/support/messages")).json()
        anon = await api.call(None, "GET", "/support/messages")
        return alice_ticket, stream, newer, bobs, anon.status_code

    ticket, stream, newer, bobs, anon = api_run(go)
    assert (ticket["status"], ticket["channel"], ticket["unread_count"], ticket["preview_direction"]) == ("open", "web", 1, "in")
    assert [(m["direction"], m["body"]) for m in stream] == [("in", "my replay is black"), ("out", "update WebView2")]
    assert set(stream[0]) == {"id", "direction", "body", "image_url", "created_at"}
    assert [m["body"] for m in newer] == ["update WebView2"]
    assert [m["body"] for m in bobs] == ["bob here"]
    assert anon == 401


@needs_db
def test_staff_api_roles_and_ticket_flow():
    async def go(api: Api):
        user, support, mod = await api.user(), await api.user("support"), await api.user("moderator")
        out = {}
        out["user_list"] = (await api.call(user, "GET", "/admin/support/tickets")).status_code
        out["user_unread"] = (await api.call(user, "GET", "/admin/support/unread")).status_code
        await api.call(user, "POST", "/support/messages", data={"body": "hi"})
        out["unread"] = (await api.call(mod, "GET", "/admin/support/unread")).json()
        tid = (await api.call(support, "GET", "/admin/support/tickets")).json()["items"][0]["id"]
        out["user_detail"] = (await api.call(user, "GET", f"/admin/support/tickets/{tid}")).status_code
        out["read"] = (await api.call(support, "POST", f"/admin/support/tickets/{tid}/read")).status_code
        out["unread_after"] = (await api.call(support, "GET", "/admin/support/unread")).json()
        r = await api.call(support, "PATCH", f"/admin/support/tickets/{tid}", json={"assignee_id": str(user)})
        out["bad_assignee"] = (r.status_code, r.json()["code"])
        r = await api.call(support, "PATCH", f"/admin/support/tickets/{tid}", json={"status": "resolved", "assignee_id": str(mod)})
        out["resolved"] = (r.json()["status"], r.json()["assignee_username"] == api.users[mod].username)
        detail = (await api.call(support, "GET", f"/admin/support/tickets/{tid}")).json()
        out["contact"] = (detail["contact"]["user"]["email"] == api.users[user].email, detail["contact"]["channel"])
        out["assignees"] = sorted(a["id"] for a in detail["assignees"]) == sorted([str(support), str(mod)])
        await api.call(support, "PATCH", f"/admin/support/tickets/{tid}", json={"status": "closed"})
        await api.call(user, "POST", "/support/messages", data={"body": "new problem"})
        r = await api.call(support, "PATCH", f"/admin/support/tickets/{tid}", json={"status": "open"})
        out["reopen_clash"] = (r.status_code, r.json()["code"])
        r = await api.call(support, "POST", f"/admin/support/tickets/{tid}/messages", data={"body": "late"})
        out["reply_closed"] = (r.status_code, r.json()["code"])
        closed = await api.call(support, "GET", "/admin/support/tickets", params={"status": "closed"})
        out["closed_filter"] = [t["status"] for t in closed.json()["items"]]
        out["default_filter"] = [t["preview"] for t in (await api.call(support, "GET", "/admin/support/tickets")).json()["items"]]
        out["missing"] = (await api.call(support, "GET", f"/admin/support/tickets/{uuid.uuid4()}")).json()["code"]
        return out

    assert api_run(go) == {
        "user_list": 403,
        "user_unread": 403,
        "unread": {"tickets": 1},
        "user_detail": 403,
        "read": 204,
        "unread_after": {"tickets": 0},
        "bad_assignee": (422, "support_assignee_invalid"),
        "resolved": ("resolved", True),
        "contact": (True, "web"),
        "assignees": True,
        "reopen_clash": (409, "support_ticket_conflict"),
        "reply_closed": (409, "support_ticket_closed"),
        "closed_filter": ["closed"],
        "default_filter": ["new problem"],
        "missing": "support_ticket_not_found",
    }


@needs_db
def test_images_upload_validation_and_access(support_dir):
    async def go(api: Api):
        alice, bob, staff = await api.user(), await api.user(), await api.user("support")
        r = await api.call(alice, "POST", "/support/messages", data={"body": ""}, files={"image": ("shot.png", PNG, "image/png")})
        assert r.status_code == 201, r.text
        mine = r.json()
        gif = await api.call(alice, "POST", "/support/messages", files={"image": ("a.gif", b"GIF89a" + b"\0" * 40, "image/gif")})
        liar = await api.call(alice, "POST", "/support/messages", files={"image": ("a.jpg", PNG, "image/jpeg")})
        big = await api.call(alice, "POST", "/support/messages", files={"image": ("big.png", PNG + b"\0" * svc.MAX_IMAGE_BYTES, "image/png")})
        empty = await api.call(alice, "POST", "/support/messages", data={"body": "   "})
        long = await api.call(alice, "POST", "/support/messages", data={"body": "x" * 4001})
        tid = (await api.call(staff, "GET", "/admin/support/tickets")).json()["items"][0]["id"]
        note = await api.call(
            staff, "POST", f"/admin/support/tickets/{tid}/messages", data={"note": "true"}, files={"image": ("n.webp", WEBP, "image/webp")}
        )
        note = note.json()
        path = lambda m: m["image_url"].removeprefix("/api/v1")  # noqa: E731
        own = await api.call(alice, "GET", path(mine))
        other = await api.call(bob, "GET", path(mine))
        by_staff = await api.call(staff, "GET", path(mine))
        note_owner = await api.call(alice, "GET", path(note))
        note_staff = await api.call(staff, "GET", path(note))
        return {
            "own": (own.status_code, own.headers["content-type"], own.headers["x-content-type-options"], own.headers["content-disposition"], own.content == PNG),
            "other": (other.status_code, other.json()["code"]),
            "staff": by_staff.status_code,
            "note_owner": note_owner.status_code,
            "note_staff": (note_staff.status_code, note_staff.headers["content-type"]),
            "gif": (gif.status_code, gif.json()["code"]),
            "liar": (liar.status_code, liar.json()["code"]),
            "big": (big.status_code, big.json()["code"]),
            "empty": (empty.status_code, empty.json()["code"]),
            "long": (long.status_code, long.json()["code"]),
            "body": mine["body"],
        }

    assert api_run(go) == {
        "own": (200, "image/png", "nosniff", "inline", True),
        "other": (404, "support_image_not_found"),
        "staff": 200,
        "note_owner": 404,
        "note_staff": (200, "image/webp"),
        "gif": (422, "support_image_invalid"),
        "liar": (422, "support_image_invalid"),
        "big": (422, "support_image_too_large"),
        "empty": (422, "support_empty_message"),
        "long": (422, "validation_failed"),
        "body": "",
    }
    assert sorted(p.suffix for p in support_dir.rglob("*") if p.is_file()) == [".png", ".webp"]


# ---------- Internal API for the bot service ----------

TOKEN = "internal-s3cret"
IVAN = {"tg_user_id": "4242", "tg_chat_id": "4242", "username": "ivan_cs", "display_name": "Ivan", "locale": "ru"}


def internal_run(fn, monkeypatch, token=TOKEN):
    """`fn(api, bot)`: `bot(method, path, **kw)` calls /internal/support/telegram as the
    bot service does, with the right X-Internal-Token unless `headers` says otherwise."""
    monkeypatch.setattr(settings, "internal_api_token", token)

    async def go(api: Api):
        async def bot(method, path, headers=None, **kw):
            headers = {"X-Internal-Token": TOKEN} if headers is None else headers
            return await api.http.request(method, f"http://test/internal/support/telegram{path}", headers=headers, **kw)

        return await fn(api, bot)

    return api_run(go)


@needs_db
def test_internal_api_404_unconfigured_401_on_bad_token(monkeypatch):
    async def go(api, bot):
        return (await bot("POST", "/contact", data=IVAN)).status_code

    assert internal_run(go, monkeypatch, token="") == 404

    async def go2(api, bot):
        return [
            (await bot("POST", "/contact", data=IVAN, headers={"X-Internal-Token": "wrong"})).status_code,
            (await bot("POST", "/contact", data=IVAN, headers={})).status_code,
            (await bot("GET", f"/outbox/{uuid.uuid4()}", headers={})).status_code,
            (await bot("POST", "/contact", data=IVAN)).status_code,
            (await api.http.post("http://test/api/v1/internal/support/telegram/contact", data=IVAN)).status_code,
        ]

    assert internal_run(go2, monkeypatch) == [401, 401, 401, 204, 404]


@needs_db
def test_internal_inbound_routes_text_image_duplicates_and_edits(monkeypatch):
    async def go(api: Api, bot):
        staff = await api.user("support")
        start = await bot("POST", "/contact", data=IVAN)
        after_start = (await api.call(staff, "GET", "/admin/support/tickets")).json()["total"]
        first = await bot("POST", "/messages", data={**IVAN, "tg_message_id": "11", "text": " F8 does nothing "})
        again = await bot("POST", "/messages", data={**IVAN, "tg_message_id": "11", "text": "F8 does nothing"})
        photo = await bot(
            "POST", "/messages", data={**IVAN, "tg_message_id": "12", "text": "screen"}, files={"image": ("photo.jpg", JPEG, "image/jpeg")}
        )
        gif = await bot("POST", "/messages", data={**IVAN, "tg_message_id": "13"}, files={"image": ("a.gif", b"GIF89a" + b"\0" * 40, "image/gif")})
        big = await bot(
            "POST", "/messages", data={**IVAN, "tg_message_id": "14"}, files={"image": ("b.png", PNG + b"\0" * svc.MAX_IMAGE_BYTES, "image/png")}
        )
        empty = await bot("POST", "/messages", data={**IVAN, "tg_message_id": "15", "text": "  "})
        edit = await bot("POST", "/edits", data={**IVAN, "tg_message_id": "11", "text": "F8 and F7 do nothing"})
        stray = await bot("POST", "/edits", data={**IVAN, "tg_message_id": "999", "text": "never stored"})
        tickets = (await api.call(staff, "GET", "/admin/support/tickets")).json()["items"]
        detail = (await api.call(staff, "GET", f"/admin/support/tickets/{tickets[0]['id']}")).json()
        image = await api.call(staff, "GET", detail["messages"][1]["image_url"].removeprefix("/api/v1"))
        return {
            "start": (start.status_code, after_start),
            "first": first.json(),
            "again": again.json(),
            "photo": photo.json(),
            "gif": (gif.status_code, gif.json()["code"]),
            "big": (big.status_code, big.json()["code"]),
            "empty": (empty.status_code, empty.json()["code"]),
            "edits": (edit.status_code, stray.status_code),
            "tickets": [(t["channel"], t["contact_name"], t["tg_username"], t["unread_count"]) for t in tickets],
            "msgs": [(m["body"], bool(m["image_url"]), m["edited_at"] is not None) for m in detail["messages"]],
            "contact": (detail["contact"]["tg_user_id"], detail["contact"]["locale"], detail["contact"]["user"]),
            "image": (image.status_code, image.headers["content-type"], image.content == JPEG),
        }

    assert internal_run(go, monkeypatch) == {
        "start": (204, 0),
        "first": {"new_ticket": True},
        "again": {"new_ticket": False},
        "photo": {"new_ticket": False},
        "gif": (422, "support_image_invalid"),
        "big": (422, "support_image_too_large"),
        "empty": (422, "support_empty_message"),
        "edits": (204, 204),
        "tickets": [("telegram", "Ivan", "ivan_cs", 2)],
        "msgs": [("F8 and F7 do nothing", False, True), ("screen", True, False)],
        "contact": (4242, "ru", None),
        "image": (200, "image/jpeg", True),
    }


@needs_db
def test_internal_contact_touch_clears_blocked(monkeypatch):
    async def go(api: Api, bot):
        await bot("POST", "/messages", data={**IVAN, "tg_message_id": "20", "text": "hello"})
        async with api.sm() as s, s.begin():
            await s.execute(text("UPDATE support_contacts SET blocked_at = now()"))
        await bot("POST", "/contact", data=IVAN)  # /start after unblocking
        async with api.sm() as s:
            return await s.scalar(text("SELECT blocked_at FROM support_contacts"))

    assert internal_run(go, monkeypatch) is None


@needs_db
def test_staff_reply_flows_through_the_outbox_once(monkeypatch):
    async def go(api: Api, bot):
        staff = await api.user("support")
        await bot("POST", "/messages", data={**IVAN, "tg_message_id": "30", "text": "help"})
        tid = (await api.call(staff, "GET", "/admin/support/tickets")).json()["items"][0]["id"]
        note = await api.call(staff, "POST", f"/admin/support/tickets/{tid}/messages", data={"body": "internal", "note": "true"})
        reply = await api.call(
            staff, "POST", f"/admin/support/tickets/{tid}/messages", data={"body": "see this"}, files={"image": ("s.png", PNG, "image/png")}
        )
        mid = reply.json()["id"]
        jobs = [(str(m), committed) for m, committed in api.publisher.jobs]
        item = (await bot("GET", f"/outbox/{mid}")).json()
        image = await bot("GET", f"/outbox/{mid}/image")
        note_item = (await bot("GET", f"/outbox/{note.json()['id']}")).status_code
        report = await bot("POST", f"/outbox/{mid}/delivery", json={"sent": True, "tg_message_id": 77})
        # A redelivered job: the outbox refuses it and a second report cannot rewrite the first.
        replay_get = await bot("GET", f"/outbox/{mid}")
        replay_report = await bot("POST", f"/outbox/{mid}/delivery", json={"sent": False, "error": "late"})
        detail = (await api.call(staff, "GET", f"/admin/support/tickets/{tid}")).json()
        [out] = [m for m in detail["messages"] if m["direction"] == "out"]
        return {
            "jobs": jobs == [(mid, True)],
            "sending": reply.json()["delivery"],
            "item": item,
            "image": (image.status_code, image.content == PNG),
            "note": note_item,
            "report": report.status_code,
            "replay": [(r.status_code, r.json()["code"]) for r in (replay_get, replay_report)],
            "out": (out["delivery"], out["delivery_error"]),
            "missing": (await bot("GET", f"/outbox/{uuid.uuid4()}")).json()["code"],
        }

    assert internal_run(go, monkeypatch) == {
        "jobs": True,
        "sending": None,
        "item": {"chat_id": 4242, "body": "see this", "image_mime": "image/png"},
        "image": (200, True),
        "note": 404,
        "report": 204,
        "replay": [(409, "support_reply_settled"), (409, "support_reply_settled")],
        "out": ("sent", None),
        "missing": "support_reply_not_found",
    }


@needs_db
def test_delivery_report_blocked_marks_contact_and_message(monkeypatch):
    async def go(api: Api, bot):
        staff = await api.user("support")
        await bot("POST", "/messages", data={**IVAN, "tg_message_id": "40", "text": "help"})
        tid = (await api.call(staff, "GET", "/admin/support/tickets")).json()["items"][0]["id"]
        mid = (await api.call(staff, "POST", f"/admin/support/tickets/{tid}/messages", data={"body": "hello?"})).json()["id"]
        r = await bot(
            "POST", f"/outbox/{mid}/delivery", json={"sent": False, "error": "Forbidden: bot was blocked by the user", "blocked": True}
        )
        detail = (await api.call(staff, "GET", f"/admin/support/tickets/{tid}")).json()
        [out] = [m for m in detail["messages"] if m["direction"] == "out"]
        return r.status_code, out["delivery"], out["delivery_error"], detail["contact"]["blocked_at"] is not None, detail["ticket"]["status"]

    assert internal_run(go, monkeypatch) == (204, "failed", "Forbidden: bot was blocked by the user", True, "pending")
