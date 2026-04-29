from typing import Annotated, TypeAlias, AsyncGenerator, Any

from fastapi import Depends
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from APP.config import settings

class Database:
    def __init__(
            self,
            url: str,
            echo: bool = False,
            echo_pool: bool = False,
            pool_size: int = 10,
            max_overflow: int = 5):

        self.engine = create_async_engine(
            url=url,
            echo=echo,
            echo_pool=echo_pool,
            pool_size=pool_size,
            max_overflow=max_overflow)

        self.session_factory = async_sessionmaker(
            bind=self.engine,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False)

    async def dispose(self):
        await self.engine.dispose()

    async def get_async_session(self) -> AsyncGenerator[AsyncSession, Any]:
        async with self.session_factory() as session:
            yield session

    async def get_db(self) -> AsyncGenerator[AsyncSession, None]:
        async with self.session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

db = Database(
    url=str(settings.postgres.url),
    echo=settings.postgres.echo,
    echo_pool=settings.postgres.echo_pool,
    pool_size=settings.postgres.pool_size,
    max_overflow=settings.postgres.max_overflow)


AnnDBSession: TypeAlias = Annotated[AsyncSession, Depends(db.get_db)]