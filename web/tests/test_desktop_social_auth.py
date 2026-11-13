"""Parent-run desktop handoff regressions; isolated PostgreSQL, no live providers."""
import asyncio
import hashlib
import secrets
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import Response
from sqlalchemy import func, select

from API.views.auth.schemas import UserResponse
from API.views.social.views import (FlowRequest, callback, desktop_approve, flow)
from APP.constants import Locale
from APP.exceptions import PermissionDeniedError
from APP.services.auth_service import AuthService
from APP.services.social_service import utcnow
from SPI.db_adapter.models.session import SessionModel
from SPI.db_adapter.models.social import DesktopSocialHandoffModel
from test_social_auth import (BROWSER, auth_database, configured, complete,
                              signup, social, start)  # noqa: F401


def proof():
    verifier = secrets.token_hex(32)
    return verifier, hashlib.sha256(verifier.encode()).hexdigest()


async def begin(sm, provider='faceit', verifier=None):
    verifier, challenge = proof() if verifier is None else (verifier, hashlib.sha256(verifier.encode()).hexdigest())
    async with sm() as session:
        result = await social(session).desktop_start(provider, challenge)
    assert result['expires_in'] == 600
    url = urlsplit(result['authorization_url'])
    assert url.scheme == 'https' and url.netloc == 'watchdemo.test'
    ticket = parse_qs(url.query)['ticket'][0]
    assert verifier not in result['authorization_url'] and challenge not in result['authorization_url']
    return verifier, challenge, ticket


async def launch(sm, ticket):
    async with sm() as session:
        return await social(session).desktop_launch(ticket, BROWSER)


async def poll(sm, verifier):
    async with sm() as session:
        return await social(session).desktop_poll(verifier, 'WatchDemo desktop', '127.0.0.1')


async def approve(sm, state, browser=BROWSER):
    async with sm() as session:
        await social(session).desktop_approve(state, browser)


def test_desktop_new_identity_requires_onboarding_and_explicit_approval(auth_database, configured):
    async def run(sm):
        verifier, challenge, ticket = await begin(sm)
        assert await poll(sm, verifier) == {'status': 'pending'}
        async with sm() as session:
            row = await session.scalar(select(DesktopSocialHandoffModel))
            assert row.challenge_hash == AuthService._hash_token(challenge)
            assert row.launch_hash == AuthService._hash_token(ticket)
            assert verifier not in (row.challenge_hash, row.launch_hash)
        state, url = await launch(sm, ticket)
        assert parse_qs(urlsplit(url).query)['redirect_popup'] == ['true']
        with pytest.raises(PermissionDeniedError):
            await launch(sm, ticket)
        assert await complete(sm, state) == 'pending_registration'
        with pytest.raises(PermissionDeniedError):
            await approve(sm, state)
        assert await poll(sm, verifier) == {'status': 'pending'}
        async with sm() as session:
            svc = social(session)
            await svc.register(state, BROWSER, 'desktop-user', Locale.EN)
            status = await svc.status(state, BROWSER)
            assert status['destination'] == 'desktop'
            assert status['flow_id'] == AuthService._hash_token(state)
            assert await session.scalar(select(func.count()).select_from(SessionModel)) == 0
        # Neither callback nor registration authorizes token retrieval.
        assert await poll(sm, verifier) == {'status': 'pending'}
        async with sm() as session:
            with pytest.raises(PermissionDeniedError):
                await social(session).finish(state, BROWSER, None, None)
        with pytest.raises(PermissionDeniedError):
            await approve(sm, state, 'another-browser')
        await approve(sm, state)
        with pytest.raises(PermissionDeniedError):
            await approve(sm, state)
        result = await poll(sm, verifier)
        assert set(result) == {'status', 'access_token', 'refresh_token'}
        assert result['status'] == 'complete' and result['access_token'] and result['refresh_token']
        with pytest.raises(PermissionDeniedError):
            await poll(sm, verifier)
        async with sm() as session:
            assert await session.scalar(select(func.count()).select_from(SessionModel)) == 1
    auth_database(run)


def test_desktop_existing_identity_concurrent_poll_is_single_use(auth_database, configured):
    async def run(sm):
        await signup(sm)
        verifier, _, ticket = await begin(sm)
        state, _ = await launch(sm, ticket)
        assert await complete(sm, state) == 'login_ready'
        assert await poll(sm, verifier) == {'status': 'pending'}
        await approve(sm, state)
        results = await asyncio.gather(poll(sm, verifier), poll(sm, verifier), return_exceptions=True)
        assert sum(isinstance(r, dict) and r['status'] == 'complete' for r in results) == 1
        assert sum(isinstance(r, PermissionDeniedError) for r in results) == 1
        async with sm() as session:
            assert await session.scalar(select(func.count()).select_from(SessionModel)) == 2
    auth_database(run)


def test_desktop_wrong_verifier_duplicate_challenge_and_expiry(auth_database, configured):
    async def expire(sm, challenge):
        async with sm() as session:
            row = await social(session).repo.desktop_challenge(AuthService._hash_token(challenge))
            row.expires_at = utcnow() - timedelta(seconds=1)
            await session.commit()

    async def run(sm):
        verifier, challenge, ticket = await begin(sm)
        with pytest.raises(PermissionDeniedError):
            await begin(sm, verifier=verifier)
        for wrong in (proof()[0], '', 'A' * 64, 'short'):
            with pytest.raises(PermissionDeniedError):
                await poll(sm, wrong)
        assert await poll(sm, verifier) == {'status': 'pending'}
        await expire(sm, challenge)
        with pytest.raises(PermissionDeniedError):
            await launch(sm, ticket)
        with pytest.raises(PermissionDeniedError):
            await poll(sm, verifier)
        verifier, challenge, ticket = await begin(sm)
        state, _ = await launch(sm, ticket)
        await complete(sm, state)
        async with sm() as session:
            await social(session).register(state, BROWSER, 'expired-desktop', Locale.EN)
        await approve(sm, state)
        await expire(sm, challenge)
        with pytest.raises(PermissionDeniedError):
            await poll(sm, verifier)
    auth_database(run)


def test_website_cannot_be_approved_as_desktop_and_nullable_profile_compatible(auth_database, configured):
    async def run(sm):
        state, url = await start(sm)
        assert parse_qs(urlsplit(url).query)['redirect_popup'] == ['true']
        await complete(sm, state)
        async with sm() as session:
            svc = social(session)
            await svc.register(state, BROWSER, 'website-user', Locale.EN)
            assert (await svc.status(state, BROWSER))['destination'] == 'website'
        with pytest.raises(PermissionDeniedError):
            await approve(sm, state)
        async with sm() as session:
            result = await social(session).finish(state, BROWSER, None, None)
            profile = UserResponse.model_validate(result.user, from_attributes=True)
            assert profile.email is None and profile.has_password is False
            assert profile.model_dump(mode='json')['email'] is None
    auth_database(run)


def test_steam_desktop_reuses_browser_bound_openid_flow(auth_database, configured):
    class Steam:
        async def steam(self, params, expected_return_to):
            assert parse_qs(urlsplit(expected_return_to).query)['state'] == [state]
            return '76561198000000000', utcnow().strftime('%Y-%m-%dT%H:%M:%SZ') + secrets.token_hex(8)

    async def run(sm):
        nonlocal state
        verifier, _, ticket = await begin(sm, 'steam')
        state, url = await launch(sm, ticket)
        assert urlsplit(url).netloc == 'steamcommunity.com'
        async with sm() as session:
            with pytest.raises(PermissionDeniedError):
                await social(session, Steam()).callback('steam', state, 'wrong-browser', {})
        async with sm() as session:
            await social(session, Steam()).callback('steam', state, BROWSER, {})
        async with sm() as session:
            await social(session).register(state, BROWSER, 'steam-desktop', Locale.EN)
        await approve(sm, state)
        assert (await poll(sm, verifier))['status'] == 'complete'
    state = None
    auth_database(run)


def test_browser_flow_id_rejects_stale_tabs_and_callback_mixup():
    request = SimpleNamespace(cookies={'social_flow': 'current-state', 'social_browser': BROWSER})
    with pytest.raises(PermissionDeniedError):
        flow(request, AuthService._hash_token('other-state'))
    assert flow(request, AuthService._hash_token('current-state')) == ('current-state', BROWSER)

    class Service:
        calls = 0

        async def callback(self, *args):
            self.calls += 1

    from starlette.datastructures import QueryParams
    service = Service()
    request.query_params = QueryParams('state=other-state&code=provider-code')
    response = asyncio.run(callback('faceit', request, service))
    assert response.status_code == 303 and response.headers['location'].endswith('?failed=1')
    assert service.calls == 0


def test_browser_approval_response_has_no_tokens_or_website_session_cookie(configured):
    from APP.config import settings

    class Service:
        async def desktop_approve(self, state, browser):
            assert state == 'state' and browser == BROWSER

    request = SimpleNamespace(cookies={'social_flow': 'state', 'social_browser': BROWSER},
                              headers={'origin': settings.app.frontend_url.rstrip('/')})
    response = Response()
    result = asyncio.run(desktop_approve(FlowRequest(flow_id=AuthService._hash_token('state')),
                                        request, response, Service()))
    assert result == {'status': 'approved'}
    assert response.headers['Cache-Control'] == 'no-store'
    assert 'refresh' not in response.headers.get('set-cookie', '')
