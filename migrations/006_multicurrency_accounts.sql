
BEGIN;

-- Evitar ejecutar dos veces la migración
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '006'
    ) THEN
        RAISE EXCEPTION 'La migración 006 ya fue aplicada';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM households
        WHERE id = '34f32cd8-2b44-42ac-b758-97f088556a04'
    ) THEN
        RAISE EXCEPTION 'No se encontró el hogar financiero';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM accounts
        WHERE household_id = '34f32cd8-2b44-42ac-b758-97f088556a04'
    ) <> 13 THEN
        RAISE EXCEPTION 'Se esperaban exactamente 13 cuentas originales';
    END IF;
END;
$$;

-- Crear las cinco cuentas adicionales
WITH account_data (
    name,
    account_type,
    institution,
    currency_code,
    holder_email,
    notes
) AS (
    VALUES
    (
        'Prex ARS',
        'digital_wallet',
        'Prex',
        'ARS',
        'john.doe@gmail.com',
        'Cuenta Prex de John en pesos argentinos'
    ),
    (
        'Itaú Débito USD',
        'bank',
        'Itaú',
        'USD',
        'john.doe@gmail.com',
        'Cuenta Itaú de débito de John en dólares'
    ),
    (
        'Itaú Crédito USD',
        'credit_card',
        'Itaú',
        'USD',
        'john.doe@gmail.com',
        'Tarjeta Itaú de crédito de John en dólares'
    ),
    (
        'Prex ARS',
        'digital_wallet',
        'Prex',
        'ARS',
        'jane.doe@gmail.com',
        'Cuenta Prex de Jane en pesos argentinos'
    ),
    (
        'Itaú Débito USD',
        'bank',
        'Itaú',
        'USD',
        'jane.doe@gmail.com',
        'Cuenta Itaú de débito de Jane en dólares'
    )
)

INSERT INTO accounts (
    household_id,
    name,
    account_type,
    institution,
    currency_code,
    opening_balance,
    opening_balance_date,
    holder_user_id,
    credit_limit,
    include_in_net_worth,
    notes
)
SELECT
    '34f32cd8-2b44-42ac-b758-97f088556a04',
    a.name,
    a.account_type,
    a.institution,
    a.currency_code,
    0,
    DATE '2026-11-17',
    u.id,
    NULL,
    TRUE,
    a.notes
FROM account_data a
JOIN users u
    ON LOWER(u.email) = LOWER(a.holder_email);

-- Verificar las cinco cuentas nuevas
DO $$
DECLARE
    account_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO account_count
    FROM accounts
    WHERE household_id = '34f32cd8-2b44-42ac-b758-97f088556a04';

    IF account_count <> 18 THEN
        RAISE EXCEPTION
            'Se esperaban 18 cuentas en total, pero se encontraron %',
            account_count;
    END IF;
END;
$$;

-- Registrar migración
INSERT INTO schema_migrations (version, description)
VALUES ('006', 'Add ARS and USD accounts for both household members');

COMMIT;

-- Mostrar todas las cuentas
SELECT
    a.name,
    a.account_type,
    a.institution,
    a.currency_code,
    a.opening_balance,
    COALESCE(u.display_name, 'Compartido') AS titular
FROM accounts a
LEFT JOIN users u ON u.id = a.holder_user_id
WHERE a.household_id = '34f32cd8-2b44-42ac-b758-97f088556a04'
ORDER BY
    CASE
        WHEN u.display_name = 'John' THEN 1
        WHEN u.display_name = 'Jane' THEN 2
        ELSE 3
    END,
    a.currency_code,
    a.name;
