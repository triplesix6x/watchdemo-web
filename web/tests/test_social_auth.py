"""Parent-run protocol and real-service PostgreSQL tests (no live providers).

Database tests reuse the existing guarded random-schema fixture. Only provider
HTTP, mail, lockout and session-cache boundaries are faked; repositories and
account/session/subscription writes are real. Workers must not run this file.
"""
import asyncio
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from sqlalchemy import func, select

from APP.config import SocialConfig, settings
from APP.constants import Locale
from APP.exceptions import AlreadyExistsError, InvalidCredentialsError, PermissionDeniedError, ValidationError
from APP.services.auth_service import AuthService
from APP.services.social_service import OPENID_NS, STEAM_ENDPOINT, ProviderClient, SocialService, utcnow
from SPI.db_adapter.models.social import SocialIdentityModel, SocialTransactionModel
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.models.user import UserModel
from SPI.db_adapter.repositories.social_repo import SocialRepository
from test_auth_token_concurrency import auth_database, service as auth_service  # noqa: F401

BROWSER = 'browser-secret-not-provider-state'
PASSWORD = 'OriginalPassword123'


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, 'social', SocialConfig(api_origin='https://watchdemo.test',
        steam_enabled=True, faceit_client_id='test-id', faceit_client_secret='test-secret',
        faceit_authorize_url='https://accounts.faceit.com',
        faceit_token_url='https://api.faceit.com/auth/v1/oauth/token',
        faceit_userinfo_url='https://api.faceit.com/auth/v1/resources/userinfo'))


class Provider:
    def __init__(self, subject='stable-subject'):
        self.subject = subject
        self.calls = 0

    async def faceit(self, code, verifier, callback):
        self.calls += 1
        assert code and len(verifier) >= 43
        assert callback == 'https://watchdemo.test/api/v1/auth/social/faceit/callback'
        return self.subject


class Lockout:
    async def is_locked(self, key):
        return False, 0

    async def reset(self, key):
        pass

    async def record_failure(self, key):
        return 1, False


def social(session, provider=None):
    auth = auth_service(session)
    auth._lockout = Lockout()
    return SocialService(SocialRepository(session), auth, provider or Provider())


async def start(sm, provider=None, intent='login', auth=None):
    async with sm() as session:
        return await social(session, provider).start('faceit', intent, BROWSER, auth)


async def complete(sm, state, provider=None, **params):
    async with sm() as session:
        return await social(session, provider).callback('faceit', state, BROWSER, params or {'code': 'code'})


async def signup(sm, username='social-user', subject='stable-subject'):
    provider = Provider(subject)
    state, _ = await start(sm, provider)
    assert await complete(sm, state, provider) == 'pending_registration'
    async with sm() as session:
        await social(session).register(state, BROWSER, username, Locale.EN)
    async with sm() as session:
        result = await social(session).finish(state, BROWSER, 'Browser', '127.0.0.1')
        return SimpleNamespace(user=result.user, session_id=result.session_id)


def test_steam_verified_endpoint_signature_return_to_and_nonce(monkeypatch, configured):
    callback = 'https://watchdemo.test/api/v1/auth/social/steam/callback?state=bound-state'
    nonce = utcnow().strftime('%Y-%m-%dT%H:%M:%SZ') + 'random-nonce'
    params = {'openid.ns': OPENID_NS, 'openid.mode': 'id_res', 'openid.op_endpoint': STEAM_ENDPOINT,
        'openid.return_to': callback, 'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000000',
        'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000000',
        'openid.response_nonce': nonce, 'openid.assoc_handle': 'association', 'openid.sig': 'signature',
        'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle'}
    requests = []

    def handler(request):
        requests.append(request)
        assert str(request.url) == STEAM_ENDPOINT
        assert parse_qs(request.content.decode())['openid.mode'] == ['check_authentication']
        return httpx.Response(200, text=f'ns:{OPENID_NS}\nis_valid:true\n')

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))

    async def scenario():
        client = ProviderClient()
        assert await client.steam(params, callback) == ('76561198000000000', nonce)
        for mutation in ({'openid.op_endpoint': 'https://evil.invalid'}, {'openid.return_to': callback + 'x'},
                         {'openid.claimed_id': 'https://evil.invalid/id/76561198000000000'},
                         {'openid.signed': 'identity'}, {'openid.response_nonce': 'invalid'},
                         {'openid.response_nonce': (utcnow() - timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ') + 'old'}):
            with pytest.raises(PermissionDeniedError):
                await client.steam(params | mutation, callback)
        assert len(requests) == 1
    asyncio.run(scenario())


def test_faceit_uses_configured_endpoints_pkce_and_stable_subject(monkeypatch, configured):
    requests = []

    def handler(request):
        requests.append(request)
        if request.method == 'POST':
            assert str(request.url) == settings.social.faceit_token_url
            body = parse_qs(request.content.decode())
            assert request.headers['authorization'] == 'Basic dGVzdC1pZDp0ZXN0LXNlY3JldA=='
            assert 'client_secret' not in body
            assert body['code_verifier'] == ['verifier']
            assert body['redirect_uri'] == ['https://watchdemo.test/api/v1/auth/social/faceit/callback']
            return httpx.Response(200, json={'access_token': 'provider-secret', 'userinfo_url': 'https://evil.invalid'})
        assert str(request.url) == settings.social.faceit_userinfo_url
        assert request.headers['authorization'] == 'Bearer provider-secret'
        return httpx.Response(200, json={'sub': 'stable-id', 'nickname': 'mutable'})

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    assert asyncio.run(ProviderClient().faceit('code', 'verifier',
        'https://watchdemo.test/api/v1/auth/social/faceit/callback')) == 'stable-id'
    assert len(requests) == 2
    with pytest.raises(ValueError):
        SocialConfig(faceit_token_url='https://evil.invalid/token')


def test_pending_registration_browser_state_replay_and_original_password_flow(auth_database, configured):
    async def run(sm):
        provider = Provider()
        state, url = await start(sm, provider)
        query = parse_qs(urlsplit(url).query)
        assert query['state'] == [state] and query['code_challenge_method'] == ['S256']
        assert query['redirect_uri'] == ['https://watchdemo.test/api/v1/auth/social/faceit/callback']
        async with sm() as session:
            svc = social(session, provider)
            for wrong_state, browser in ((state, 'other-browser'), ('wrong-state', BROWSER)):
                with pytest.raises(PermissionDeniedError):
                    await svc.callback('faceit', wrong_state, browser, {'code': 'code'})
            await session.rollback()
        assert provider.calls == 0
        assert await complete(sm, state, provider) == 'pending_registration'
        with pytest.raises(PermissionDeniedError):
            await complete(sm, state, provider)
        assert provider.calls == 1
        async with sm() as session:
            assert await session.scalar(select(func.count()).select_from(UserModel)) == 0
            assert await session.scalar(select(func.count()).select_from(SubscriptionModel)) == 0
            with pytest.raises(PermissionDeniedError):
                await social(session).finish(state, BROWSER, None, None)
        async with sm() as session:
            await social(session).register(state, BROWSER, 'social-user', Locale.EN)
        async with sm() as session:
            svc = social(session)
            result = await svc.finish(state, BROWSER, None, None)
            assert result.user.email is None and not result.user.has_password
            assert await session.scalar(select(func.count()).select_from(SubscriptionModel)) == 1
            with pytest.raises(InvalidCredentialsError):
                await svc.auth.login('social-user', PASSWORD, None, None)
        with pytest.raises(PermissionDeniedError):
            async with sm() as session:
                await social(session).finish(state, BROWSER, None, None)
        # Password registration still records no new legal evidence or fake identity.
        async with sm() as session:
            svc = social(session)
            user = await svc.auth.register('password@example.invalid', 'password-user', PASSWORD)
            await svc.auth._user_repo.update_email(user.id, user.email)
            await session.commit()
            result = await svc.auth.login('password-user', PASSWORD, 'Windows', '127.0.0.1')
            await session.commit()
            assert result.user.has_password and result.access_token and result.refresh_token
    auth_database(run)


def test_denial_network_failure_and_expiry_spend_transactions(auth_database, configured):
    class Failing(Provider):
        async def faceit(self, *args):
            raise httpx.ReadTimeout('contains secret provider code')

    async def run(sm):
        for params, provider in (({'error': 'access_denied'}, Provider()), ({'code': 'code'}, Failing())):
            state, _ = await start(sm, provider)
            with pytest.raises(PermissionDeniedError) as error:
                await complete(sm, state, provider, **params)
            assert 'secret' not in str(error.value)
            with pytest.raises(PermissionDeniedError):
                await complete(sm, state, Provider())
        state, _ = await start(sm)
        async with sm() as session:
            tx = await SocialRepository(session).transaction(AuthService._hash_token(state))
            tx.expires_at = utcnow() - timedelta(seconds=1)
            await session.commit()
        with pytest.raises(PermissionDeniedError):
            await complete(sm, state)
    auth_database(run)


def test_concurrent_username_identity_constraints_and_disabled_account(auth_database, configured):
    async def register_one(sm, state, name):
        async with sm() as session:
            await social(session).register(state, BROWSER, name, Locale.RU)
            return True

    async def run(sm):
        states = []
        for subject in ('first', 'second'):
            state, _ = await start(sm, Provider(subject))
            await complete(sm, state, Provider(subject))
            states.append(state)
        results = await asyncio.gather(*(register_one(sm, state, 'same-name') for state in states), return_exceptions=True)
        assert sum(r is True for r in results) == 1
        assert sum(isinstance(r, AlreadyExistsError) for r in results) == 1
        loser = states[next(i for i, r in enumerate(results) if isinstance(r, Exception))]
        await register_one(sm, loser, 'different-name')
        # Same identity with two pending transactions races at a DB unique constraint.
        duplicates = []
        for _ in range(2):
            state, _ = await start(sm, Provider('duplicate'))
            await complete(sm, state, Provider('duplicate'))
            duplicates.append(state)
        results = await asyncio.gather(*(register_one(sm, state, f'identity-{i}') for i, state in enumerate(duplicates)), return_exceptions=True)
        assert sum(r is True for r in results) == 1
        assert sum(isinstance(r, AlreadyExistsError) for r in results) == 1
        async with sm() as session:
            identity = await SocialRepository(session).identity('faceit', 'duplicate')
            user = await session.get(UserModel, identity.user_id)
            user.is_active = False
            await session.commit()
        state, _ = await start(sm, Provider('duplicate'))
        with pytest.raises(PermissionDeniedError):
            await complete(sm, state, Provider('duplicate'))
    auth_database(run)


def test_link_conflict_reauth_binding_optional_setup_and_deletion(auth_database, configured):
    async def run(sm):
        first = await signup(sm, 'first-user', 'first-subject')
        second = await signup(sm, 'second-user', 'second-subject')
        state, _ = await start(sm, intent='link', auth=first)
        with pytest.raises(PermissionDeniedError):
            await complete(sm, state, Provider('second-subject'))
        async with sm() as session:
            assert (await SocialRepository(session).identity('faceit', 'second-subject')).user_id == second.user.id
        state, _ = await start(sm, intent='reauth', auth=first)
        assert await complete(sm, state, Provider('first-subject')) == 'reauth_ready'
        async with sm() as session:
            svc = social(session)
            with pytest.raises(PermissionDeniedError):
                await svc.consume_reauth(state, BROWSER, second)
            await session.rollback()
        async with sm() as session:
            svc = social(session)
            with pytest.raises(ValidationError):
                await svc.auth.change_password(first.user, first.session_id, '', PASSWORD, False, provider_verified=True)
            with pytest.raises(PermissionDeniedError):
                await svc.auth.delete_account(first.user, '', first.user.username)
            await session.rollback()
        async with sm() as session:
            svc = social(session)
            await svc.consume_reauth(state, BROWSER, first)
            await svc.auth.request_email_change(first.user, 'confirmed@example.invalid', '', provider_verified=True)
            await session.commit()
            assert len(svc.auth._publisher.messages) == 1  # No invented old recipient.
            url = svc.auth._publisher.messages[0].data['confirm_url']
            token = parse_qs(urlsplit(url).query)['token'][0]
            await svc.auth.confirm_email_change(token)
            await session.commit()
        with pytest.raises(PermissionDeniedError):
            async with sm() as session:
                await social(session).consume_reauth(state, BROWSER, first)
        async with sm() as session:
            first.user = await social(session).auth._user_repo.get_by_id_basic(first.user.id)
        state, _ = await start(sm, intent='reauth', auth=first)
        await complete(sm, state, Provider('first-subject'))
        async with sm() as session:
            svc = social(session)
            await svc.consume_reauth(state, BROWSER, first)
            await svc.auth.change_password(first.user, first.session_id, '', PASSWORD, False, provider_verified=True)
            await session.commit()
            logged = await svc.auth.login(first.user.username, PASSWORD, 'Windows', None)
            assert logged.access_token
            # Once password is configured, sensitive password endpoints remain authoritative.
            refreshed = await svc.auth._user_repo.get_by_id_basic(first.user.id)
            with pytest.raises(PermissionDeniedError):
                await svc.auth.delete_account(refreshed, '', refreshed.username, provider_verified=True)
            await session.rollback()
            await svc.auth.delete_account(refreshed, PASSWORD, refreshed.username)
            await session.commit()
        # Separate social-only deletion needs a one-use provider proof, not fake credentials.
        state, _ = await start(sm, intent='reauth', auth=second)
        await complete(sm, state, Provider('second-subject'))
        async with sm() as session:
            svc = social(session)
            await svc.consume_reauth(state, BROWSER, second)
            await svc.auth.delete_account(second.user, '', second.user.username, provider_verified=True)
            await session.commit()
            assert not (await svc.auth._user_repo.get_by_id_basic(second.user.id)).is_active
    auth_database(run)
