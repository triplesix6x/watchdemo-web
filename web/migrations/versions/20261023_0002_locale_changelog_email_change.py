"""users.locale, releases.show_in_changelog, one_time_tokens.payload

Тип токена хранится строкой (`String(30)`), поэтому новое значение
`email_change` схемы не меняет: достаточно колонки `payload` под новый адрес.

Revision ID: 0002_locale_changelog
Revises: 03b05dc2017c
Create Date: 2026-10-23
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_locale_changelog"
down_revision = "03b05dc2017c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("locale", sa.String(length=5), nullable=False, server_default="ru"),
    )
    # Старый интерфейс называл заметки внутренними: уже опубликованные релизы
    # прячем из changelog, новые по умолчанию показываем.
    op.add_column(
        "releases",
        sa.Column(
            "show_in_changelog", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.alter_column("releases", "show_in_changelog", server_default=sa.true())
    op.add_column(
        "one_time_tokens",
        sa.Column("payload", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    # Старый код не знает тип email_change и упадёт на таком токене.
    op.execute("DELETE FROM one_time_tokens WHERE token_type = 'email_change'")
    op.drop_column("one_time_tokens", "payload")
    op.drop_column("releases", "show_in_changelog")
    op.drop_column("users", "locale")
