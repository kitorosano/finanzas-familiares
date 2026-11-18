
-- Migration 013: Account balances and household net worth

BEGIN;

-- =========================================================
-- 1. Account balances
-- =========================================================

CREATE OR REPLACE VIEW account_balances AS
WITH ledger_movements AS (
    -- Movements affecting the source account
    SELECT
        t.account_id,
        t.household_id,
        CASE t.transaction_type
            WHEN 'income' THEN t.amount
            WHEN 'expense' THEN -t.amount
            WHEN 'transfer' THEN -t.amount
        END AS balance_change
    FROM transactions t
    WHERE t.status = 'posted'

    UNION ALL

    -- Transfers received by destination accounts
    SELECT
        t.transfer_account_id AS account_id,
        t.household_id,
        t.transfer_amount AS balance_change
    FROM transactions t
    WHERE t.status = 'posted'
      AND t.transaction_type = 'transfer'
),
movement_totals AS (
    SELECT
        account_id,
        household_id,
        SUM(balance_change) AS movement_balance
    FROM ledger_movements
    GROUP BY account_id, household_id
)
SELECT
    a.id AS account_id,
    a.household_id,
    a.name AS account_name,
    a.account_type,
    a.currency_code,
    a.holder_user_id,
    a.is_active,
    a.include_in_net_worth,
    a.account_type = 'credit_card' AS is_liability,

    a.opening_balance
        + COALESCE(m.movement_balance, 0) AS balance,

    h.base_currency_code,

    CASE
        WHEN a.currency_code = h.base_currency_code THEN 1::NUMERIC
        ELSE fx.rate_to_base
    END AS exchange_rate_to_base,

    CASE
        WHEN a.currency_code = h.base_currency_code
            THEN a.opening_balance
                 + COALESCE(m.movement_balance, 0)

        WHEN a.opening_balance
             + COALESCE(m.movement_balance, 0) = 0
            THEN 0::NUMERIC

        WHEN fx.rate_to_base IS NOT NULL
            THEN ROUND(
                (a.opening_balance
                 + COALESCE(m.movement_balance, 0))
                * fx.rate_to_base,
                6
            )

        ELSE NULL
    END AS balance_base,

    CASE
        WHEN a.currency_code = h.base_currency_code
            THEN 'base_currency'
        WHEN a.opening_balance
             + COALESCE(m.movement_balance, 0) = 0
            THEN 'zero_balance'
        WHEN fx.rate_to_base IS NOT NULL
            THEN 'converted'
        ELSE 'missing_rate'
    END AS conversion_status

FROM accounts a
JOIN households h
    ON h.id = a.household_id
LEFT JOIN movement_totals m
    ON m.account_id = a.id
   AND m.household_id = a.household_id

LEFT JOIN LATERAL (
    SELECT
        CASE
            WHEN er.from_currency_code = a.currency_code
                THEN er.rate
            ELSE 1 / er.rate
        END AS rate_to_base
    FROM exchange_rates er
    WHERE er.effective_date <= CURRENT_DATE
      AND (
          (
              er.from_currency_code = a.currency_code
              AND er.to_currency_code = h.base_currency_code
          )
          OR
          (
              er.from_currency_code = h.base_currency_code
              AND er.to_currency_code = a.currency_code
          )
      )
    ORDER BY
	er.effective_date DESC,
        CASE
            WHEN er.from_currency_code = a.currency_code THEN 0
            ELSE 1
        END,
        er.created_at DESC
    LIMIT 1
) fx ON TRUE;


-- =========================================================
-- 2. Household net worth
-- =========================================================

CREATE OR REPLACE VIEW household_net_worth AS
SELECT
    h.id AS household_id,
    h.name AS household_name,
    h.base_currency_code,

    COALESCE(
        SUM(ab.balance_base)
            FILTER (WHERE ab.include_in_net_worth),
        0
    ) AS net_worth_partial,

    COUNT(ab.account_id)
        FILTER (
            WHERE ab.include_in_net_worth
              AND ab.balance <> 0
              AND ab.balance_base IS NULL
        ) AS accounts_pending_conversion,

    CASE
        WHEN COUNT(ab.account_id)
            FILTER (
                WHERE ab.include_in_net_worth
                  AND ab.balance <> 0
                  AND ab.balance_base IS NULL
            ) = 0
        THEN COALESCE(
            SUM(ab.balance_base)
                FILTER (WHERE ab.include_in_net_worth),
            0
        )
        ELSE NULL
    END AS net_worth,

    COUNT(ab.account_id)
        FILTER (WHERE ab.include_in_net_worth)
        AS included_accounts

FROM households h
LEFT JOIN account_balances ab
    ON ab.household_id = h.id
GROUP BY
    h.id,
    h.name,
    h.base_currency_code;

INSERT INTO schema_migrations (version, description)
VALUES (
    '013',
    'Create account balances and household net worth views'
);

COMMIT;
