BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '010'
    ) THEN
        RAISE EXCEPTION 'Migration 010 already applied';
    END IF;
END $$;

-- Estados de cuenta de tarjetas
CREATE TABLE credit_card_statements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    account_id UUID NOT NULL,

    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    closing_date DATE NOT NULL,
    due_date DATE NOT NULL,

    total_due NUMERIC(20,6) NOT NULL DEFAULT 0,
    notes TEXT,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT credit_card_statements_id_household_unique
        UNIQUE (id, household_id),

    CONSTRAINT credit_card_statements_account_fkey
        FOREIGN KEY (account_id, household_id)
        REFERENCES accounts(id, household_id),

    CONSTRAINT credit_card_statements_period_check
        CHECK (period_start <= period_end),

    CONSTRAINT credit_card_statements_closing_check
        CHECK (closing_date >= period_end),

    CONSTRAINT credit_card_statements_due_check
        CHECK (due_date >= closing_date),

    CONSTRAINT credit_card_statements_total_check
        CHECK (total_due >= 0),

    CONSTRAINT credit_card_statements_unique_period
        UNIQUE (account_id, period_start, period_end)
);

CREATE INDEX credit_card_statements_due_idx
    ON credit_card_statements (household_id, due_date);

-- Aplicación de pagos a estados de cuenta
CREATE TABLE credit_card_statement_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    statement_id UUID NOT NULL,
    transaction_id UUID NOT NULL,
    amount NUMERIC(20,6) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT credit_card_statement_payments_amount_check
        CHECK (amount > 0),

    CONSTRAINT credit_card_statement_payments_unique
        UNIQUE (statement_id, transaction_id),

    CONSTRAINT credit_card_statement_payments_statement_fkey
        FOREIGN KEY (statement_id, household_id)
        REFERENCES credit_card_statements(id, household_id)
        ON DELETE CASCADE,

    CONSTRAINT credit_card_statement_payments_transaction_fkey
        FOREIGN KEY (transaction_id, household_id)
        REFERENCES transactions(id, household_id)
        ON DELETE RESTRICT
);

CREATE INDEX credit_card_statement_payments_transaction_idx
    ON credit_card_statement_payments (transaction_id);

-- Validar que cada pago sea una transferencia hacia la tarjeta
CREATE OR REPLACE FUNCTION validate_credit_card_statement_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_account_id UUID;
    v_currency_code CHAR(3);
    v_transfer_account_id UUID;
    v_transfer_currency_code CHAR(3);
    v_transaction_type VARCHAR(20);
    v_transaction_status VARCHAR(20);
BEGIN
    SELECT account_id
    INTO v_account_id
    FROM credit_card_statements
    WHERE id = NEW.statement_id
      AND household_id = NEW.household_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Credit card statement not found';
    END IF;

    SELECT currency_code
    INTO v_currency_code
    FROM accounts
    WHERE id = v_account_id;

    SELECT
        transaction_type,
        status,
        transfer_account_id,
        transfer_currency_code
    INTO
        v_transaction_type,
        v_transaction_status,
        v_transfer_account_id,
        v_transfer_currency_code
    FROM transactions
    WHERE id = NEW.transaction_id
      AND household_id = NEW.household_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment transaction not found';
    END IF;

    IF v_transaction_type <> 'transfer'
       OR v_transaction_status <> 'posted'
       OR v_transfer_account_id <> v_account_id
       OR v_transfer_currency_code <> v_currency_code
    THEN
        RAISE EXCEPTION
            'Payment must be a posted transfer to the statement credit card in the same currency';
    END IF;

    IF NEW.amount > (
        SELECT transfer_amount
        FROM transactions
        WHERE id = NEW.transaction_id
    ) THEN
        RAISE EXCEPTION
            'Allocated payment cannot exceed the transfer amount';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER credit_card_statement_payment_validation
BEFORE INSERT OR UPDATE ON credit_card_statement_payments
FOR EACH ROW
EXECUTE FUNCTION validate_credit_card_statement_payment();

-- Vista de saldos pendientes
CREATE VIEW credit_card_statement_balances AS
SELECT
    s.id AS statement_id,
    s.household_id,
    s.account_id,
    s.period_start,
    s.period_end,
    s.closing_date,
    s.due_date,
    s.total_due,
    COALESCE(SUM(p.amount), 0) AS amount_paid,
    s.total_due - COALESCE(SUM(p.amount), 0) AS outstanding_amount,
    CASE
        WHEN s.total_due - COALESCE(SUM(p.amount), 0) <= 0
            THEN 'paid'
        WHEN COALESCE(SUM(p.amount), 0) > 0
            THEN 'partially_paid'
        ELSE 'pending'
    END AS payment_status
FROM credit_card_statements s
LEFT JOIN credit_card_statement_payments p
    ON p.statement_id = s.id
   AND p.household_id = s.household_id
GROUP BY s.id;

INSERT INTO schema_migrations (version, description)
VALUES ('010', 'Create credit card statements and payment allocations');

COMMIT;
