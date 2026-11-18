
-- Migration 016: Credit card payments, advances and automatic application

BEGIN;

-- =========================================================
-- 1. Strengthen credit card payment validation
-- =========================================================

CREATE OR REPLACE FUNCTION public.validate_credit_card_statement_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    v_statement_account UUID;
    v_statement_total NUMERIC(20,6);
    v_statement_currency CHAR(3);

    v_transfer_account UUID;
    v_transfer_amount NUMERIC(20,6);
    v_transaction_amount NUMERIC(20,6);
    v_transaction_currency CHAR(3);
    v_transfer_currency CHAR(3);

    v_transaction_type VARCHAR(20);
    v_transaction_status VARCHAR(20);
    v_source_account_type VARCHAR(30);

    v_statement_allocated NUMERIC(20,6);
    v_transfer_allocated NUMERIC(20,6);
BEGIN
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
        RAISE EXCEPTION 'El importe asignado debe ser mayor que cero';
    END IF;

    SELECT
        s.account_id,
        s.total_due,
        a.currency_code
    INTO
        v_statement_account,
        v_statement_total,
        v_statement_currency
    FROM credit_card_statements s
    JOIN accounts a
      ON a.id = s.account_id
     AND a.household_id = s.household_id
    WHERE s.id = NEW.statement_id
      AND s.household_id = NEW.household_id
    FOR UPDATE OF s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Credit card statement not found';
    END IF;

    SELECT
        t.transaction_type,
        t.status,
        t.transfer_account_id,
        t.transfer_amount,
        t.amount,
        t.currency_code,
        t.transfer_currency_code,
        src.account_type
    INTO
        v_transaction_type,
        v_transaction_status,
        v_transfer_account,
        v_transfer_amount,
        v_transaction_amount,
        v_transaction_currency,
        v_transfer_currency,
        v_source_account_type
    FROM transactions t
    JOIN accounts src
      ON src.id = t.account_id
     AND src.household_id = t.household_id
    WHERE t.id = NEW.transaction_id
      AND t.household_id = NEW.household_id
    FOR UPDATE OF t;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment transaction not found';
    END IF;

    IF v_transaction_type <> 'transfer'
       OR v_transaction_status <> 'posted'
       OR v_transfer_account <> v_statement_account THEN
        RAISE EXCEPTION
            'Payment must be a posted transfer to the statement credit card';
    END IF;

    IF v_source_account_type = 'credit_card' THEN
        RAISE EXCEPTION
            'A credit card cannot be used as the source of another card payment';
    END IF;

    IF v_transaction_currency <> v_statement_currency
       OR v_transfer_currency <> v_statement_currency
       OR v_transaction_amount <> v_transfer_amount THEN
        RAISE EXCEPTION
            'Credit card payments must use the same currency and amount on both accounts';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_statement_allocated
    FROM credit_card_statement_payments
    WHERE statement_id = NEW.statement_id
      AND id <> NEW.id;

    IF v_statement_allocated + NEW.amount > v_statement_total THEN
        RAISE EXCEPTION
            'Payment allocations exceed statement outstanding amount';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_transfer_allocated
    FROM credit_card_statement_payments
    WHERE transaction_id = NEW.transaction_id
      AND id <> NEW.id;

    IF v_transfer_allocated + NEW.amount > v_transfer_amount THEN
        RAISE EXCEPTION
            'Payment allocations exceed the transfer amount';
    END IF;

    RETURN NEW;
END;
$function$;


-- =========================================================
-- 2. Apply unapplied advances to a statement
-- =========================================================

CREATE OR REPLACE FUNCTION public.apply_credit_card_advances_to_statement(
    p_statement_id UUID
)
RETURNS NUMERIC(20,6)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_household_id UUID;
    v_card_account_id UUID;
    v_card_currency CHAR(3);
    v_total_due NUMERIC(20,6);

    v_paid NUMERIC(20,6);
    v_outstanding NUMERIC(20,6);

    v_advance RECORD;
    v_allocated NUMERIC(20,6);
    v_available NUMERIC(20,6);
    v_allocation NUMERIC(20,6);
    v_total_applied NUMERIC(20,6) := 0;
BEGIN
    SELECT
        s.household_id,
        s.account_id,
        s.total_due,
        a.currency_code
    INTO
        v_household_id,
        v_card_account_id,
        v_total_due,
        v_card_currency
    FROM credit_card_statements s
    JOIN accounts a
      ON a.id = s.account_id
     AND a.household_id = s.household_id
    WHERE s.id = p_statement_id
    FOR UPDATE OF s;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Credit card statement not found';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM credit_card_statement_payments
    WHERE statement_id = p_statement_id;

    v_outstanding := ROUND(v_total_due - v_paid, 6);

    IF v_outstanding <= 0 THEN
        RETURN 0;
    END IF;

    -- Oldest unapplied advances are used first.
    FOR v_advance IN
        SELECT
            t.id,
            t.transfer_amount
        FROM transactions t
        JOIN accounts src
          ON src.id = t.account_id
         AND src.household_id = t.household_id
        WHERE t.household_id = v_household_id
          AND t.transaction_type = 'transfer'
          AND t.status = 'posted'
          AND t.transfer_account_id = v_card_account_id
          AND t.currency_code = v_card_currency
          AND t.transfer_currency_code = v_card_currency
          AND t.amount = t.transfer_amount
          AND src.account_type <> 'credit_card'
          AND t.transfer_amount > (
              SELECT COALESCE(SUM(p.amount), 0)
              FROM credit_card_statement_payments p
              WHERE p.transaction_id = t.id
          )
        ORDER BY
            t.occurred_at,
            t.created_at,
            t.id
        FOR UPDATE OF t
    LOOP
        SELECT COALESCE(SUM(amount), 0)
        INTO v_allocated
        FROM credit_card_statement_payments
        WHERE transaction_id = v_advance.id;

        v_available := ROUND(
            v_advance.transfer_amount - v_allocated,
            6
        );

        IF v_available <= 0 THEN
            CONTINUE;
        END IF;

        v_allocation := LEAST(v_available, v_outstanding);

        IF v_allocation <= 0 THEN
            EXIT;
        END IF;

        INSERT INTO credit_card_statement_payments (
            household_id,
            statement_id,
            transaction_id,
            amount,
            notes
        )
        VALUES (
            v_household_id,
            p_statement_id,
            v_advance.id,
            v_allocation,
            'Aplicación automática de saldo a favor'
        )
        ON CONFLICT (statement_id, transaction_id)
        DO UPDATE SET
            amount =
                credit_card_statement_payments.amount
                + EXCLUDED.amount,
            notes = COALESCE(
                credit_card_statement_payments.notes,
                EXCLUDED.notes
            );

        v_outstanding := ROUND(v_outstanding - v_allocation, 6);
        v_total_applied := v_total_applied + v_allocation;

        EXIT WHEN v_outstanding <= 0;
    END LOOP;

    RETURN v_total_applied;
END;
$function$;


-- =========================================================
-- 3. Automatically apply advances when statement total grows
-- =========================================================

CREATE OR REPLACE FUNCTION public.auto_apply_credit_card_advances_on_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.total_due > 0 THEN
        PERFORM public.apply_credit_card_advances_to_statement(NEW.id);
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS credit_card_statement_auto_apply_advances
ON credit_card_statements;

CREATE TRIGGER credit_card_statement_auto_apply_advances
AFTER INSERT OR UPDATE OF total_due
ON credit_card_statements
FOR EACH ROW
EXECUTE FUNCTION public.auto_apply_credit_card_advances_on_statement();


-- =========================================================
-- 4. Replace statement payment function with consistent lock order
-- =========================================================

CREATE OR REPLACE FUNCTION public.pay_credit_card_statement(
    p_statement_id UUID,
    p_source_account_id UUID,
    p_amount NUMERIC,
    p_exchange_rate_to_base NUMERIC,
    p_occurred_at TIMESTAMPTZ DEFAULT NOW(),
    p_created_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $function$
DECLARE
    v_household_id UUID;
    v_card_account_id UUID;
    v_card_name VARCHAR(100);
    v_card_type VARCHAR(30);
    v_card_currency CHAR(3);
    v_card_active BOOLEAN;

    v_source_type VARCHAR(30);
    v_source_currency CHAR(3);
    v_source_active BOOLEAN;

    v_base_currency CHAR(3);

    v_total_due NUMERIC(20,6);
    v_total_paid NUMERIC(20,6);
    v_outstanding NUMERIC(20,6);

    v_amount NUMERIC(20,6);
    v_exchange_rate NUMERIC(20,10);
    v_amount_base NUMERIC(20,6);

    v_transaction_id UUID;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'El importe del pago debe ser mayor que cero';
    END IF;

    IF p_exchange_rate_to_base IS NULL
       OR p_exchange_rate_to_base <= 0 THEN
        RAISE EXCEPTION 'El tipo de cambio debe ser mayor que cero';
    END IF;

    IF p_occurred_at IS NULL THEN
        RAISE EXCEPTION 'La fecha del pago es obligatoria';
    END IF;

    v_amount := ROUND(p_amount, 6);
    v_exchange_rate := ROUND(p_exchange_rate_to_base, 10);

    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'El importe redondeado debe ser mayor que cero';
    END IF;

    -- First identify the statement and its card.
    SELECT household_id, account_id
    INTO v_household_id, v_card_account_id
    FROM credit_card_statements
    WHERE id = p_statement_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró el estado de cuenta';
    END IF;

    -- Lock the card before locking the statement.
    SELECT
        name,
        account_type,
        currency_code,
        is_active
    INTO
        v_card_name,
        v_card_type,
        v_card_currency,
        v_card_active
    FROM accounts
    WHERE id = v_card_account_id
      AND household_id = v_household_id
    FOR UPDATE;

    IF NOT FOUND OR v_card_type <> 'credit_card' THEN
        RAISE EXCEPTION 'El estado de cuenta no pertenece a una tarjeta válida';
    END IF;

    IF NOT v_card_active THEN
        RAISE EXCEPTION 'La tarjeta de crédito está inactiva';
    END IF;

    -- Lock the statement after the card.
    SELECT total_due
    INTO v_total_due
    FROM credit_card_statements
    WHERE id = p_statement_id
      AND household_id = v_household_id
      AND account_id = v_card_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El estado de cuenta cambió o ya no existe';
    END IF;

    -- Apply any older advances before calculating the remaining debt.
    PERFORM public.apply_credit_card_advances_to_statement(p_statement_id);

    SELECT COALESCE(SUM(amount), 0)
    INTO v_total_paid
    FROM credit_card_statement_payments
    WHERE statement_id = p_statement_id;

    v_outstanding := ROUND(v_total_due - v_total_paid, 6);

    IF v_outstanding <= 0 THEN
        RAISE EXCEPTION 'El estado de cuenta ya está completamente pagado';
    END IF;

    IF v_amount > v_outstanding THEN
        RAISE EXCEPTION
            'El pago (%) supera la deuda pendiente (%)',
            v_amount,
            v_outstanding;
    END IF;

    -- Lock and validate source account.
    SELECT account_type, currency_code, is_active
    INTO v_source_type, v_source_currency, v_source_active
    FROM accounts
    WHERE id = p_source_account_id
      AND household_id = v_household_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró la cuenta de origen en el hogar';
    END IF;

    IF NOT v_source_active THEN
        RAISE EXCEPTION 'La cuenta de origen está inactiva';
    END IF;

    IF v_source_type = 'credit_card' THEN
        RAISE EXCEPTION 'La cuenta de origen no puede ser una tarjeta de crédito';
    END IF;

    IF v_source_currency <> v_card_currency THEN
        RAISE EXCEPTION 'La cuenta de origen y la tarjeta deben usar la misma moneda';
    END IF;

    SELECT base_currency_code
    INTO v_base_currency
    FROM households
    WHERE id = v_household_id;

    IF v_card_currency = v_base_currency
       AND v_exchange_rate <> 1 THEN
        RAISE EXCEPTION
            'La tasa de cambio debe ser 1 para la moneda base (%)',
            v_base_currency;
    END IF;

    v_amount_base := ROUND(v_amount * v_exchange_rate, 6);

    INSERT INTO transactions (
        household_id,
        transaction_type,
        status,
        occurred_at,
        description,
        amount,
        currency_code,
        exchange_rate_to_base,
        amount_base,
        account_id,
        category_id,
        transfer_account_id,
        transfer_amount,
        transfer_currency_code,
        transfer_exchange_rate_to_base,
        transfer_amount_base,
        notes,
        created_by
    )
    VALUES (
        v_household_id,
        'transfer',
        'posted',
        p_occurred_at,
        'Pago de tarjeta: ' || v_card_name,
        v_amount,
        v_source_currency,
        v_exchange_rate,
        v_amount_base,
        p_source_account_id,
        NULL,
        v_card_account_id,
        v_amount,
        v_card_currency,
        v_exchange_rate,
        v_amount_base,
        p_notes,
        p_created_by
    )
    RETURNING id INTO v_transaction_id;

    INSERT INTO credit_card_statement_payments (
        household_id,
        statement_id,
        transaction_id,
        amount,
        notes
    )
    VALUES (
        v_household_id,
        p_statement_id,
        v_transaction_id,
        v_amount,
        p_notes
    );

    RETURN v_transaction_id;
END;
$function$;


-- =========================================================
-- 5. Pay or advance money to a credit card
-- =========================================================

CREATE OR REPLACE FUNCTION public.pay_credit_card(
    p_card_account_id UUID,
    p_source_account_id UUID,
    p_amount NUMERIC,
    p_exchange_rate_to_base NUMERIC,
    p_occurred_at TIMESTAMPTZ DEFAULT NOW(),
    p_created_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $function$
DECLARE
    v_household_id UUID;
    v_card_name VARCHAR(100);
    v_card_currency CHAR(3);
    v_card_active BOOLEAN;

    v_source_type VARCHAR(30);
    v_source_currency CHAR(3);
    v_source_active BOOLEAN;

    v_base_currency CHAR(3);

    v_amount NUMERIC(20,6);
    v_exchange_rate NUMERIC(20,10);
    v_amount_base NUMERIC(20,6);
    v_remaining NUMERIC(20,6);
    v_allocation NUMERIC(20,6);

    v_statement RECORD;
    v_statement_id UUID;
    v_transaction_id UUID;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'El importe debe ser mayor que cero';
    END IF;

    IF p_exchange_rate_to_base IS NULL
       OR p_exchange_rate_to_base <= 0 THEN
        RAISE EXCEPTION 'El tipo de cambio debe ser mayor que cero';
    END IF;

    IF p_occurred_at IS NULL THEN
        RAISE EXCEPTION 'La fecha del pago es obligatoria';
    END IF;

    v_amount := ROUND(p_amount, 6);
    v_exchange_rate := ROUND(p_exchange_rate_to_base, 10);

    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'El importe redondeado debe ser mayor que cero';
    END IF;

    -- Lock the credit card first. This serializes payments and purchases.
    SELECT
        household_id,
        name,
        currency_code,
        is_active
    INTO
        v_household_id,
        v_card_name,
        v_card_currency,
        v_card_active
    FROM accounts
    WHERE id = p_card_account_id
      AND account_type = 'credit_card'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró la tarjeta de crédito';
    END IF;

    IF NOT v_card_active THEN
        RAISE EXCEPTION 'La tarjeta de crédito está inactiva';
    END IF;

    -- Lock and validate the source account.
    SELECT account_type, currency_code, is_active
    INTO v_source_type, v_source_currency, v_source_active
    FROM accounts
    WHERE id = p_source_account_id
      AND household_id = v_household_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró la cuenta de origen en el hogar';
    END IF;

    IF NOT v_source_active THEN
        RAISE EXCEPTION 'La cuenta de origen está inactiva';
    END IF;

    IF v_source_type = 'credit_card' THEN
        RAISE EXCEPTION 'La cuenta de origen no puede ser otra tarjeta de crédito';
    END IF;

    IF v_source_currency <> v_card_currency THEN
        RAISE EXCEPTION 'La cuenta de origen y la tarjeta deben usar la misma moneda';
    END IF;

    SELECT base_currency_code
    INTO v_base_currency
    FROM households
    WHERE id = v_household_id;

    IF v_card_currency = v_base_currency
       AND v_exchange_rate <> 1 THEN
        RAISE EXCEPTION
            'La tasa de cambio debe ser 1 para la moneda base (%)',
            v_base_currency;
    END IF;

    v_amount_base := ROUND(v_amount * v_exchange_rate, 6);

    -- Lock all existing statements in chronological order.
    PERFORM s.id
    FROM credit_card_statements s
    WHERE s.household_id = v_household_id
      AND s.account_id = p_card_account_id
    ORDER BY s.due_date, s.closing_date, s.id
    FOR UPDATE OF s;

    -- Apply older unallocated advances before creating a new payment.
    FOR v_statement_id IN
        SELECT s.id
        FROM credit_card_statements s
        WHERE s.household_id = v_household_id
          AND s.account_id = p_card_account_id
        ORDER BY s.due_date, s.closing_date, s.id
    LOOP
        PERFORM public.apply_credit_card_advances_to_statement(
            v_statement_id
        );
    END LOOP;

    -- Create exactly one transfer for the entire payment/advance.
    INSERT INTO transactions (
        household_id,
        transaction_type,
        status,
        occurred_at,
        description,
        amount,
        currency_code,
        exchange_rate_to_base,
        amount_base,
        account_id,
        category_id,
        transfer_account_id,
        transfer_amount,
        transfer_currency_code,
        transfer_exchange_rate_to_base,
        transfer_amount_base,
        notes,
        created_by
    )
    VALUES (
        v_household_id,
        'transfer',
        'posted',
        p_occurred_at,
        'Pago/anticipo de tarjeta: ' || v_card_name,
        v_amount,
        v_source_currency,
        v_exchange_rate,
        v_amount_base,
        p_source_account_id,
        NULL,
        p_card_account_id,
        v_amount,
        v_card_currency,
        v_exchange_rate,
        v_amount_base,
        p_notes,
        p_created_by
    )
    RETURNING id INTO v_transaction_id;

    -- Allocate the new payment across existing statement debts,
    -- beginning with the nearest due date.
    v_remaining := v_amount;

    FOR v_statement IN
        SELECT
            b.statement_id,
            b.outstanding_amount
        FROM credit_card_statement_balances b
        WHERE b.household_id = v_household_id
          AND b.account_id = p_card_account_id
          AND b.outstanding_amount > 0
        ORDER BY
            b.due_date,
            b.closing_date,
            b.statement_id
    LOOP
        EXIT WHEN v_remaining <= 0;

        v_allocation := LEAST(
            v_remaining,
            v_statement.outstanding_amount
        );

        INSERT INTO credit_card_statement_payments (
            household_id,
            statement_id,
            transaction_id,
            amount,
            notes
        )
        VALUES (
            v_household_id,
            v_statement.statement_id,
            v_transaction_id,
            v_allocation,
            p_notes
        );

        v_remaining := ROUND(v_remaining - v_allocation, 6);
    END LOOP;

    -- Any remaining amount is an unapplied advance on the card.
    -- It will be applied automatically to future statements.

    RETURN v_transaction_id;
END;
$function$;

COMMENT ON FUNCTION public.pay_credit_card(
    UUID, UUID, NUMERIC, NUMERIC, TIMESTAMPTZ, UUID, TEXT
) IS
'Creates one card payment transfer, allocates it to outstanding statements in due-date order, and retains any excess as an unapplied advance.';


-- =========================================================
-- 6. Credit card account position view
-- =========================================================

CREATE OR REPLACE VIEW public.credit_card_account_positions AS
WITH statement_totals AS (
    SELECT
        account_id,
        household_id,
        SUM(outstanding_amount) AS outstanding_statement_balance
    FROM credit_card_statement_balances
    GROUP BY account_id, household_id
),
advance_per_transfer AS (
    SELECT
        t.id,
        t.transfer_account_id,
        t.transfer_amount,
        COALESCE(SUM(p.amount), 0) AS allocated_amount
    FROM transactions t
    JOIN accounts src
      ON src.id = t.account_id
     AND src.household_id = t.household_id
    JOIN accounts target
      ON target.id = t.transfer_account_id
     AND target.household_id = t.household_id
    LEFT JOIN credit_card_statement_payments p
      ON p.transaction_id = t.id
     AND p.household_id = t.household_id
    WHERE t.transaction_type = 'transfer'
      AND t.status = 'posted'
      AND target.account_type = 'credit_card'
      AND src.account_type <> 'credit_card'
      AND t.currency_code = target.currency_code
      AND t.transfer_currency_code = target.currency_code
      AND t.amount = t.transfer_amount
    GROUP BY
        t.id,
        t.transfer_account_id,
        t.transfer_amount
),
advance_totals AS (
    SELECT
        transfer_account_id AS account_id,
        SUM(
            GREATEST(transfer_amount - allocated_amount, 0)
        ) AS unapplied_advances
    FROM advance_per_transfer
    GROUP BY transfer_account_id
)
SELECT
    a.id AS account_id,
    a.household_id,
    a.name AS card_name,
    a.currency_code,
    a.credit_limit,

    ab.balance AS signed_balance,

    GREATEST(-ab.balance, 0) AS debt_balance,
    GREATEST(ab.balance, 0) AS credit_balance,

    COALESCE(
        st.outstanding_statement_balance,
        0
    ) AS outstanding_statement_balance,

    COALESCE(
        adv.unapplied_advances,
        0
    ) AS unapplied_advances

FROM accounts a
JOIN account_balances ab
  ON ab.account_id = a.id
 AND ab.household_id = a.household_id
LEFT JOIN statement_totals st
  ON st.account_id = a.id
 AND st.household_id = a.household_id
LEFT JOIN advance_totals adv
  ON adv.account_id = a.id
WHERE a.account_type = 'credit_card';


-- =========================================================
-- 7. Register migration
-- =========================================================

INSERT INTO schema_migrations (version, description)
VALUES (
    '016',
    'Add credit card advances and automatic statement allocation'
);

COMMIT;
