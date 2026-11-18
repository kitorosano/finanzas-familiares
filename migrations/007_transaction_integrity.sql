
BEGIN;

-- Permitir claves foráneas compuestas por cuenta y hogar
CREATE UNIQUE INDEX accounts_id_household_unique
ON accounts (id, household_id);

-- Garantizar que las cuentas de origen y destino
-- pertenezcan al mismo hogar del movimiento
ALTER TABLE transactions
ADD CONSTRAINT transactions_account_household_fkey
FOREIGN KEY (account_id, household_id)
REFERENCES accounts (id, household_id);

ALTER TABLE transactions
ADD CONSTRAINT transactions_transfer_household_fkey
FOREIGN KEY (transfer_account_id, household_id)
REFERENCES accounts (id, household_id);

-- Validar monedas y categorías
CREATE OR REPLACE FUNCTION validate_transaction_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    source_currency CHAR(3);
    destination_currency CHAR(3);
    category_household UUID;
    category_type_value VARCHAR(20);
BEGIN
    SELECT currency_code
    INTO source_currency
    FROM accounts
    WHERE id = NEW.account_id
      AND household_id = NEW.household_id;

    IF source_currency IS NULL THEN
        RAISE EXCEPTION 'No se encontró la cuenta de origen en el hogar';
    END IF;

    IF NEW.currency_code <> source_currency THEN
        RAISE EXCEPTION
            'La moneda del movimiento (%) no coincide con la cuenta (%)',
            NEW.currency_code, source_currency;
    END IF;

    IF NEW.transaction_type = 'transfer' THEN

        SELECT currency_code
        INTO destination_currency
        FROM accounts
        WHERE id = NEW.transfer_account_id
          AND household_id = NEW.household_id;

        IF destination_currency IS NULL THEN
            RAISE EXCEPTION 'No se encontró la cuenta de destino en el hogar';
        END IF;

        IF NEW.transfer_currency_code <> destination_currency THEN
            RAISE EXCEPTION
                'La moneda de destino (%) no coincide con la cuenta (%)',
                NEW.transfer_currency_code, destination_currency;
        END IF;

    ELSE

        SELECT household_id, category_type
        INTO category_household, category_type_value
        FROM categories
        WHERE id = NEW.category_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se encontró la categoría del movimiento';
        END IF;

        IF category_household IS NOT NULL
           AND category_household <> NEW.household_id THEN
            RAISE EXCEPTION 'La categoría pertenece a otro hogar';
        END IF;

        IF category_type_value <> NEW.transaction_type THEN
            RAISE EXCEPTION
                'La categoría (%) no corresponde al tipo de movimiento (%)',
                category_type_value, NEW.transaction_type;
        END IF;

    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_integrity_trigger
BEFORE INSERT OR UPDATE OF
    household_id,
    transaction_type,
    account_id,
    currency_code,
    category_id,
    transfer_account_id,
    transfer_currency_code
ON transactions
FOR EACH ROW
EXECUTE FUNCTION validate_transaction_integrity();

INSERT INTO schema_migrations (version, description)
VALUES ('007', 'Enforce transaction household, currency and category integrity');

COMMIT;
