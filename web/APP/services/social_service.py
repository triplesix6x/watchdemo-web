"""Verified provider authentication; no provider token survives the network boundary.

A callback first durably spends its started transaction, including on denial or
network failure. Completion and sensitive-action grants are separately single-use.
"""
import base64
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

import httpx
from sqlalchemy.exc import IntegrityError

from APP.config import settings
from APP.constants import Locale
from APP.exceptions import AlreadyExistsError, ErrorCode, PermissionDeniedError, ValidationError
from APP.services.auth_service import AuthService
from SPI.db_adapter.models.social import DesktopSocialHandoffModel, SocialTransactionModel
from SPI.db_adapter.repositories.social_repo import SocialRepository

STEAM_ENDPOINT = "https://steamcommunity.com/openid/login"
OPENID_NS = "http://specs.openid.net/auth/2.0"
IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select"


def rejected(message="Social authorization expired or invalid. Start again."):
    return PermissionDeniedError(message, code=ErrorCode.INVALID_CREDENTIALS)


def utcnow():
    return datetime.now(timezone.utc)


class ProviderClient:
    """Only this network boundary is replaced by protocol tests."""
    async def steam(self, params: dict[str, str], expected_return_to: str) -> tuple[str, str]:
        required = {"openid.ns": OPENID_NS, "openid.mode": "id_res",
                    "openid.op_endpoint": STEAM_ENDPOINT, "openid.return_to": expected_return_to}
        if any(params.get(k) != v for k, v in required.items()):
            raise rejected("Invalid Steam OpenID response")
        claimed = params.get("openid.claimed_id", "")
        if params.get("openid.identity") != claimed or not re.fullmatch(
                r"https://steamcommunity\.com/openid/id/[0-9]{17}", claimed):
            raise rejected("Invalid Steam identity")
        signed = set(params.get("openid.signed", "").split(","))
        if not {"op_endpoint", "claimed_id", "identity", "return_to", "response_nonce", "assoc_handle"} <= signed:
            raise rejected("Incomplete Steam signature")
        nonce = params.get("openid.response_nonce", "")
        try:
            timestamp = datetime.strptime(nonce[:20], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            raise rejected("Invalid Steam nonce") from None
        if len(nonce) <= 20 or len(nonce) > 255 or abs((utcnow() - timestamp).total_seconds()) > 300:
            raise rejected("Expired Steam nonce")
        payload = {k: v for k, v in params.items() if k.startswith("openid.")}
        payload["openid.mode"] = "check_authentication"
        async with httpx.AsyncClient(timeout=settings.social.timeout_seconds, follow_redirects=False,
                                     trust_env=False) as client:
            response = await client.post(STEAM_ENDPOINT, data=payload)
        response.raise_for_status()
        fields = dict(line.split(":", 1) for line in response.text.splitlines() if ":" in line)
        if fields.get("ns") != OPENID_NS or fields.get("is_valid") != "true":
            raise rejected("Steam signature verification failed")
        return claimed.rsplit("/", 1)[1], nonce

    async def faceit(self, code: str, verifier: str, callback: str) -> str:
        config = settings.social
        async with httpx.AsyncClient(timeout=config.timeout_seconds, follow_redirects=False,
                                     trust_env=False) as client:
            # FACEIT discovery advertises client_secret_basic, not secret-post.
            response = await client.post(config.faceit_token_url,
                auth=httpx.BasicAuth(config.faceit_client_id, config.faceit_client_secret), data={
                    "grant_type": "authorization_code", "code": code, "redirect_uri": callback,
                    "code_verifier": verifier,
                })
            response.raise_for_status()
            data = response.json()
            token = data.get("access_token") if isinstance(data, dict) else None
            if not isinstance(token, str) or not token or len(token) > 8192:
                raise rejected("FACEIT did not return an access token")
            response = await client.get(config.faceit_userinfo_url, headers={"Authorization": f"Bearer {token}"})
            response.raise_for_status()
            info = response.json()
        # OIDC userinfo's stable subject, never an email or mutable nickname.
        subject = info.get("sub") if isinstance(info, dict) else None
        if not isinstance(subject, str) or not subject.strip() or len(subject) > 255:
            raise rejected("FACEIT did not return a stable subject")
        return subject


class SocialService:
    def __init__(self, repo: SocialRepository, auth: AuthService, provider: ProviderClient):
        self.repo, self.auth, self.provider = repo, auth, provider

    @staticmethod
    def availability() -> dict[str, bool]:
        config = settings.social
        origin = config.api_origin.rstrip("/")
        parsed = urlsplit(origin)
        valid = (parsed.scheme in {"http", "https"} and bool(parsed.netloc)
                 and not (parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password)
                 and (parsed.scheme == "https" or parsed.hostname in {"localhost", "127.0.0.1"}))
        return {"steam": bool(valid and config.steam_enabled),
                "faceit": bool(valid and config.faceit_client_id and config.faceit_client_secret
                               and config.faceit_authorize_url and config.faceit_token_url and config.faceit_userinfo_url)}

    async def start(self, provider: str, intent: str, browser: str, auth=None,
                    desktop: DesktopSocialHandoffModel | None = None) -> tuple[str, str]:
        if not self.availability().get(provider):
            raise ValidationError("This provider is not configured. Use another sign-in method.")
        if intent not in {"login", "link", "reauth"} or (intent != "login" and auth is None):
            raise rejected()
        state = secrets.token_urlsafe(32)
        callback = f"{settings.social.api_origin.rstrip('/')}/api/v1/auth/social/{provider}/callback"
        verifier = secrets.token_urlsafe(48) if provider == "faceit" else None
        if provider == "steam":
            callback += "?" + urlencode({"state": state})
            query = {"openid.ns": OPENID_NS, "openid.mode": "checkid_setup",
                     "openid.return_to": callback,
                     "openid.realm": settings.social.api_origin.rstrip("/") + "/",
                     "openid.identity": IDENTIFIER_SELECT, "openid.claimed_id": IDENTIFIER_SELECT}
            url = STEAM_ENDPOINT + "?" + urlencode(query)
        else:
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            url = settings.social.faceit_authorize_url + "?" + urlencode({
                "redirect_popup": "true", "response_type": "code", "client_id": settings.social.faceit_client_id,
                "redirect_uri": callback, "scope": "openid profile", "state": state,
                "code_challenge": challenge, "code_challenge_method": "S256"})
        self.repo.session.add(SocialTransactionModel(
            desktop_id=desktop.id if desktop else None,
            state_hash=AuthService._hash_token(state), browser_hash=AuthService._hash_token(browser),
            provider=provider, intent=intent, stage="started", callback=callback, verifier=verifier,
            user_id=auth.user.id if auth else None, session_id=auth.session_id if auth else None,
            expires_at=desktop.expires_at if desktop else utcnow() + timedelta(minutes=10)))
        await self.repo.session.commit()
        return state, url

    async def desktop_start(self, provider: str, challenge: str):
        if not re.fullmatch(r"[0-9a-f]{64}", challenge):
            raise rejected()
        if not self.availability().get(provider) or urlsplit(settings.social.api_origin).scheme != "https":
            raise ValidationError("Desktop sign-in requires a configured HTTPS provider")
        launch = secrets.token_urlsafe(32)
        self.repo.session.add(DesktopSocialHandoffModel(
            challenge_hash=AuthService._hash_token(challenge), launch_hash=AuthService._hash_token(launch),
            provider=provider, stage="created", expires_at=utcnow() + timedelta(minutes=10)))
        try:
            await self.repo.session.commit()
        except IntegrityError:
            await self.repo.session.rollback()
            raise rejected("Start again with a new desktop verifier") from None
        return {"authorization_url": settings.social.api_origin.rstrip("/") +
                "/api/v1/auth/social/desktop/launch?ticket=" + launch, "expires_in": 600}

    async def desktop_launch(self, ticket: str, browser: str):
        if not ticket or len(ticket) > 128:
            raise rejected()
        handoff = await self.repo.desktop_launch(AuthService._hash_token(ticket))
        if not handoff or handoff.stage != "created" or handoff.expires_at <= utcnow():
            raise rejected()
        handoff.stage = "launched"
        # start commits the launch spend and cookie-bound transaction atomically.
        return await self.start(handoff.provider, "login", browser, desktop=handoff)

    async def desktop_approve(self, state: str, browser: str):
        tx = await self.bound_transaction(state, browser, {"login_ready"})
        if not tx.desktop_id:
            raise rejected("This is a website sign-in")
        await self.owner(tx)
        tx.stage = "desktop_ready"
        await self.repo.session.commit()

    async def desktop_poll(self, verifier: str, device: str | None, ip: str | None):
        if not re.fullmatch(r"[0-9a-f]{64}", verifier):
            raise rejected()
        challenge = hashlib.sha256(verifier.encode()).hexdigest()
        handoff = await self.repo.desktop_challenge(AuthService._hash_token(challenge))
        if not handoff or handoff.stage == "consumed" or handoff.expires_at <= utcnow():
            raise rejected()
        tx = await self.repo.desktop_transaction(handoff.id)
        if not tx or tx.stage != "desktop_ready":
            return {"status": "pending"}
        if tx.expires_at <= utcnow():
            raise rejected()
        user = await self.owner(tx)
        result = await self.auth.create_session(user, device, ip)
        tx.stage = handoff.stage = "consumed"
        await self.repo.session.commit()
        return {"status": "complete", "access_token": result.access_token, "refresh_token": result.refresh_token}

    async def bound_transaction(self, state: str, browser: str, stages: set[str]):
        if not state or not browser:
            raise rejected()
        tx = await self.repo.transaction(AuthService._hash_token(state))
        if (not tx or not secrets.compare_digest(tx.browser_hash, AuthService._hash_token(browser))
                or tx.expires_at <= utcnow() or tx.stage not in stages):
            raise rejected()
        return tx

    async def owner(self, tx):
        user = await self.auth._user_repo.get_by_id_basic(tx.user_id) if tx.user_id else None
        if not user or not user.is_active:
            raise rejected("Account is deactivated")
        if tx.intent != "login":
            session = await self.auth._session_repo.get_by_id(tx.session_id)
            if not session or not session.is_active or session.user_id != user.id:
                raise rejected("The initiating session is no longer active")
            expires = session.expires_at
            created = session.created_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if utcnow() >= min(expires, created + timedelta(days=settings.app.refresh_token_max_age_days)):
                raise rejected("The initiating session has expired")
        return user

    async def callback(self, provider: str, state: str, browser: str, params: dict[str, str]):
        tx = await self.bound_transaction(state, browser, {"started"})
        if tx.provider != provider:
            raise rejected()
        callback, verifier = tx.callback, tx.verifier
        tx.stage, tx.verifier = "verifying", None
        # Spend before any external IO; a failure/rollback cannot resurrect a code.
        await self.repo.session.commit()
        if params.get("error") or params.get("openid.mode") == "cancel":
            raise rejected("Provider authorization was cancelled. Start again when ready.")
        try:
            if provider == "steam":
                subject, nonce = await self.provider.steam(params, callback)
            elif provider == "faceit" and params.get("code") and len(params["code"]) <= 4096:
                subject = await self.provider.faceit(params["code"], verifier, callback)
                nonce = None
            else:
                raise rejected()
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            # Never log provider replies, codes, secrets or response URLs.
            raise rejected("Provider unavailable or invalid response. Please start again.") from None
        tx = await self.bound_transaction(state, browser, {"verifying"})
        identity = await self.repo.identity(provider, subject)
        try:
            tx.subject, tx.nonce, tx.verifier = subject, nonce, None
            if tx.intent == "login":
                if identity:
                    tx.user_id = identity.user_id
                    await self.owner(tx)
                    tx.stage = "login_ready"
                else:
                    tx.stage = "pending_registration"
            else:
                await self.owner(tx)
                if tx.intent == "reauth":
                    if not identity or identity.user_id != tx.user_id:
                        raise rejected("Use a provider already linked to this account")
                    tx.stage = "reauth_ready"
                    tx.expires_at = utcnow() + timedelta(minutes=5)
                else:
                    if identity and identity.user_id != tx.user_id:
                        raise rejected("This provider identity belongs to another account. Accounts cannot be merged.")
                    if not identity:
                        await self.repo.add_identity(tx.user_id, provider, subject)
                    tx.stage = "linked"
            await self.repo.session.commit()
        except IntegrityError:
            await self.repo.session.rollback()
            raise rejected("Provider identity or nonce already used. No account was changed.") from None
        return tx.stage

    async def status(self, state: str, browser: str):
        tx = await self.bound_transaction(state, browser, {
            "pending_registration", "login_ready", "linked", "reauth_ready"})
        if tx.user_id:
            await self.owner(tx)
        return {"stage": tx.stage, "provider": tx.provider, "flow_id": tx.state_hash,
                "destination": "desktop" if tx.desktop_id else "website"}

    async def register(self, state: str, browser: str, username: str, locale: Locale):
        tx = await self.bound_transaction(state, browser, {"pending_registration"})
        if await self.auth._user_repo.get_by_username(username):
            raise AlreadyExistsError("Username already taken", code=ErrorCode.USERNAME_TAKEN)
        try:
            # Savepoint retains pending registration after a name/identity race.
            async with self.repo.session.begin_nested():
                user = await self.auth._user_repo.create(None, username, None, locale=locale)
                await self.auth._subscription_repo.create(user.id)
                await self.repo.add_identity(user.id, tx.provider, tx.subject)
                tx.user_id, tx.stage = user.id, "login_ready"
                await self.repo.session.flush()
        except IntegrityError:
            raise AlreadyExistsError("Username or provider identity already registered. Try signing in again.",
                                     code=ErrorCode.USERNAME_TAKEN) from None
        await self.repo.session.commit()

    async def finish(self, state: str, browser: str, device: str | None, ip: str | None):
        tx = await self.bound_transaction(state, browser, {"login_ready"})
        if tx.desktop_id:
            raise rejected("Approve desktop sign-in instead")
        user = await self.owner(tx)
        result = await self.auth.create_session(user, device, ip)
        tx.stage = "consumed"
        await self.repo.session.commit()
        return result

    async def consume_reauth(self, state: str, browser: str, auth):
        tx = await self.bound_transaction(state, browser, {"reauth_ready"})
        await self.owner(tx)
        if tx.user_id != auth.user.id or tx.session_id != auth.session_id:
            raise rejected("Repeat provider verification in this session")
        tx.stage = "consumed"
        # Sensitive write and consumption commit together at request teardown.
        return tx
