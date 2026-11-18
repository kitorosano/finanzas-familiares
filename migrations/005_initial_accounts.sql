
BEGIN;

-- Evitar ejecutar dos veces la migración
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '005'
    ) THEN
        RAISE EXCEPTION 'La migración 005 ya fue aplicada';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM households
        WHERE id = '34f32cd8-2b44-42ac-b758-97f088556a04'
    ) THEN
        RAISE EXCEPTION 'No se encontró el hogar financiero';
    END IF;
END;
$$;

-- Cargar las 13 cuentas iniciales
WITH account_data (
    name,
    account_type,
    institution,
    currency_code,
    opening_balance,
    opening_balance_date,
    holder_email,
    credit_limit,
    include_in_net_worth,
    notes
) AS (
    VALUES
    (
        'Dinero',
        'cash',
        NULL::TEXT,
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        NULL::TEXT,
        NULL::NUMERIC,
        TRUE,
        'Efectivo compartido del hogar'
    ),
    (
        'Fondo Inversión',
        'investment',
        'Itaú Asset Liquidez',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'john.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        'Fondo de inversión Itaú Asset Liquidez'
    ),
    (
        'Itaú Débito',
        'bank',
        'Itaú',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'john.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'Itaú Crédito',
        'credit_card',
        'Itaú',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'john.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        'Tarjeta de crédito John'
    ),
    (
        'BBVA',
        'bank',
        'BBVA',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'john.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'Prex',
        'digital_wallet',
        'Prex',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'john.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'BROU',
        'bank',
        'BROU',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'john.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'Santander',
        'bank',
        'Santander',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'john.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'Mercado Pago',
        'digital_wallet',
        'Mercado Pago',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'john.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'Itaú Débito',
        'bank',
        'Itaú',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'jane.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'Prex',
        'digital_wallet',
        'Prex',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'jane.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'BROU',
        'bank',
        'BROU',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'jane.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
    ),
    (
        'Mercado Pago',
        'digital_wallet',
        'Mercado Pago',
        'UYU',
        0::NUMERIC,
        DATE '2026-11-17',
        'jane.doe@gmail.com',
        NULL::NUMERIC,
        TRUE,
        NULL
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
    a.opening_balance,
    a.opening_balance_date,
    u.id,
    a.credit_limit,
    a.include_in_net_worth,
    a.notes
FROM account_data a
LEFT JOIN users u
    ON LOWER(u.email) = LOWER(a.holder_email);

-- Verificar que se hayan insertado exactamente 13 cuentas
DO $$
DECLARE
    account_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO account_count
    FROM accounts
    WHERE household_id = '34f32cd8-2b44-42ac-b758-97f088556a04';

    IF account_count <> 13 THEN
        RAISE EXCEPTION
            'Se esperaban 13 cuentas, pero se encontraron %',
            account_count;
    END IF;
END;
$$;

-- Registrar migración
INSERT INTO schema_migrations (version, description)
VALUES ('005', 'Create initial 13 household financial accounts');

COMMIT;

-- Mostrar las cuentas cargadas
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
    a.name;
