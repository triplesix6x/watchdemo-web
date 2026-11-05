"""Persistent account-global quota operations; no historical import/set backfill.

Revision ID: 0006_subscription_sync
Revises: 0005_legal_prelaunch
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_subscription_sync"
down_revision = "0005_legal_prelaunch"
branch_labels = None
depends_on = None


def timestamps():
    return [sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now())]


def upgrade():
    op.create_table("quota_accounts",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("group_generation", sa.Integer(), nullable=False, server_default="0"),
        *timestamps())
    op.create_table("quota_libraries",
        sa.Column("library_id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reconciled_generation", sa.Integer(), nullable=False, server_default="-1"),
        *timestamps())
    op.create_index("ix_quota_libraries_user_id", "quota_libraries", ["user_id"])
    op.create_table("usage_operations",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("operation_id", sa.Uuid(), primary_key=True),
        sa.Column("library_id", sa.Uuid(), sa.ForeignKey("quota_libraries.library_id"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=True),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("reserved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paid_cycle_anchor", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("group_generation", sa.Integer(), nullable=False),
        sa.Column("group_deleted", sa.Boolean(), nullable=False),
        sa.CheckConstraint("kind IN ('demo_import', 'custom_sets', 'demo_groups')", name="usage_kind"),
        sa.CheckConstraint("state IN ('reserved', 'committed', 'cancelled', 'expired')", name="usage_state"),
        sa.CheckConstraint("kind IS NOT NULL OR state = 'cancelled'", name="cancel_tombstone_kind"),
        *timestamps())
    op.create_index("ix_usage_operations_library_id", "usage_operations", ["library_id"])
    op.create_index("ix_usage_account_kind_time", "usage_operations", ["user_id", "kind", "reserved_at"])


def downgrade():
    op.drop_table("usage_operations")
    op.drop_table("quota_libraries")
    op.drop_table("quota_accounts")
