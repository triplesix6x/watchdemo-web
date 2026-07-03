import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import contains_eager, joinedload

from APP.constants import SubscriptionTier, UserRole
from APP.entities.admin import UserFilters
from APP.entities.subscription import SubscriptionEntity
from APP.entities.user import UserEntity
from SPI.db_adapter.base_repo import SQLAlchemyRepository
from SPI.db_adapter.models.subscription import SubscriptionModel
from SPI.db_adapter.models.user import UserModel


class UserRepository(SQLAlchemyRepository[UserModel]):
    model = UserModel

    def to_entity(self, user: UserModel) -> UserEntity:
        sub_entity = None
        if user.subscription:
            sub_entity = self._sub_to_entity(user.subscription)
        return UserEntity(
            id=user.id,
            email=user.email,
            username=user.username,
            role=UserRole(user.role),
            is_verified=user.is_verified,
            is_active=user.is_active,
            created_at=user.created_at,
            updated_at=user.updated_at,
            subscription=sub_entity,
        )

    @staticmethod
    def _sub_to_entity(sub: SubscriptionModel) -> SubscriptionEntity:
        return SubscriptionEntity(
            id=sub.id,
            user_id=sub.user_id,
            tier=SubscriptionTier(sub.tier),
            started_at=sub.started_at,
            expires_at=sub.expires_at,
            granted_by=sub.granted_by,
            is_active=sub.is_active,
            created_at=sub.created_at,
            updated_at=sub.updated_at,
        )

    async def get_by_id(self, user_id: uuid.UUID, for_update: bool = False) -> UserEntity | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.id == user_id)
        )
        if for_update:
            query = query.with_for_update()
        user = await self._execute_one_or_none(query)
        return self.to_entity(user) if user else None

    async def get_by_id_basic(self, user_id: uuid.UUID) -> UserEntity | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.id == user_id)
        )
        user = await self._execute_one_or_none(query)
        return self.to_entity(user) if user else None

    async def get_by_email(self, email: str) -> UserEntity | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.email == email.lower())
        )
        user = await self._execute_one_or_none(query)
        return self.to_entity(user) if user else None

    async def get_by_username(self, username: str) -> UserEntity | None:
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(UserModel.username == username.lower())
        )
        user = await self._execute_one_or_none(query)
        return self.to_entity(user) if user else None

    async def get_by_login(self, login: str) -> UserModel | None:
        """Returns raw model — auth needs password_hash for credential verification."""
        login_lower = login.lower()
        query = (
            select(UserModel)
            .options(joinedload(UserModel.subscription))
            .where(or_(UserModel.email == login_lower, UserModel.username == login_lower))
        )
        return await self._execute_one_or_none(query)

    async def create(
        self,
        email: str,
        username: str,
        password_hash: str,
        role: UserRole = UserRole.USER,
    ) -> UserEntity:
        user = UserModel(
            email=email.lower(),
            username=username.lower(),
            password_hash=password_hash,
            role=role.value,
        )
        self.session.add(user)
        await self.session.flush()
        await self.session.refresh(user)
        user.subscription = None
        return self.to_entity(user)

    async def update_password(self, user_id: uuid.UUID, password_hash: str) -> None:
        query = select(UserModel).where(UserModel.id == user_id).with_for_update()
        user = await self._execute_one_or_none(query)
        if user:
            user.password_hash = password_hash
            await self.session.flush()

    async def mark_verified(self, user_id: uuid.UUID) -> None:
        query = select(UserModel).where(UserModel.id == user_id).with_for_update()
        user = await self._execute_one_or_none(query)
        if user:
            user.is_verified = True
            await self.session.flush()

    async def update_role(self, user_id: uuid.UUID, role: UserRole) -> None:
        query = select(UserModel).where(UserModel.id == user_id).with_for_update()
        user = await self._execute_one_or_none(query)
        if user:
            user.role = role.value
            await self.session.flush()

    async def set_active(self, user_id: uuid.UUID, is_active: bool) -> None:
        query = select(UserModel).where(UserModel.id == user_id).with_for_update()
        user = await self._execute_one_or_none(query)
        if user:
            user.is_active = is_active
            await self.session.flush()

    @staticmethod
    def _list_conditions(filters: UserFilters, now: datetime) -> list:
        """Собирает WHERE-условия для списка/подсчёта пользователей по фильтрам."""
        conds: list = []
        if filters.q:
            pattern = f"%{filters.q.lower()}%"
            conds.append(or_(UserModel.username.ilike(pattern), UserModel.email.ilike(pattern)))
        if filters.role is not None:
            conds.append(UserModel.role == filters.role.value)
        if filters.is_verified is not None:
            conds.append(UserModel.is_verified == filters.is_verified)
        if filters.is_active is not None:
            conds.append(UserModel.is_active == filters.is_active)

        expired = and_(
            SubscriptionModel.expires_at.is_not(None),
            SubscriptionModel.expires_at <= now,
        )
        if filters.tier_none:
            conds.append(SubscriptionModel.id.is_(None))
        elif filters.tier is SubscriptionTier.BASIC:
            conds.append(
                and_(
                    SubscriptionModel.id.is_not(None),
                    or_(SubscriptionModel.tier == SubscriptionTier.BASIC.value, expired),
                )
            )
        elif filters.tier in (SubscriptionTier.PLUS, SubscriptionTier.PRO):
            not_expired = or_(
                SubscriptionModel.expires_at.is_(None),
                SubscriptionModel.expires_at > now,
            )
            conds.append(and_(SubscriptionModel.tier == filters.tier.value, not_expired))
        return conds

    async def list_paginated(
        self, offset: int, limit: int, filters: UserFilters
    ) -> tuple[list[UserEntity], int]:
        """Возвращает страницу пользователей и общее число подходящих под фильтры.

        Args:
            offset: Сколько записей пропустить.
            limit: Размер страницы.
            filters: Набор фильтров (поиск, роль, статусы, тариф).

        Returns:
            Пара (пользователи страницы, общее количество).
        """
        now = datetime.now(tz=timezone.utc)
        conds = self._list_conditions(filters, now)

        base = select(UserModel).outerjoin(SubscriptionModel)
        if conds:
            base = base.where(*conds)

        list_query = (
            base.options(contains_eager(UserModel.subscription))
            .order_by(UserModel.created_at.desc(), UserModel.id.desc())
            .offset(offset)
            .limit(limit)
        )
        count_query = select(func.count()).select_from(UserModel).outerjoin(SubscriptionModel)
        if conds:
            count_query = count_query.where(*conds)

        users = await self._execute_all(list_query)
        total = (await self.session.execute(count_query)).scalar_one()
        return [self.to_entity(u) for u in users], total

    async def get_user_stats(self) -> dict[str, int]:
        """Считает агрегаты по таблице пользователей для админ-дашборда.

        Returns:
            Словарь с ключами total, verified, active, signups_7d, signups_30d.
        """
        now = datetime.now(tz=timezone.utc).replace(tzinfo=None)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)
        query = select(
            func.count(),
            func.coalesce(func.sum(case((UserModel.is_verified.is_(True), 1), else_=0)), 0),
            func.coalesce(func.sum(case((UserModel.is_active.is_(True), 1), else_=0)), 0),
            func.coalesce(func.sum(case((UserModel.created_at >= week_ago, 1), else_=0)), 0),
            func.coalesce(func.sum(case((UserModel.created_at >= month_ago, 1), else_=0)), 0),
        )
        row = (await self.session.execute(query)).one()
        return {
            "total": row[0],
            "verified": row[1],
            "active": row[2],
            "signups_7d": row[3],
            "signups_30d": row[4],
        }
