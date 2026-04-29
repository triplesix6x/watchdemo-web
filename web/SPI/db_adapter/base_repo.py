from typing import Generic, TypeVar, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from SPI.db_adapter.base_model import Base

T = TypeVar('T')


class SQLAlchemyRepository(Generic[T]):
    model: type[Base | T]
    table_verbose_name: str

    def __init__(self, session: AsyncSession):
        self.session = session

    async def _execute_one_or_none(self, query) -> Optional[T]:
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def _execute_all(self, query) -> list[T]:
        result = await self.session.execute(query)
        return list(result.scalars().all())
