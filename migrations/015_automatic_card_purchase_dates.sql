
-- Migration 015: Automatic credit card purchase dates

BEGIN;

-- =========================================================
-- 1. Household timezone
-- =========================================================

ALTER TABLE households
ADD COLUMN time_zone VARCHAR(64)
NOT NULL DEFAULT 'America/Montevideo';

COMMENT ON COLUMN households.time_zone IS
'Timezone used to determine local financial dates and credit card billing cycles';


-- =========================================================
-- 2. Automatic first due date
-- =========================================================

CREATE OR REPLACE FUNCTION public.create_credit_card_purchase_auto(
    p_transaction_id UUID,
    p_installments_count SMALLINT,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $function$
DECLARE
    v_household_id UUID;
    v_occurred_at TIMESTAMPTZ;
    v_timezone VARCHAR(64);

    v_transaction_type VARCHAR(20);
    v_transaction_status VARCHAR(20);
    v_transaction_currency CHAR(3);
    v_account_currency CHAR(3);
    v_account_type VARCHAR(30);

    v_closing_day SMALLINT;
    v_due_day SMALLINT;
    v_month_offset SMALLINT;

    v_local_purchase_date DATE;
    v_closing_month DATE;
    v_closing_date DATE;
    v_due_month DATE;
    v_first_due_date DATE;

    v_days_in_month INTEGER;

BEGIN
    IF p_installments_count IS NULL
       OR p_installments_count NOT BETWEEN 1 AND 240 THEN
        RAISE EXCEPTION
            'Installments count must be between 1 and 240';
    END IF;

    -- Read and lock the transaction and its billing configuration.
    SELECT
        t.household_id,
        t.occurred_at,
        t.transaction_type,
        t.status,
        t.currency_code,
        a.currency_code,
        a.account_type,
        a.statement_closing_day,
        a.payment_due_day,
        a.payment_due_month_offset,
        h.time_zone
    INTO
        v_household_id,
        v_occurred_at,
        v_transaction_type,
        v_transaction_status,
        v_transaction_currency,
        v_account_currency,
        v_account_type,
        v_closing_day,
        v_due_day,
        v_month_offset,
        v_timezone
    FROM transactions t
    JOIN accounts a
      ON a.id = t.account_id
     AND a.household_id = t.household_id
    JOIN households h
      ON h.id = t.household_id
    WHERE t.id = p_transaction_id
    FOR UPDATE OF t, a, h;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction not found';
    END IF;

    IF v_transaction_type <> 'expense'
       OR v_transaction_status <> 'posted'
       OR v_account_type <> 'credit_card' THEN
        RAISE EXCEPTION
            'Transaction must be a posted expense on a credit card';
    END IF;

    IF v_transaction_currency <> v_account_currency THEN
        RAISE EXCEPTION
            'Transaction currency does not match card currency';
    END IF;

    IF v_closing_day IS NULL
       OR v_due_day IS NULL
       OR v_month_offset IS NULL THEN
        RAISE EXCEPTION
            'Credit card billing cycle is not configured';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_timezone_names
        WHERE name = v_timezone
    ) THEN
        RAISE EXCEPTION
            'Invalid household timezone: %', v_timezone;
    END IF;

    -- Convert transaction timestamp to the household local date.
    v_local_purchase_date :=
        (v_occurred_at AT TIME ZONE v_timezone)::DATE;

    -- Determine the closing date of the purchase month.
    v_closing_month :=
        DATE_TRUNC('month', v_local_purchase_date)::DATE;

    v_days_in_month := EXTRACT(
        DAY FROM (
            v_closing_month + INTERVAL '1 month - 1 day'
        )
    )::INTEGER;

    v_closing_date :=
        v_closing_month
        + LEAST(v_closing_day, v_days_in_month) - 1;

    -- Purchases after the closing date belong to the next cycle.
    IF v_local_purchase_date > v_closing_date THEN
        v_closing_month :=
            (v_closing_month + INTERVAL '1 month')::DATE;
    END IF;

    -- Determine the month in which the first installment is due.
    v_due_month := (
        v_closing_month
        + MAKE_INTERVAL(months => v_month_offset)
    )::DATE;

    v_days_in_month := EXTRACT(
        DAY FROM (
            v_due_month + INTERVAL '1 month - 1 day'
        )
    )::INTEGER;

    v_first_due_date :=
        v_due_month
        + LEAST(v_due_day, v_days_in_month) - 1;

    -- Delegate installment generation to the existing function.
    RETURN public.create_credit_card_purchase(
        p_transaction_id,
        p_installments_count,
        v_first_due_date,
        p_created_by
    );

END;
$function$;

COMMENT ON FUNCTION public.create_credit_card_purchase_auto(
    UUID, SMALLINT, UUID
) IS
'Automatically determines the first installment due date from the household timezone and credit card billing cycle.';

INSERT INTO schema_migrations (version, description)
VALUES (
    '015',
    'Add household timezone and automatic credit card purchase dates'
);

COMMIT;
