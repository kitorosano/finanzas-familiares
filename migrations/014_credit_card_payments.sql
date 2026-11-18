
-- Migration 014: Credit card statement payments

BEGIN;

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

    v_source_name VARCHAR(100);
    v_source_type VARCHAR(30);
    v_source_currency CHAR(3);
    v_source_active BOOLEAN;

    v_base_currency CHAR(3);

    v_total_due NUMERIC;
    v_total_paid NUMERIC;
    v_outstanding NUMERIC;

    v_amount NUMERIC;
    v_exchange_rate NUMERIC;
    v_amount_base NUMERIC;

    v_transaction_id UUID;
BEGIN
    -- Validate required amounts and values.
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

    -- Normalize to the precision supported by transactions.
    v_amount := ROUND(p_amount, 6);
    v_exchange_rate := ROUND(p_exchange_rate_to_base, 10);

    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'El importe redondeado debe ser mayor que cero';
    END IF;

    -- Lock the statement to serialize payments.
    SELECT
        s.household_id,
        s.account_id,
        s.total_due
    INTO
        v_household_id,
        v_card_account_id,
        v_total_due
    FROM credit_card_statements s
    WHERE s.id = p_statement_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró el estado de cuenta';
    END IF;

    -- Load and lock the destination credit card.
    SELECT
        a.name,
        a.account_type,
        a.currency_code,
        a.is_active
    INTO
        v_card_name,
        v_card_type,
        v_card_currency,
        v_card_active
    FROM accounts a
    WHERE a.id = v_card_account_id
      AND a.household_id = v_household_id
    FOR UPDATE;

    IF NOT FOUND OR v_card_type <> 'credit_card' THEN
        RAISE EXCEPTION 'El estado de cuenta no pertenece a una tarjeta válida';
    END IF;

    IF NOT v_card_active THEN
        RAISE EXCEPTION 'La tarjeta de crédito está inactiva';
    END IF;

    -- Load and lock the source account.
    SELECT
        a.name,
        a.account_type,
        a.currency_code,
        a.is_active
    INTO
        v_source_name,
        v_source_type,
        v_source_currency,
        v_source_active
    FROM accounts a
    WHERE a.id = p_source_account_id
      AND a.household_id = v_household_id
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
        RAISE EXCEPTION
            'Monedas incompatibles: cuenta de origen (%) y tarjeta (%)',
            v_source_currency,
            v_card_currency;
    END IF;

    -- Validate the exchange rate against the household base currency.
    SELECT h.base_currency_code
    INTO v_base_currency
    FROM households h
    WHERE h.id = v_household_id;

    IF v_card_currency = v_base_currency
       AND v_exchange_rate <> 1 THEN
        RAISE EXCEPTION
            'La tasa de cambio debe ser 1 para la moneda base (%)',
            v_base_currency;
    END IF;

    -- Calculate the actual outstanding amount.
    SELECT COALESCE(SUM(p.amount), 0)
    INTO v_total_paid
    FROM credit_card_statement_payments p
    WHERE p.statement_id = p_statement_id;

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

    -- Calculate equivalent in household base currency.
    v_amount_base := ROUND(v_amount * v_exchange_rate, 6);

    -- Create the payment as a transfer, not a new expense.
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

    -- Allocate the transfer to the selected statement.
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

COMMENT ON FUNCTION public.pay_credit_card_statement(
    UUID, UUID, NUMERIC, NUMERIC, TIMESTAMPTZ, UUID, TEXT
) IS
'Creates a posted transfer from an asset account to a credit card and allocates it to a statement.';

INSERT INTO schema_migrations (version, description)
VALUES (
    '014',
    'Create atomic credit card statement payment function'
);

COMMIT;
