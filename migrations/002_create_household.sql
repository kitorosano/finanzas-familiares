BEGIN;

-- Crear el hogar inicial una sola vez
INSERT INTO households (name, base_currency_code)
SELECT 'Finanzas Familiares', 'UYU'
WHERE NOT EXISTS (
    SELECT 1
    FROM schema_migrations
    WHERE version = '002'
);

-- Registrar la migración
INSERT INTO schema_migrations (version, description)
VALUES ('002', 'Create initial family household')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Mostrar el hogar creado
SELECT
    id,
    name,
    base_currency_code,
    created_at
FROM households;
