"""Ed25519 wire/cryptographic behavior, no shared signing key and no network."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from APP.config import EntitlementConfig
from APP.constants import SubscriptionTier
from APP.services.entitlement_service import sign_entitlement


def fixture():
    key = Ed25519PrivateKey.generate()  # ephemeral test-only key; never production config
    config = EntitlementConfig(kid="test-ed25519", private_key_pem=key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()).decode())
    return key, config


def issue(config, **overrides):
    args = dict(user_id=uuid.uuid4(), session_id=uuid.uuid4(), tier=SubscriptionTier.PLUS,
        now=datetime.now(timezone.utc), anchor=datetime(2026, 1, 31, tzinfo=timezone.utc),
        subscription_expires_at=None)
    args.update(overrides)
    return sign_entitlement(config, **args), args


def test_missing_signing_config_fails_closed_without_shared_secret():
    assert issue(EntitlementConfig())[0] is None
    assert issue(EntitlementConfig(kid="only-id"))[0] is None


@pytest.mark.parametrize("tier", list(SubscriptionTier))
def test_lease_exact_claims_identity_session_type_and_24h_bound(tier):
    key, config = fixture()
    token, args = issue(config, tier=tier)
    assert jwt.get_unverified_header(token) == {"alg": "EdDSA", "kid": "test-ed25519", "typ": "WD-ENTITLEMENT+jwt"}
    claims = jwt.decode(token, key.public_key(), algorithms=["EdDSA"], audience="watchdemo-desktop", issuer="watchdemo")
    assert set(claims) == {"iss", "aud", "sub", "sid", "tier", "iat", "exp", "paid_cycle_anchor", "subscription_expires_at", "protocol_version"}
    assert claims["sub"] == str(args["user_id"]) and claims["sid"] == str(args["session_id"])
    assert claims["tier"] == tier.value and claims["protocol_version"] == 1
    assert type(claims["iat"]) is int and type(claims["exp"]) is int
    assert claims["exp"] - claims["iat"] == 86400
    assert claims["paid_cycle_anchor"] == "2026-01-31T00:00:00Z"
    assert claims["subscription_expires_at"] is None
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, Ed25519PrivateKey.generate().public_key(), algorithms=["EdDSA"], audience="watchdemo-desktop")
    with pytest.raises(jwt.InvalidAudienceError):
        jwt.decode(token, key.public_key(), algorithms=["EdDSA"], audience="other-client")
    with pytest.raises(jwt.InvalidAlgorithmError):
        jwt.decode(token, "wrong-algorithm", algorithms=["HS256"], audience="watchdemo-desktop")


def test_configured_malformed_or_wrong_type_key_fails_closed():
    malformed = EntitlementConfig(kid="malformed-test", private_key_pem="not-a-pem")
    with pytest.raises(ValueError):
        issue(malformed)

    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

    wrong_key = X25519PrivateKey.generate()
    wrong_type = EntitlementConfig(kid="wrong-type-test", private_key_pem=wrong_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()).decode())
    with pytest.raises(ValueError, match="Entitlement key must be Ed25519"):
        issue(wrong_type)


def test_paid_expiry_bounds_lease_and_expired_signature_is_not_paid_authority():
    key, config = fixture()
    expiry = datetime.now(timezone.utc) + timedelta(minutes=5)
    token, _ = issue(config, subscription_expires_at=expiry)
    claims = jwt.decode(token, key.public_key(), algorithms=["EdDSA"], audience="watchdemo-desktop")
    assert claims["exp"] == claims["subscription_expires_at"] == int(expiry.timestamp())
    expired, _ = issue(config, now=datetime.now(timezone.utc) - timedelta(days=2))
    with pytest.raises(jwt.ExpiredSignatureError):
        jwt.decode(expired, key.public_key(), algorithms=["EdDSA"], audience="watchdemo-desktop")


def test_tampered_signed_payload_does_not_verify():
    key, config = fixture()
    token, _ = issue(config)
    header, payload, signature = token.split(".")
    decoded = jwt.api_jws.base64url_decode(payload.encode()).replace(b'"plus"', b'"pro"')
    altered = ".".join((header, jwt.api_jws.base64url_encode(decoded).decode(), signature))
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(altered, key.public_key(), algorithms=["EdDSA"], audience="watchdemo-desktop")
