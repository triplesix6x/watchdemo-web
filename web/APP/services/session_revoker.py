import uuid

from APP.ports.session_cache_port import SessionCachePort
from SPI.db_adapter.repositories.session_repo import SessionRepository


class SessionRevoker:
    """Ends sessions in the DB and in the token-check cache in one call.

    Every revoke goes through here so no caller can forget the cache and
    leave a revoked access token working for up to the cache TTL.
    """

    def __init__(self, session_repo: SessionRepository, cache: SessionCachePort) -> None:
        self._sessions = session_repo
        self._cache = cache

    async def revoke(self, session_id: uuid.UUID) -> None:
        await self._sessions.deactivate(session_id)
        await self._cache.mark_revoked([session_id])

    async def revoke_all(self, user_id: uuid.UUID, keep: uuid.UUID | None = None) -> int:
        """Revokes every active session of the user except `keep`; returns the count."""
        if keep is None:
            revoked = await self._sessions.deactivate_all(user_id)
        else:
            revoked = await self._sessions.deactivate_all_except(user_id, keep)
        await self._cache.mark_revoked(revoked)
        return len(revoked)

    async def delete_all(self, user_id: uuid.UUID) -> None:
        """Deletes the user's session rows (IP, device) and revokes their tokens."""
        await self._cache.mark_revoked(await self._sessions.delete_all(user_id))
