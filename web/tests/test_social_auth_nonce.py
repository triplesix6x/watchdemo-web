"""Coordinator-only DB regression for Steam nonce replay and explicit linking."""
from datetime import timedelta
from types import SimpleNamespace

import pytest

from APP.exceptions import PermissionDeniedError
from APP.services.auth_service import AuthService
from APP.services.social_service import utcnow
from SPI.db_adapter.repositories.social_repo import SocialRepository
from test_auth_token_concurrency import auth_database  # noqa: F401
from test_social_auth import BROWSER, configured, signup, social  # noqa: F401


class Steam:
    def __init__(self, nonce):
        self.nonce = nonce

    async def steam(self, params, callback):
        return '76561198000000000', self.nonce


def test_explicit_link_and_nonce_replay_no_transfer(auth_database, configured):
    async def run(sm):
        owner = await signup(sm)
        nonce = utcnow().strftime('%Y-%m-%dT%H:%M:%SZ') + 'unique-signed-nonce'
        async with sm() as session:
            state, _ = await social(session).start('steam', 'link', BROWSER, owner)
        async with sm() as session:
            svc = social(session, Steam(nonce))
            assert await svc.callback('steam', state, BROWSER, {}) == 'linked'
            identities = await svc.repo.linked(owner.user.id)
            assert {identity.provider for identity in identities} == {'steam', 'faceit'}
        async with sm() as session:
            state, _ = await social(session).start('steam', 'login', BROWSER)
        async with sm() as session:
            with pytest.raises(PermissionDeniedError):
                await social(session, Steam(nonce)).callback('steam', state, BROWSER, {})
        # A fresh nonce authenticates the existing owner without creating a user.
        async with sm() as session:
            state, _ = await social(session).start('steam', 'login', BROWSER)
        async with sm() as session:
            svc = social(session, Steam(nonce + '-fresh'))
            assert await svc.callback('steam', state, BROWSER, {}) == 'login_ready'
            result = await svc.finish(state, BROWSER, None, None)
            assert result.user.id == owner.user.id
        # Even the same user must reauthenticate in the initiating session.
        async with sm() as session:
            state, _ = await social(session).start('steam', 'reauth', BROWSER, owner)
        async with sm() as session:
            svc = social(session, Steam(nonce + '-reauth'))
            await svc.callback('steam', state, BROWSER, {})
            other_session = SimpleNamespace(user=owner.user, session_id=result.session_id)
            with pytest.raises(PermissionDeniedError):
                await svc.consume_reauth(state, BROWSER, other_session)
            await session.rollback()
        async with sm() as session:
            tx = await SocialRepository(session).transaction(AuthService._hash_token(state))
            tx.expires_at = utcnow() - timedelta(seconds=1)
            await session.commit()
        async with sm() as session:
            with pytest.raises(PermissionDeniedError):
                await social(session).consume_reauth(state, BROWSER, owner)
    auth_database(run)
