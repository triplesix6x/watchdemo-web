"""Coordinator-only checks. DB case owns a random schema in disposable QA DB."""
import asyncio
import os
import uuid

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from qa_safety import require_disposable_database
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from API.views.maintenance.views import admin_router, public_router
from APP.constants import UserRole
from APP.dependencies import AuthContext, get_audit, get_current_auth
from APP.entities.user import UserEntity
from APP.exceptions import AppException
from APP.maintenance_contract import MaintenanceNoticeSettings
from SPI.db_adapter.db import db as app_db
from SPI.db_adapter.models.audit_log import AuditLogModel
from SPI.db_adapter.models.maintenance_notice import MaintenanceNoticeModel

DB_URL = os.environ.get("TEST_DATABASE_URL")


def test_disabled_blank_draft_and_normalization():
    assert MaintenanceNoticeSettings().model_dump() == {"enabled": False, "text_ru": "", "text_en": ""}
    notice = MaintenanceNoticeSettings(enabled=True, text_ru="  Технические работы\r\nВход доступен.  ")
    assert notice.text_ru == "Технические работы\nВход доступен."
    assert notice.text_en == ""
    assert len(MaintenanceNoticeSettings(enabled=True, text_ru="я" * 500).text_ru) == 500
    assert len(MaintenanceNoticeSettings(text_en="😀" * 500).text_en) == 500


@pytest.mark.parametrize("body", [
    {"enabled": True}, {"enabled": True, "text_ru": " \n\t "},
    {"text_ru": "я" * 501}, {"text_en": "x" * 501}, {"text_ru": "😀" * 501},
    {"text_ru": "<script>alert(1)</script>"}, {"text_en": "**bold**"},
    {"text_ru": "[link](https://example.com)"}, {"text_ru": "example.com"},
    {"text_ru": "https://example.com"}, {"text_en": "www.example.com"},
    {"text_en": "# Heading"}, {"text_ru": "- Markdown list"},
    {"text_ru": "`code`"}, {"text_en": "bad\x00text"}, {"unexpected": "field"},
])
def test_text_constraints(body):
    with pytest.raises(ValidationError):
        MaintenanceNoticeSettings(**body)


def actor(role: UserRole) -> AuthContext:
    return AuthContext(UserEntity(
        id=uuid.uuid4(), email="synthetic@example.test", username="synthetic",
        role=role, is_verified=True,
    ), uuid.uuid4())


@pytest.mark.skipif(not DB_URL, reason="TEST_DATABASE_URL is not set")
def test_public_admin_permissions_audit_persistence_and_atomic_rollback():
    require_disposable_database(DB_URL)

    async def scenario():
        schema = "qa_maintenance_" + uuid.uuid4().hex
        engine = create_async_engine(DB_URL)
        try:
            async with engine.begin() as connection:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                scoped = await connection.execution_options(schema_translate_map={None: schema})
                await scoped.run_sync(MaintenanceNoticeModel.__table__.create)
                await scoped.run_sync(AuditLogModel.__table__.create)
            scoped_engine = engine.execution_options(schema_translate_map={None: schema})
            sessions = async_sessionmaker(scoped_engine, expire_on_commit=False)
            app = FastAPI()
            app.include_router(public_router, prefix="/api/v1")
            app.include_router(admin_router, prefix="/api/v1")

            @app.exception_handler(AppException)
            async def app_error(_request, error):
                return JSONResponse(status_code=error.status, content={"message": error.message, "code": error.code})

            async def get_db():
                async with sessions() as session, session.begin():
                    yield session

            current = None

            async def auth():
                if current is None:
                    raise HTTPException(401, "Not authenticated")
                return current

            app.dependency_overrides[app_db.get_db] = get_db
            app.dependency_overrides[get_current_auth] = auth
            transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                public = "/api/v1/maintenance-notice"
                admin = "/api/v1/admin/maintenance-notice"
                response = await client.get(public)
                assert response.status_code == 200
                assert response.json() == {"enabled": False, "text": ""}
                assert response.headers["cache-control"] == "no-store"
                assert (await client.get(admin)).status_code == 401
                assert (await client.patch(admin, json={})).status_code == 401
                payload = {"enabled": True, "text_ru": "Технические работы\nСайт доступен.", "text_en": ""}
                for role in (UserRole.USER, UserRole.SUPPORT, UserRole.MODERATOR):
                    current = actor(role)
                    assert (await client.get(admin)).status_code == 403
                    assert (await client.patch(admin, json=payload)).status_code == 403
                current = actor(UserRole.ADMIN)
                assert (await client.patch(admin, json={"enabled": True, "text_ru": " "})).status_code == 422
                assert (await client.patch(admin, json=payload)).json() == payload
                assert (await client.get(admin)).json() == payload
                assert (await client.get(public + "?locale=en")).json() == {"enabled": True, "text": payload["text_ru"]}
                assert (await client.get(public + "?locale=ru")).json() == {"enabled": True, "text": payload["text_ru"]}
                assert (await client.get(public + "?locale=de")).status_code == 422
                async with sessions() as session:
                    assert await session.scalar(select(func.count()).select_from(MaintenanceNoticeModel)) == 1
                    logs = (await session.scalars(select(AuditLogModel))).all()
                    assert len(logs) == 1
                    assert logs[0].actor_id == current.user.id
                    assert logs[0].action == "update_maintenance_notice"
                    assert logs[0].details == {"enabled": True, "text_ru_length": len(payload["text_ru"]), "text_en_length": 0}

                payload["text_en"] = "Maintenance. The site is available."
                assert (await client.patch(admin, json=payload)).status_code == 200
                assert (await client.get(public + "?locale=en")).json()["text"] == payload["text_en"]

                async def failing_audit_dependency():
                    async def fail(*_args, **_kwargs):
                        raise RuntimeError("Synthetic audit failure")
                    return fail

                app.dependency_overrides[get_audit] = failing_audit_dependency
                assert (await client.patch(admin, json={"enabled": False, "text_ru": "", "text_en": ""})).status_code == 500
                assert (await client.get(admin)).json() == payload, "failed audit must roll back notice mutation"
                del app.dependency_overrides[get_audit]
                assert (await client.patch(admin, json={"enabled": False, "text_ru": "", "text_en": ""})).status_code == 200
                current = None
                assert (await client.get(public)).json() == {"enabled": False, "text": ""}
                async with sessions() as session:
                    assert await session.scalar(select(func.count()).select_from(MaintenanceNoticeModel)) == 1
                    assert await session.scalar(select(func.count()).select_from(AuditLogModel)) == 3
        finally:
            async with engine.begin() as connection:
                await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()

    asyncio.run(scenario())
