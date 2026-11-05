import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from APP.exceptions import ConflictError, ErrorCode, NotFoundError
from SPI.db_adapter.models.quota import QuotaAccountModel, QuotaLibraryModel, UsageOperationModel
from SPI.db_adapter.models.user import UserModel


class QuotaRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def lock_account(self, user_id: uuid.UUID) -> QuotaAccountModel:
        # Lock the existing user row BEFORE creating account/library rows. This
        # serializes even first activation and uses the same lock as subscriptions.
        user = await self.session.scalar(select(UserModel).where(UserModel.id == user_id).with_for_update())
        if user is None:
            raise NotFoundError("User not found", code=ErrorCode.USER_NOT_FOUND)
        account = await self.session.get(QuotaAccountModel, user_id)
        if account is None:
            account = QuotaAccountModel(user_id=user_id, group_generation=0)
            self.session.add(account)
            await self.session.flush()
        return account

    async def library(self, user_id: uuid.UUID, library_id: uuid.UUID) -> QuotaLibraryModel:
        library = await self.session.get(QuotaLibraryModel, library_id)
        if library is not None and library.user_id != user_id:
            raise ConflictError("Library belongs to another account", code=ErrorCode.OPERATION_CONFLICT)
        if library is None:
            # Global library ownership, including simultaneous claims by accounts.
            from sqlalchemy.dialects.postgresql import insert
            await self.session.execute(insert(QuotaLibraryModel).values(
                library_id=library_id, user_id=user_id, reconciled_generation=-1,
            ).on_conflict_do_nothing(index_elements=["library_id"]))
            library = await self.session.get(QuotaLibraryModel, library_id)
            if library.user_id != user_id:
                raise ConflictError("Library belongs to another account", code=ErrorCode.OPERATION_CONFLICT)
        return library

    async def expire(self, user_id: uuid.UUID, now: datetime) -> None:
        await self.session.execute(update(UsageOperationModel).where(
            UsageOperationModel.user_id == user_id,
            UsageOperationModel.state == "reserved",
            UsageOperationModel.expires_at <= now,
        ).values(state="expired"))

    async def counts(self, user_id, now, start, end, anchor, generation):
        op = UsageOperationModel
        monthly = and_(op.kind.in_(("demo_import", "custom_sets")),
            op.reserved_at >= start, op.reserved_at < end)
        if anchor is not None:
            monthly = and_(monthly, op.paid_cycle_anchor == anchor)
        groups = and_(op.kind == "demo_groups", op.group_generation == generation,
            op.group_deleted.is_(False))
        query = select(op.kind, op.state, func.count()).where(
            op.user_id == user_id, or_(monthly, groups),
            or_(op.state == "committed", and_(op.state == "reserved", op.expires_at > now)),
        ).group_by(op.kind, op.state)
        return {(kind, state): count for kind, state, count in (await self.session.execute(query)).all()}

    async def operations(self, user_id: uuid.UUID, ids: list[uuid.UUID] | None = None, kind: str | None = None) -> list[UsageOperationModel]:
        query = select(UsageOperationModel).where(UsageOperationModel.user_id == user_id)
        if ids is not None:
            query = query.where(UsageOperationModel.operation_id.in_(ids))
        if kind is not None:
            query = query.where(UsageOperationModel.kind == kind)
        return list((await self.session.scalars(query)).all())
