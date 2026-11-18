
BEGIN;

-- Verificar que exista el hogar
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM households
        WHERE id = '34f32cd8-2b44-42ac-b758-97f088556a04'
    ) THEN
        RAISE EXCEPTION 'No existe el hogar Finanzas Familiares';
    END IF;
END;
$$;

-- Crear John si todavía no existe
INSERT INTO users (email, display_name)
SELECT 'john.doe@gmail.com', 'John'
WHERE NOT EXISTS (
    SELECT 1
    FROM users
    WHERE LOWER(email) = LOWER('john.doe@gmail.com')
);

-- Crear Jane si todavía no existe
INSERT INTO users (email, display_name)
SELECT 'jane.doe@gmail.com', 'Jane'
WHERE NOT EXISTS (
    SELECT 1
    FROM users
    WHERE LOWER(email) = LOWER('jane.doe@gmail.com')
);

-- Asociar ambos usuarios al hogar
INSERT INTO household_members (household_id, user_id, role)
SELECT
    '34f32cd8-2b44-42ac-b758-97f088556a04',
    u.id,
    CASE
        WHEN LOWER(u.email) = LOWER('john.doe@gmail.com')
            THEN 'owner'
        WHEN LOWER(u.email) = LOWER('jane.doe@gmail.com')
            THEN 'admin'
    END
FROM users u
WHERE LOWER(u.email) IN (
    LOWER('john.doe@gmail.com'),
    LOWER('jane.doe@gmail.com')
)
ON CONFLICT (household_id, user_id)
DO UPDATE SET role = EXCLUDED.role;

-- Registrar migración
INSERT INTO schema_migrations (version, description)
VALUES ('003', 'Create initial household users and memberships')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Verificar los integrantes
SELECT
    u.id AS user_id,
    u.display_name,
    u.email,
    hm.role,
    h.name AS household
FROM household_members hm
JOIN users u ON u.id = hm.user_id
JOIN households h ON h.id = hm.household_id
WHERE h.id = '34f32cd8-2b44-42ac-b758-97f088556a04'
ORDER BY hm.role;
