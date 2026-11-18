BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '012'
    ) THEN
        RAISE EXCEPTION 'Migration 012 already applied';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION create_credit_card_purchase(
    p_transaction_id UUID,
    p_installments_count SMALLINT,
    p_first_due_date DATE,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_household_id UUID;
    v_account_id UUID;
    v_amount NUMERIC(20,6);
    v_transaction_currency CHAR(3);
    v_account_currency CHAR(3);
    v_transaction_type VARCHAR(20);
    v_transaction_status VARCHAR(20);
    v_account_type VARCHAR(30);

    v_closing_day SMALLINT;
    v_due_day SMALLINT;
    v_month_offset SMALLINT;

    v_purchase_id UUID;
    v_statement_id UUID;

    v_installment_number INTEGER;
    v_installment_amount NUMERIC(20,6);
    v_base_amount NUMERIC(20,6);
    v_due_date DATE;

    v_closing_month DATE;
    v_due_month DATE;
    v_previous_month DATE;

    v_days_in_month INTEGER;
    v_previous_days INTEGER;

    v_closing_date DATE;
    v_period_start DATE;
    v_expected_due_date DATE;
BEGIN
    IF p_installments_count NOT BETWEEN 1 AND 240 THEN
        RAISE EXCEPTION 'Installments count must be between 1 and 240';
    END IF;

    SELECT
        t.household_id,
        t.account_id,
        t.amount,
        t.currency_code,
        t.transaction_type,
        t.status,
        a.currency_code,
        a.account_type,
        a.statement_closing_day,
        a.payment_due_day,
        a.payment_due_month_offset
    INTO
        v_household_id,
        v_account_id,
        v_amount,
        v_transaction_currency,
        v_transaction_type,
        v_transaction_status,
        v_account_currency,
        v_account_type,
        v_closing_day,
        v_due_day,
        v_month_offset
    FROM transactions t
    JOIN accounts a
      ON a.id = t.account_id
     AND a.household_id = t.household_id
    WHERE t.id = p_transaction_id
    FOR UPDATE OF t;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction not found';
    END IF;

    IF v_transaction_type <> 'expense'
       OR v_transaction_status <> 'posted'
       OR v_account_type <> 'credit_card'
    THEN
        RAISE EXCEPTION
            'Transaction must be a posted expense on a credit card';
    END IF;

    IF v_transaction_currency <> v_account_currency THEN
        RAISE EXCEPTION 'Transaction currency does not match card currency';
    END IF;

    IF v_closing_day IS NULL
       OR v_due_day IS NULL
       OR v_month_offset IS NULL
    THEN
        RAISE EXCEPTION 'Credit card billing cycle is not configured';
    END IF;

    IF p_first_due_date IS NULL THEN
        RAISE EXCEPTION 'First due date is required';
    END IF;

    -- Validar el día del primer vencimiento
    v_days_in_month := EXTRACT(
        DAY FROM (
            DATE_TRUNC('month', p_first_due_date)
            + INTERVAL '1 month - 1 day'
        )
    )::INTEGER;

    v_expected_due_date :=
        DATE_TRUNC('month', p_first_due_date)::DATE
        + LEAST(v_due_day, v_days_in_month) - 1;

    IF p_first_due_date <> v_expected_due_date THEN
        RAISE EXCEPTION
            'First due date does not match configured payment day (%)',
            v_expected_due_date;
    END IF;

    v_base_amount := ROUND(
        v_amount / p_installments_count,
        6
    );

    IF v_base_amount <= 0 THEN
        RAISE EXCEPTION
            'Installment amount is too small for the requested number of installments';
    END IF;

    INSERT INTO credit_card_purchases (
        household_id,
        transaction_id,
        installments_count,
        first_due_date,
        created_by
    )
    VALUES (
        v_household_id,
        p_transaction_id,
        p_installments_count,
        p_first_due_date,
        p_created_by
    )
    RETURNING id INTO v_purchase_id;

    FOR v_installment_number IN 1..p_installments_count LOOP

        v_due_date := (
            p_first_due_date
            + MAKE_INTERVAL(months => v_installment_number - 1)
        )::DATE;

        -- Importe de la última cuota ajustado por redondeo
        IF v_installment_number = p_installments_count THEN
            v_installment_amount :=
                v_amount
                - (v_base_amount * (p_installments_count - 1));
        ELSE
            v_installment_amount := v_base_amount;
        END IF;

        -- Mes de cierre correspondiente al vencimiento
        v_closing_month := (
            DATE_TRUNC('month', v_due_date)
            - MAKE_INTERVAL(months => v_month_offset)
        )::DATE;

        v_days_in_month := EXTRACT(
            DAY FROM (
                v_closing_month + INTERVAL '1 month - 1 day'
            )
        )::INTEGER;

        v_closing_date :=
            v_closing_month + LEAST(v_closing_day, v_days_in_month) - 1;

        -- Validar vencimiento según configuración de la tarjeta
        v_due_month := (
            v_closing_month
            + MAKE_INTERVAL(months => v_month_offset)
        )::DATE;

        v_days_in_month := EXTRACT(
            DAY FROM (
                v_due_month + INTERVAL '1 month - 1 day'
            )
        )::INTEGER;

        v_expected_due_date :=
            v_due_month + LEAST(v_due_day, v_days_in_month) - 1;

        IF v_due_date <> v_expected_due_date THEN
            RAISE EXCEPTION
                'Installment due date % does not match configured card cycle %',
                v_due_date,
                v_expected_due_date;
        END IF;

        -- Inicio del período: día siguiente al cierre anterior
        v_previous_month := (
            v_closing_month - INTERVAL '1 month'
        )::DATE;

        v_previous_days := EXTRACT(
            DAY FROM (
                v_previous_month + INTERVAL '1 month - 1 day'
            )
        )::INTEGER;

        v_period_start :=
            v_previous_month
            + LEAST(v_closing_day, v_previous_days);

        -- Crear estado de cuenta si todavía no existe
        INSERT INTO credit_card_statements (
            household_id,
            account_id,
            period_start,
            period_end,
            closing_date,
            due_date,
            created_by
        )
        VALUES (
            v_household_id,
            v_account_id,
            v_period_start,
            v_closing_date,
            v_closing_date,
            v_due_date,
            p_created_by
        )
        ON CONFLICT (account_id, period_start, period_end)
        DO NOTHING;

        SELECT id
        INTO v_statement_id
        FROM credit_card_statements
        WHERE account_id = v_account_id
          AND period_start = v_period_start
          AND period_end = v_closing_date;

        INSERT INTO credit_card_installments (
            household_id,
            purchase_id,
            installment_number,
            due_date,
            amount,
            statement_id
        )
        VALUES (
            v_household_id,
            v_purchase_id,
            v_installment_number,
            v_due_date,
            v_installment_amount,
            v_statement_id
        );

    END LOOP;

    RETURN v_purchase_id;
END;
$$;

INSERT INTO schema_migrations (version, description)
VALUES ('012', 'Generate credit card installments and statements automatically');

COMMIT;
