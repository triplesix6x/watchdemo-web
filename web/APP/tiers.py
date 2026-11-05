"""Prelaunch public matrix, not Windows quota enforcement.

IDs remain compatible. The desktop access.rs implementation must be updated
separately; no demo history, group content or local progress is collected here.
"""

from APP.constants import SubscriptionTier

TIER_ORDER: tuple[SubscriptionTier, ...] = (
    SubscriptionTier.BASIC,
    SubscriptionTier.PLUS,
    SubscriptionTier.PRO,
)

FEATURE_MIN_TIER: dict[str, SubscriptionTier] = {
    "demo_import": SubscriptionTier.BASIC,
    "content_search": SubscriptionTier.BASIC,
    "replay2d": SubscriptionTier.BASIC,
    "advanced_stats": SubscriptionTier.BASIC,
    "demo_groups": SubscriptionTier.BASIC,
    "custom_sets": SubscriptionTier.BASIC,
    "voice": SubscriptionTier.PLUS,
    "notes": SubscriptionTier.PLUS,
    "playbooks": SubscriptionTier.PRO,
}

MONTHLY_LIMITS: dict[tuple[str, SubscriptionTier], int] = {
    ("demo_import", SubscriptionTier.BASIC): 5,
    ("demo_import", SubscriptionTier.PLUS): 15,
    ("custom_sets", SubscriptionTier.BASIC): 1,
    ("custom_sets", SubscriptionTier.PLUS): 2,
}
QUANTITY_LIMITS: dict[tuple[str, SubscriptionTier], int] = {
    ("demo_groups", SubscriptionTier.BASIC): 2,
    ("demo_groups", SubscriptionTier.PLUS): 5,
}
PRICES_RUB = {SubscriptionTier.BASIC: 0, SubscriptionTier.PLUS: 349, SubscriptionTier.PRO: 469}


def tier_matrix() -> list[dict]:
    rank = {tier: i for i, tier in enumerate(TIER_ORDER)}
    return [
        {
            "id": tier.value,
            "price_rub": PRICES_RUB[tier],
            "sales_open": False,
            "features": [
                {
                    "id": feature,
                    "scope": "account",
                    "allowed": rank[tier] >= rank[min_tier],
                    "min_tier": min_tier.value,
                    "monthly_limit": MONTHLY_LIMITS.get((feature, tier)),
                    "limit_period": (
                        "calendar_month" if tier == SubscriptionTier.BASIC else "activation_month"
                    ) if (feature, tier) in MONTHLY_LIMITS else None,
                    "limit": QUANTITY_LIMITS.get((feature, tier)),
                }
                for feature, min_tier in FEATURE_MIN_TIER.items()
            ],
        }
        for tier in TIER_ORDER
    ]
