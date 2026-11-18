
BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '008'
    ) THEN
        RAISE EXCEPTION 'La migración 008 ya fue aplicada';
    END IF;
END;
$$;

-- Configuración del ciclo de facturación
ALTER TABLE accounts
ADD COLUMN statement_closing_day SMALLINT,
ADD COLUMN payment_due_day SMALLINT,
ADD COLUMN payment_due_month_offset SMALLINT;

-- Validar días del mes
ALTER TABLE accounts
ADD CONSTRAINT accounts_statement_closing_day_check
CHECK (
    statement_closing_day IS NULL
    OR statement_closing_day BETWEEN 1 AND 31
);

ALTER TABLE accounts
ADD CONSTRAINT accounts_payment_due_day_check
CHECK (
    payment_due_day IS NULL
    OR payment_due_day BETWEEN 1 AND 31
);

ALTER TABLE accounts
ADD CONSTRAINT accounts_payment_due_month_offset_check
CHECK (
    payment_due_month_offset IS NULL
    OR payment_due_month_offset BETWEEN 0 AND 2
);

-- Solo las tarjetas de crédito pueden tener esta configuración
ALTER TABLE accounts
ADD CONSTRAINT accounts_credit_card_configuration_check
CHECK (
    account_type = 'credit_card'
    OR (
        statement_closing_day IS NULL
        AND payment_due_day IS NULL
        AND payment_due_month_offset IS NULL
    )
);

INSERT INTO schema_migrations (version, description)
VALUES ('008', 'Add credit card billing cycle configuration');

COMMIT;
