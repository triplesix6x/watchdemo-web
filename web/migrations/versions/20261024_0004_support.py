"""support_contacts, support_tickets, support_messages

Revision ID: 0004_support
Revises: 0003_crash_reports
Create Date: 2026-10-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_support"
down_revision = "0002_locale_changelog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "support_contacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("tg_user_id", sa.BigInteger(), nullable=True),
        sa.Column("tg_chat_id", sa.BigInteger(), nullable=True),
        sa.Column("tg_username", sa.String(length=64), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("locale", sa.String(length=5), nullable=False),
        sa.Column("blocked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(channel = 'web' AND user_id IS NOT NULL AND tg_user_id IS NULL)"
            " OR (channel = 'telegram' AND tg_user_id IS NOT NULL AND user_id IS NULL)",
            name="one_identity",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_support_contacts_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_support_contacts"),
        sa.UniqueConstraint("user_id", name="uq_support_contacts_user_id"),
        sa.UniqueConstraint("tg_user_id", name="uq_support_contacts_tg_user_id"),
    )
    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), sa.Identity(), nullable=False),
        sa.Column("contact_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("assignee_id", sa.Uuid(), nullable=True),
        sa.Column("unread_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("waiting_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_reply_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('open', 'pending', 'resolved', 'closed')", name="status"
        ),
        sa.ForeignKeyConstraint(
            ["contact_id"],
            ["support_contacts.id"],
            name="fk_support_tickets_contact_id_support_contacts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["assignee_id"], ["users.id"], name="fk_support_tickets_assignee_id_users", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_support_tickets"),
        sa.UniqueConstraint("number", name="uq_support_tickets_number"),
    )
    op.create_index("ix_support_tickets_contact_id", "support_tickets", ["contact_id"])
    op.create_index(
        "uq_support_tickets_open_contact",
        "support_tickets",
        ["contact_id"],
        unique=True,
        postgresql_where=sa.text("status <> 'closed'"),
    )
    op.create_table(
        "support_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("image_path", sa.String(length=255), nullable=True),
        sa.Column("image_mime", sa.String(length=32), nullable=True),
        sa.Column("tg_message_id", sa.BigInteger(), nullable=True),
        sa.Column("delivery", sa.String(length=8), nullable=True),
        sa.Column("delivery_error", sa.Text(), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("direction IN ('in', 'out', 'note')", name="direction"),
        sa.CheckConstraint(
            "delivery IS NULL OR delivery IN ('sent', 'failed')", name="delivery"
        ),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["support_tickets.id"],
            name="fk_support_messages_ticket_id_support_tickets",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_id"], ["users.id"], name="fk_support_messages_author_id_users", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_support_messages"),
    )
    op.create_index("ix_support_messages_ticket_id", "support_messages", ["ticket_id"])


def downgrade() -> None:
    op.drop_table("support_messages")
    op.drop_table("support_tickets")
    op.drop_table("support_contacts")
