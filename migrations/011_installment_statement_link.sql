BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM schema_migrations WHERE version = '011'
    ) THEN
        RAISE EXCEPTION 'Migration 011 already applied';
    END IF;
END $$;

-- Vincular cada cuota con su estado de cuenta
ALTER TABLE credit_card_installments
ADD COLUMN statement_id UUID;

ALTER TABLE credit_card_installments
ADD CONSTRAINT credit_card_installments_statement_fkey
FOREIGN KEY (statement_id, household_id)
REFERENCES credit_card_statements(id, household_id)
ON DELETE RESTRICT;

CREATE INDEX credit_card_installments_statement_idx
ON credit_card_installments(statement_id)
WHERE statement_id IS NOT NULL;

-- Validar que la cuota corresponda a la tarjeta y vencimiento del estado
CREATE OR REPLACE FUNCTION validate_installment_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_statement_account UUID;
    v_statement_due_date DATE;
    v_purchase_account UUID;
BEGIN
    IF NEW.statement_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT account_id, due_date
    INTO v_statement_account, v_statement_due_date
    FROM credit_card_statements
    WHERE id = NEW.statement_id
      AND household_id = NEW.household_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Credit card statement not found';
    END IF;

    SELECT t.account_id
    INTO v_purchase_account
    FROM credit_card_purchases p
    JOIN transactions t
      ON t.id = p.transaction_id
     AND t.household_id = p.household_id
    WHERE p.id = NEW.purchase_id
      AND p.household_id = NEW.household_id;

    IF v_purchase_account <> v_statement_account THEN
        RAISE EXCEPTION
            'Installment and statement must belong to the same credit card';
    END IF;

    IF NEW.due_date <> v_statement_due_date THEN
        RAISE EXCEPTION
            'Installment due date must match statement due date';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER credit_card_installment_statement_validation
BEFORE INSERT OR UPDATE OF statement_id, purchase_id, household_id, due_date
ON credit_card_installments
FOR EACH ROW
EXECUTE FUNCTION validate_installment_statement();

-- Mantener el total del estado de cuenta sincronizado con sus cuotas
CREATE OR REPLACE FUNCTION refresh_credit_card_statement_total(
    p_statement_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_statement_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE credit_card_statements
    SET total_due = (
        SELECT COALESCE(SUM(amount), 0)
        FROM credit_card_installments
        WHERE statement_id = p_statement_id
    )
    WHERE id = p_statement_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_installment_statement_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM refresh_credit_card_statement_total(OLD.statement_id);
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.statement_id IS DISTINCT FROM NEW.statement_id THEN
        PERFORM refresh_credit_card_statement_total(OLD.statement_id);
    END IF;

    PERFORM refresh_credit_card_statement_total(NEW.statement_id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER credit_card_installment_statement_total
AFTER INSERT OR UPDATE OR DELETE
ON credit_card_installments
FOR EACH ROW
EXECUTE FUNCTION sync_installment_statement_total();

-- Impedir modificar manualmente los totales o reducirlos por debajo de lo pagado
CREATE OR REPLACE FUNCTION validate_credit_card_statement_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_expected NUMERIC(20,6);
    v_paid NUMERIC(20,6);
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO v_expected
    FROM credit_card_installments
    WHERE statement_id = NEW.id;

    IF NEW.total_due <> v_expected THEN
        RAISE EXCEPTION
            'Statement total must equal the sum of its installments (%)',
            v_expected;
    END IF;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM credit_card_statement_payments
    WHERE statement_id = NEW.id;

    IF v_paid > NEW.total_due THEN
        RAISE EXCEPTION
            'Statement total cannot be lower than its allocated payments';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER credit_card_statement_total_validation
BEFORE INSERT OR UPDATE OF total_due
ON credit_card_statements
FOR EACH ROW
EXECUTE FUNCTION validate_credit_card_statement_total();

-- Validar pagos acumulados por estado de cuenta y transferencia
CREATE OR REPLACE FUNCTION validate_credit_card_statement_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_statement_account UUID;
    v_statement_total NUMERIC(20,6);
    v_transfer_account UUID;
    v_transfer_amount NUMERIC(20,6);
    v_transaction_type VARCHAR(20);
    v_transaction_status VARCHAR(20);
    v_statement_allocated NUMERIC(20,6);
    v_transfer_allocated NUMERIC(20,6);
BEGIN
    SELECT account_id, total_due
    INTO v_statement_account, v_statement_total
    FROM credit_card_statements
    WHERE id = NEW.statement_id
      AND household_id = NEW.household_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Credit card statement not found';
    END IF;

    SELECT
        transaction_type,
        status,
        transfer_account_id,
        transfer_amount
    INTO
        v_transaction_type,
        v_transaction_status,
        v_transfer_account,
        v_transfer_amount
    FROM transactions
    WHERE id = NEW.transaction_id
      AND household_id = NEW.household_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment transaction not found';
    END IF;

    IF v_transaction_type <> 'transfer'
       OR v_transaction_status <> 'posted'
       OR v_transfer_account <> v_statement_account
    THEN
        RAISE EXCEPTION
            'Payment must be a posted transfer to the statement credit card';
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
$$;

-- Evitar invalidar transferencias que ya tienen pagos asignados
CREATE OR REPLACE FUNCTION protect_allocated_card_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_allocated NUMERIC(20,6);
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO v_allocated
    FROM credit_card_statement_payments
    WHERE transaction_id = OLD.id;

    IF v_allocated > 0 THEN
        IF NEW.transaction_type <> 'transfer'
           OR NEW.status <> 'posted'
           OR NEW.transfer_amount < v_allocated
           OR EXISTS (
               SELECT 1
               FROM credit_card_statement_payments p
               JOIN credit_card_statements s
                 ON s.id = p.statement_id
                AND s.household_id = p.household_id
               WHERE p.transaction_id = OLD.id
                 AND (
                     s.account_id <> NEW.transfer_account_id
                     OR p.household_id <> NEW.household_id
                 )
           )
        THEN
            RAISE EXCEPTION
                'Cannot invalidate a transfer with allocated credit card payments';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_protect_card_payment
BEFORE UPDATE OF transaction_type, status, transfer_account_id,
                 transfer_amount, household_id
ON transactions
FOR EACH ROW
EXECUTE FUNCTION protect_allocated_card_payment();

INSERT INTO schema_migrations (version, description)
VALUES ('011', 'Link installments to statements and enforce payment allocations');

COMMIT;
