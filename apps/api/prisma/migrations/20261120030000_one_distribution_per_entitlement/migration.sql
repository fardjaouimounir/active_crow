-- One entitlement, one distribution: a gift entitlement is fulfilled by at most one stock movement,
-- so the same gift can never be deducted from a holder's stock twice.
-- Declared in schema.prisma as @unique(map: "stock_movements_one_per_entitlement").
CREATE UNIQUE INDEX stock_movements_one_per_entitlement
  ON stock_movements (gift_entitlement_id) WHERE gift_entitlement_id IS NOT NULL;
