
BEGIN;

-- Evitar ejecutar dos veces la migración
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '009'
    ) THEN
        RAISE EXCEPTION 'La migración 009 ya fue aplicada';
    END IF;
END;
$$;

-- Permitir relacionar movimientos con su hogar
CREATE UNIQUE INDEX transactions_id_household_unique
ON transactions (id, household_id);

-- Registro de compras realizadas con tarjeta
CREATE TABLE credit_card_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    transaction_id UUID NOT NULL UNIQUE,
    installments_count SMALLINT NOT NULL,
    first_due_date DATE NOT NULL,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT credit_card_purchases_installments_check
        CHECK (installments_count BETWEEN 1 AND 240),

    CONSTRAINT credit_card_purchases_id_household_unique
        UNIQUE (id, household_id),

    CONSTRAINT credit_card_purchases_transaction_fkey
        FOREIGN KEY (transaction_id, household_id)
        REFERENCES transactions (id, household_id)
        ON DELETE RESTRICT,

    CONSTRAINT credit_card_purchases_household_fkey
        FOREIGN KEY (household_id)
        REFERENCES households(id)
        ON DELETE CASCADE
);

-- Cuotas individuales de cada compra
CREATE TABLE credit_card_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    purchase_id UUID NOT NULL,
    installment_number SMALLINT NOT NULL,
    due_date DATE NOT NULL,
    amount NUMERIC(20,6) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT credit_card_installments_number_check
        CHECK (installment_number > 0),

    CONSTRAINT credit_card_installments_amount_check
        CHECK (amount > 0),

    CONSTRAINT credit_card_installments_purchase_number_unique
        UNIQUE (purchase_id, installment_number),

    CONSTRAINT credit_card_installments_purchase_fkey
        FOREIGN KEY (purchase_id, household_id)
        REFERENCES credit_card_purchases (id, household_id)
        ON DELETE CASCADE
);

-- Índices para consultar compras y cuotas
CREATE INDEX credit_card_purchases_household_idx
ON credit_card_purchases (household_id, created_at DESC);

CREATE INDEX credit_card_installments_due_idx
ON credit_card_installments (household_id, due_date);

CREATE INDEX credit_card_installments_purchase_idx
ON credit_card_installments (purchase_id);

-- Validar que la compra corresponda a una tarjeta de crédito
CREATE OR REPLACE FUNCTION validate_credit_card_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_transaction_type VARCHAR(20);
    v_account_type VARCHAR(30);
    v_status VARCHAR(20);
BEGIN
    SELECT
        t.transaction_type,
        a.account_type,
        t.status
    INTO
        v_transaction_type,
        v_account_type,
        v_status
    FROM transactions t
    JOIN accounts a
        ON a.id = t.account_id
       AND a.household_id = t.household_id
    WHERE t.id = NEW.transaction_id
      AND t.household_id = NEW.household_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró el movimiento asociado';
    END IF;

    IF v_transaction_type <> 'expense' THEN
        RAISE EXCEPTION 'Una compra con tarjeta debe ser un gasto';
    END IF;

    IF v_account_type <> 'credit_card' THEN
        RAISE EXCEPTION 'La cuenta asociada no es una tarjeta de crédito';
    END IF;

    IF v_status = 'void' THEN
        RAISE EXCEPTION 'No se puede asociar una compra a un movimiento anulado';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER credit_card_purchase_validation_trigger
BEFORE INSERT OR UPDATE OF transaction_id, household_id
ON credit_card_purchases
FOR EACH ROW
EXECUTE FUNCTION validate_credit_card_purchase();

-- Validar cantidad e importe total de las cuotas al confirmar
CREATE OR REPLACE FUNCTION validate_credit_card_installments_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_purchase_id UUID;
    v_expected_count SMALLINT;
    v_transaction_amount NUMERIC(20,6);
    v_installment_count BIGINT;
    v_installment_total NUMERIC(20,6);
BEGIN
    IF TG_TABLE_NAME = 'credit_card_purchases' THEN
        v_purchase_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        v_purchase_id := OLD.purchase_id;
    ELSE
        v_purchase_id := NEW.purchase_id;
    END IF;

    SELECT
        p.installments_count,
        t.amount
    INTO
        v_expected_count,
        v_transaction_amount
    FROM credit_card_purchases p
    JOIN transactions t ON t.id = p.transaction_id
    WHERE p.id = v_purchase_id;

    -- La compra pudo haber sido eliminada en cascada
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT
        COUNT(*),
        COALESCE(SUM(amount), 0)
    INTO
        v_installment_count,
        v_installment_total
    FROM credit_card_installments
    WHERE purchase_id = v_purchase_id;

    IF v_installment_count <> v_expected_count THEN
        RAISE EXCEPTION
            'La compra requiere % cuotas, pero se encontraron %',
            v_expected_count,
            v_installment_count;
    END IF;

    IF v_installment_total <> v_transaction_amount THEN
        RAISE EXCEPTION
            'El total de cuotas (%) no coincide con la compra (%)',
            v_installment_total,
            v_transaction_amount;
    END IF;

    RETURN NULL;
END;
$$;

-- Comprobar al finalizar la transacción SQL,
-- permitiendo insertar la compra y sus cuotas juntas.
CREATE CONSTRAINT TRIGGER credit_card_purchase_installments_check
AFTER INSERT OR UPDATE ON credit_card_purchases
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_credit_card_installments_total();

CREATE CONSTRAINT TRIGGER credit_card_installments_total_check
AFTER INSERT OR UPDATE OR DELETE ON credit_card_installments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_credit_card_installments_total();

-- Registrar migración
INSERT INTO schema_migrations (version, description)
VALUES ('009', 'Create credit card purchases and installments');

COMMIT;
