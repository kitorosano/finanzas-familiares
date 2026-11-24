
BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '019'
    ) THEN
        RAISE EXCEPTION 'Migration 019 already applied';
    END IF;
END;
$$;

-- Preserve the budget conversion into the household base currency.
ALTER TABLE budgets
ADD COLUMN exchange_rate_to_base NUMERIC(20,10),
ADD COLUMN amount_base NUMERIC(20,6);

-- Existing budgets already denominated in base currency
-- can be backfilled without needing an exchange rate.
UPDATE budgets b
SET
    exchange_rate_to_base = 1,
    amount_base = ROUND(b.amount, 6)
FROM households h
WHERE h.id = b.household_id
  AND b.currency_code = h.base_currency_code;

-- Both conversion fields must be null or form a valid snapshot.
ALTER TABLE budgets
ADD CONSTRAINT budgets_conversion_snapshot_check
CHECK (
    (
        exchange_rate_to_base IS NULL
        AND amount_base IS NULL
    )
    OR
    (
        exchange_rate_to_base IS NOT NULL
        AND exchange_rate_to_base > 0
        AND amount_base IS NOT NULL
        AND amount_base > 0
        AND amount_base = ROUND(
            amount * exchange_rate_to_base,
            6
        )
    )
);

INSERT INTO schema_migrations (version, description)
VALUES (
    '019',
    'Store budget conversion snapshots in household base currency'
);

COMMIT;
