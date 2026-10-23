"""Матрица фич и лимитов по тарифам для публичной страницы цен.

Синхронизировать с приложением: D:\\demo-manager\\src-tauri\\src\\core\\access.rs
(`Feature`, `min_tier`, `monthly_limit`). Идентификаторы фич совпадают с
serde-именами `Feature` (snake_case), чтобы сайт и клиент говорили об одном.
Сервер эти правила не применяет, гейты живут в клиенте; здесь только витрина.
"""

from APP.constants import SubscriptionTier

TIER_ORDER: tuple[SubscriptionTier, ...] = (
    SubscriptionTier.BASIC,
    SubscriptionTier.PLUS,
    SubscriptionTier.PRO,
)

# Порядок строк в таблице цен. Ключ — минимальный тариф фичи.
FEATURE_MIN_TIER: dict[str, SubscriptionTier] = {
    "demo_import": SubscriptionTier.BASIC,
    "content_search": SubscriptionTier.BASIC,
    "replay2d": SubscriptionTier.PLUS,
    "advanced_stats": SubscriptionTier.PRO,
}

# Лимит за календарный месяц; отсутствие пары означает «без лимита».
MONTHLY_LIMITS: dict[tuple[str, SubscriptionTier], int] = {
    ("demo_import", SubscriptionTier.BASIC): 10,
    ("demo_import", SubscriptionTier.PLUS): 100,
}


def tier_matrix() -> list[dict]:
    """Строит матрицу «тариф → фичи» в форме `FeatureView` клиента.

    Returns:
        Список тарифов по возрастанию; у каждого все фичи с флагом
        доступности, минимальным тарифом и месячным лимитом (`None` = без лимита).
    """
    rank = {tier: i for i, tier in enumerate(TIER_ORDER)}
    return [
        {
            "id": tier.value,
            "features": [
                {
                    "id": feature,
                    "allowed": rank[tier] >= rank[min_tier],
                    "min_tier": min_tier.value,
                    "monthly_limit": MONTHLY_LIMITS.get((feature, tier)),
                }
                for feature, min_tier in FEATURE_MIN_TIER.items()
            ],
        }
        for tier in TIER_ORDER
    ]
