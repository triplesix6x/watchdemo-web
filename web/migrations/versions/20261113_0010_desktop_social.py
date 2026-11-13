"""Add one-use native social handoffs.

Revision ID: 0010_desktop_social
Revises: 0009_merge_social_heads
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_desktop_social"
down_revision = "0009_merge_social_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "desktop_social_handoffs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("challenge_hash", sa.String(64), nullable=False),
        sa.Column("launch_hash", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("stage", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("challenge_hash"),
        sa.UniqueConstraint("launch_hash"),
    )
    op.add_column("social_transactions", sa.Column("desktop_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_social_transaction_desktop", "social_transactions",
                          "desktop_social_handoffs", ["desktop_id"], ["id"], ondelete="CASCADE")
    op.create_unique_constraint("uq_social_transaction_desktop", "social_transactions", ["desktop_id"])


def downgrade() -> None:
    op.drop_constraint("uq_social_transaction_desktop", "social_transactions", type_="unique")
    op.drop_constraint("fk_social_transaction_desktop", "social_transactions", type_="foreignkey")
    op.drop_column("social_transactions", "desktop_id")
    op.drop_table("desktop_social_handoffs")
