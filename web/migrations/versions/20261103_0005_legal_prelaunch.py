"""Immutable legal publications, acceptance evidence and durable notification outbox.

Revision ID: 0005_legal_prelaunch
Revises: 0004_support
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "0005_legal_prelaunch"
down_revision = "0004_support"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "legal_document_snapshots",
        sa.Column("document_id", sa.String(16), primary_key=True),
        sa.Column("revision", sa.String(100), primary_key=True),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("document", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("document_id", "revision", "sha256"),
    )
    op.create_table(
        "legal_activations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("sequence", sa.Integer(), nullable=False, unique=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("catalog_sha256", sa.String(64), nullable=False),
        sa.Column("release", postgresql.JSONB(), nullable=False),
        sa.Column("documents", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("sequence > 0", name="positive_sequence"),
    )
    op.create_table(
        "legal_acceptances",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("activation_id", sa.Uuid(), sa.ForeignKey("legal_activations.id"), nullable=False),
        sa.Column("document_id", sa.String(16), nullable=False),
        sa.Column("revision", sa.String(100), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("action", sa.String(24), nullable=False),
        sa.Column("locale", sa.String(5), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("retain_until", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id", "revision", "sha256"],
            ["legal_document_snapshots.document_id", "legal_document_snapshots.revision", "legal_document_snapshots.sha256"],
        ),
        sa.CheckConstraint("action = 'accept_terms'", name="accept_terms_action"),
        sa.CheckConstraint("retain_until > created_at", name="positive_retention"),
    )
    op.create_index("ix_legal_acceptances_user_id", "legal_acceptances", ["user_id"])
    op.create_index("ix_legal_acceptances_retain_until", "legal_acceptances", ["retain_until"])
    op.create_table(
        "legal_notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("activation_id", sa.Uuid(), sa.ForeignKey("legal_activations.id"), nullable=False),
        sa.Column("document_id", sa.String(16), nullable=False),
        sa.Column("revision", sa.String(100), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["document_id", "revision"],
            ["legal_document_snapshots.document_id", "legal_document_snapshots.revision"],
        ),
        sa.UniqueConstraint("user_id", "document_id", "revision"),
        sa.CheckConstraint("status IN ('pending', 'published', 'suppressed')", name="notification_status"),
    )
    op.create_index("ix_legal_notifications_status", "legal_notifications", ["status"])
    op.execute("""
        CREATE FUNCTION legal_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Published legal records are immutable';
        END $$
    """)
    for table in ("legal_document_snapshots", "legal_activations"):
        op.execute(f"CREATE TRIGGER legal_immutable BEFORE UPDATE OR DELETE ON {table} "
                   "FOR EACH ROW EXECUTE FUNCTION legal_immutable_record()")
    op.execute("""
        CREATE FUNCTION legal_evidence_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND OLD.retain_until <= CURRENT_TIMESTAMP THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'Legal evidence is append-only until approved retention expires';
        END $$
    """)
    op.execute("CREATE TRIGGER legal_append_only BEFORE UPDATE OR DELETE ON legal_acceptances "
               "FOR EACH ROW EXECUTE FUNCTION legal_evidence_append_only()")


def downgrade() -> None:
    op.drop_table("legal_notifications")
    op.drop_table("legal_acceptances")
    op.drop_table("legal_activations")
    op.drop_table("legal_document_snapshots")
    op.execute("DROP FUNCTION legal_evidence_append_only()")
    op.execute("DROP FUNCTION legal_immutable_record()")
