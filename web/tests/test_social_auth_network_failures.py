"""Offline network-boundary regressions; coordinator runs with existing env."""
import asyncio

import httpx
import pytest

from APP.config import SocialConfig, settings
from APP.exceptions import PermissionDeniedError
from APP.services.social_service import OPENID_NS, STEAM_ENDPOINT, ProviderClient, SocialService, utcnow


def test_providers_fail_closed_without_explicit_configuration(monkeypatch):
    monkeypatch.setattr(settings, 'social', SocialConfig(api_origin='https://watchdemo.test',
        faceit_client_id='id', faceit_client_secret='secret'))
    assert SocialService.availability() == {'steam': False, 'faceit': False}
    monkeypatch.setattr(settings, 'social', SocialConfig(api_origin='http://watchdemo.test', steam_enabled=True))
    assert SocialService.availability() == {'steam': False, 'faceit': False}


@pytest.mark.parametrize('status,payload', [(200, {}), (200, {'nickname': 'not-an-id'}),
                                           (200, {'sub': ''}), (302, {'sub': 'redirect'}),
                                           (503, {'sub': 'unavailable'})])
def test_faceit_rejects_missing_subject_redirect_and_provider_failure(monkeypatch, status, payload):
    monkeypatch.setattr(settings, 'social', SocialConfig(
        faceit_token_url='https://api.faceit.com/token', faceit_userinfo_url='https://api.faceit.com/userinfo'))
    requests = []

    def handler(request):
        requests.append(str(request.url))
        if request.method == 'POST':
            return httpx.Response(200, json={'access_token': 'test-token'})
        return httpx.Response(status, json=payload, headers={'Location': 'https://evil.invalid/userinfo'})

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises((PermissionDeniedError, httpx.HTTPStatusError)):
        asyncio.run(ProviderClient().faceit('code', 'verifier', 'https://watchdemo.test/callback'))
    assert requests == ['https://api.faceit.com/token', 'https://api.faceit.com/userinfo']


def test_steam_negative_verification_is_not_a_login(monkeypatch):
    callback = 'https://watchdemo.test/callback?state=state'
    params = {'openid.ns': OPENID_NS, 'openid.mode': 'id_res', 'openid.op_endpoint': STEAM_ENDPOINT,
        'openid.return_to': callback, 'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000000',
        'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000000',
        'openid.response_nonce': utcnow().strftime('%Y-%m-%dT%H:%M:%SZ') + 'nonce',
        'openid.assoc_handle': 'handle', 'openid.sig': 'signature',
        'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle'}
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, text=f'ns:{OPENID_NS}\nis_valid:false\n')), **kwargs))
    with pytest.raises(PermissionDeniedError):
        asyncio.run(ProviderClient().steam(params, callback))
