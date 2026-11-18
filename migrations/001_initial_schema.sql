
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. MONEDAS
-- =========================================================

CREATE TABLE currencies (
    code CHAR(3) PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    symbol VARCHAR(8) NOT NULL,
    decimal_places SMALLINT NOT NULL DEFAULT 2
        CHECK (decimal_places BETWEEN 0 AND 4),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO currencies (code, name, symbol) VALUES
    ('UYU', 'Peso uruguayo', '$U'),
    ('USD', 'Dólar estadounidense', 'US$'),
    ('ARS', 'Peso argentino', '$'),
    ('BRL', 'Real brasileño', 'R$')
ON CONFLICT (code) DO NOTHING;


-- =========================================================
-- 2. HOGARES Y USUARIOS
-- =========================================================

CREATE TABLE households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    base_currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash TEXT,
    display_name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_email_unique
    ON users (LOWER(email));

CREATE TABLE household_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (household_id, user_id)
);


-- =========================================================
-- 3. CUENTAS
-- =========================================================

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    account_type VARCHAR(30) NOT NULL
        CHECK (account_type IN (
            'cash',
            'bank',
            'digital_wallet',
            'credit_card',
            'investment',
            'other'
        )),
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    institution VARCHAR(120),
    opening_balance NUMERIC(20, 6) NOT NULL DEFAULT 0,
    opening_balance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    credit_limit NUMERIC(20, 6),
    include_in_net_worth BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (credit_limit IS NULL OR credit_limit >= 0)
);

CREATE INDEX accounts_household_idx ON accounts (household_id);


-- =========================================================
-- 4. CATEGORÍAS
-- =========================================================

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID REFERENCES households(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    category_type VARCHAR(20) NOT NULL
        CHECK (category_type IN ('income', 'expense')),
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX categories_household_idx
    ON categories (household_id);

CREATE INDEX categories_parent_idx
    ON categories (parent_id);

CREATE UNIQUE INDEX categories_system_unique
    ON categories (name, category_type)
    WHERE household_id IS NULL;

CREATE UNIQUE INDEX categories_household_unique
    ON categories (household_id, name, category_type)
    WHERE household_id IS NOT NULL;


-- =========================================================
-- 5. COTIZACIONES HISTÓRICAS
-- =========================================================

CREATE TABLE exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    to_currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    effective_date DATE NOT NULL,
    rate NUMERIC(20, 10) NOT NULL CHECK (rate > 0),
    source VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_currency_code <> to_currency_code),
    UNIQUE (from_currency_code, to_currency_code, effective_date, source)
);

CREATE INDEX exchange_rates_lookup_idx
    ON exchange_rates (from_currency_code, to_currency_code, effective_date DESC);


-- =========================================================
-- 6. MOVIMIENTOS
-- =========================================================

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,

    transaction_type VARCHAR(20) NOT NULL
        CHECK (transaction_type IN ('income', 'expense', 'transfer')),

    status VARCHAR(20) NOT NULL DEFAULT 'posted'
        CHECK (status IN ('pending', 'posted', 'void')),

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT,

    -- Importe y moneda de origen
    amount NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code),

    -- Conversión histórica a la moneda base del hogar
    exchange_rate_to_base NUMERIC(20, 10) NOT NULL
        CHECK (exchange_rate_to_base > 0),
    amount_base NUMERIC(20, 6) NOT NULL CHECK (amount_base > 0),

    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,

    -- Datos adicionales para transferencias
    transfer_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    transfer_amount NUMERIC(20, 6),
    transfer_currency_code CHAR(3) REFERENCES currencies(code),
    transfer_exchange_rate_to_base NUMERIC(20, 10),
    transfer_amount_base NUMERIC(20, 6),

    external_reference VARCHAR(150),
    notes TEXT,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voided_at TIMESTAMPTZ,

    CHECK (
        (
            transaction_type = 'transfer'
            AND category_id IS NULL
            AND transfer_account_id IS NOT NULL
            AND transfer_account_id <> account_id
            AND transfer_amount IS NOT NULL
            AND transfer_amount > 0
            AND transfer_currency_code IS NOT NULL
            AND transfer_exchange_rate_to_base IS NOT NULL
            AND transfer_exchange_rate_to_base > 0
            AND transfer_amount_base IS NOT NULL
            AND transfer_amount_base > 0
        )
        OR
        (
            transaction_type IN ('income', 'expense')
            AND category_id IS NOT NULL
            AND transfer_account_id IS NULL
            AND transfer_amount IS NULL
            AND transfer_currency_code IS NULL
            AND transfer_exchange_rate_to_base IS NULL
            AND transfer_amount_base IS NULL
        )
    )
);

CREATE INDEX transactions_household_date_idx
    ON transactions (household_id, occurred_at DESC);

CREATE INDEX transactions_account_idx
    ON transactions (account_id, occurred_at DESC);

CREATE INDEX transactions_category_idx
    ON transactions (category_id, occurred_at DESC);

CREATE INDEX transactions_status_idx
    ON transactions (household_id, status);

CREATE INDEX transactions_created_by_idx
    ON transactions (created_by);


-- =========================================================
-- 7. PRESUPUESTOS
-- =========================================================

CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name VARCHAR(120),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    amount NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (period_end >= period_start),
    UNIQUE (household_id, category_id, period_start, period_end)
);

CREATE INDEX budgets_household_period_idx
    ON budgets (household_id, period_start, period_end);


-- =========================================================
-- 8. OBJETIVOS DE AHORRO
-- =========================================================

CREATE TABLE savings_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    target_amount NUMERIC(20, 6) NOT NULL CHECK (target_amount > 0),
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    target_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE savings_goal_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    amount NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    contributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX savings_goals_household_idx
    ON savings_goals (household_id, status);

CREATE INDEX savings_contributions_goal_idx
    ON savings_goal_contributions (goal_id, contributed_at DESC);


-- =========================================================
-- 9. MOVIMIENTOS RECURRENTES
-- =========================================================

CREATE TABLE recurring_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,

    transaction_type VARCHAR(20) NOT NULL
        CHECK (transaction_type IN ('income', 'expense')),

    description TEXT NOT NULL,
    amount NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code),

    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,

    frequency VARCHAR(20) NOT NULL
        CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
    interval_value INTEGER NOT NULL DEFAULT 1 CHECK (interval_value > 0),

    start_date DATE NOT NULL,
    end_date DATE,
    next_occurrence DATE NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX recurring_due_idx
    ON recurring_transactions (next_occurrence)
    WHERE is_active = TRUE;


-- =========================================================
-- 10. AUDITORÍA
-- =========================================================

CREATE TABLE audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    household_id UUID REFERENCES households(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    action VARCHAR(30) NOT NULL
        CHECK (action IN ('create', 'update', 'delete', 'void')),

    entity_name VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,

    old_values JSONB,
    new_values JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_household_date_idx
    ON audit_log (household_id, created_at DESC);

CREATE INDEX audit_entity_idx
    ON audit_log (entity_name, entity_id);


-- =========================================================
-- 11. ACTUALIZACIÓN AUTOMÁTICA DE updated_at
-- =========================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER households_updated_at
    BEFORE UPDATE ON households
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER budgets_updated_at
    BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER savings_goals_updated_at
    BEFORE UPDATE ON savings_goals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER recurring_transactions_updated_at
    BEFORE UPDATE ON recurring_transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =========================================================
-- 12. CATEGORÍAS INICIALES DEL SISTEMA
-- =========================================================

INSERT INTO categories (name, category_type, is_system, sort_order) VALUES
    ('Alimentación', 'expense', TRUE, 10),
    ('Vivienda', 'expense', TRUE, 20),
    ('Transporte', 'expense', TRUE, 30),
    ('Salud', 'expense', TRUE, 40),
    ('Educación', 'expense', TRUE, 50),
    ('Servicios', 'expense', TRUE, 60),
    ('Entretenimiento', 'expense', TRUE, 70),
    ('Compras personales', 'expense', TRUE, 80),
    ('Restaurantes', 'expense', TRUE, 90),
    ('Viajes', 'expense', TRUE, 100),
    ('Otros gastos', 'expense', TRUE, 110),
    ('Salario', 'income', TRUE, 10),
    ('Trabajo independiente', 'income', TRUE, 20),
    ('Otros ingresos', 'income', TRUE, 30)
ON CONFLICT DO NOTHING;


-- =========================================================
-- 13. REGISTRO DE MIGRACIONES
-- =========================================================

CREATE TABLE schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'Initial financial system schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
