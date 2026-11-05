"""Dedicated asymmetric offline identity/paid lease. No shared signing secret."""
from datetime import datetime, timedelta
from uuid import UUID

import jwt

from APP.config import EntitlementConfig
from APP.constants import SubscriptionTier


def sign_entitlement(config: EntitlementConfig, *, user_id: UUID, session_id: UUID,
                     tier: SubscriptionTier, now: datetime, anchor: datetime | None,
                     subscription_expires_at: datetime | None) -> str | None:
    if not config.private_key_pem or not config.kid.strip():
        return None
    # Keep unsigned access/DTO/calendar behavior usable without this optional
    # runtime capability; a configured signer still fails closed if unavailable.
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = serialization.load_pem_private_key(config.private_key_pem.encode(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("Entitlement key must be Ed25519")
    expires = now + timedelta(hours=24)
    if tier != SubscriptionTier.BASIC and subscription_expires_at is not None:
        expires = min(expires, subscription_expires_at)
    return jwt.encode({
        "iss": "watchdemo", "aud": "watchdemo-desktop", "sub": str(user_id),
        "sid": str(session_id), "tier": tier.value,
        "iat": int(now.timestamp()), "exp": int(expires.timestamp()),
        "paid_cycle_anchor": anchor.isoformat().replace("+00:00", "Z") if anchor else None,
        "subscription_expires_at": int(subscription_expires_at.timestamp()) if subscription_expires_at else None,
        "protocol_version": 1,
    }, key, algorithm="EdDSA", headers={"kid": config.kid, "typ": "WD-ENTITLEMENT+jwt"})
