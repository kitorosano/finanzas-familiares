BEGIN;

-- =========================================================
-- 1. PRE-FLIGHT CHECKS
-- =========================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '020'
    ) THEN
        RAISE EXCEPTION 'Migration 020 has already been applied';
    END IF;

    IF EXISTS (
        SELECT transaction_id
        FROM savings_goal_contributions
        WHERE transaction_id IS NOT NULL
        GROUP BY transaction_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate transaction references exist in savings_goal_contributions';
    END IF;
END;
$$;


-- =========================================================
-- 2. CONTRIBUTION LIFECYCLE
-- =========================================================

ALTER TABLE savings_goal_contributions
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'posted',
    ADD COLUMN voided_at TIMESTAMPTZ,
    ADD COLUMN voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN void_reason VARCHAR(500);

ALTER TABLE savings_goal_contributions
    ADD CONSTRAINT savings_goal_contributions_status_check
        CHECK (status IN ('posted', 'void')),

    ADD CONSTRAINT savings_goal_contributions_void_details_check
        CHECK (
            (
                status = 'posted'
                AND voided_at IS NULL
                AND void_reason IS NULL
            )
            OR
            (
                status = 'void'
                AND voided_at IS NOT NULL
                AND void_reason IS NOT NULL
                AND LENGTH(BTRIM(void_reason)) > 0
            )
        );


-- =========================================================
-- 3. CONTRIBUTION INDEXES
-- =========================================================

CREATE UNIQUE INDEX
    savings_goal_contributions_transaction_unique
ON savings_goal_contributions (transaction_id)
WHERE transaction_id IS NOT NULL;

CREATE INDEX
    savings_goal_contributions_goal_status_idx
ON savings_goal_contributions (
    goal_id,
    status,
    contributed_at DESC
);


-- =========================================================
-- 4. VALIDATE CONTRIBUTION INTEGRITY
-- =========================================================

CREATE OR REPLACE FUNCTION validate_savings_goal_contribution()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_goal_household_id UUID;
    v_goal_currency_code CHAR(3);

    v_transaction_household_id UUID;
    v_transaction_type VARCHAR(20);
    v_transaction_status VARCHAR(20);
    v_transaction_amount NUMERIC(20,6);
    v_transaction_currency CHAR(3);

    v_transfer_account_id UUID;
    v_transfer_amount NUMERIC(20,6);
    v_transfer_currency CHAR(3);

    v_source_account_type VARCHAR(30);
    v_destination_account_type VARCHAR(30);
    v_destination_currency CHAR(3);

BEGIN
    SELECT
        household_id,
        currency_code
    INTO
        v_goal_household_id,
        v_goal_currency_code
    FROM savings_goals
    WHERE id = NEW.goal_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Savings goal not found';
    END IF;

    IF NEW.currency_code <> v_goal_currency_code THEN
        RAISE EXCEPTION
            'Contribution currency must match savings goal currency';
    END IF;

    -- Keep compatibility with existing contributions
    -- that do not reference a transaction.
    IF NEW.transaction_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT
        t.household_id,
        t.transaction_type,
        t.status,
        t.amount,
        t.currency_code,
        t.transfer_account_id,
        t.transfer_amount,
        t.transfer_currency_code,
        source.account_type,
        destination.account_type,
        destination.currency_code

    INTO
        v_transaction_household_id,
        v_transaction_type,
        v_transaction_status,
        v_transaction_amount,
        v_transaction_currency,
        v_transfer_account_id,
        v_transfer_amount,
        v_transfer_currency,
        v_source_account_type,
        v_destination_account_type,
        v_destination_currency

    FROM transactions t

    JOIN accounts source
      ON source.id = t.account_id
     AND source.household_id = t.household_id

    JOIN accounts destination
      ON destination.id = t.transfer_account_id
     AND destination.household_id = t.household_id

    WHERE t.id = NEW.transaction_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contribution transfer not found';
    END IF;

    IF v_transaction_household_id <> v_goal_household_id THEN
        RAISE EXCEPTION
            'Contribution transfer must belong to the savings goal household';
    END IF;

    IF v_transaction_type <> 'transfer' THEN
        RAISE EXCEPTION
            'Savings goal contribution must reference a transfer';
    END IF;

    IF v_transfer_account_id IS NULL THEN
        RAISE EXCEPTION
            'Contribution transfer must have a destination account';
    END IF;

    IF v_transfer_amount IS DISTINCT FROM NEW.amount THEN
        RAISE EXCEPTION
            'Contribution amount must match transfer destination amount';
    END IF;

    IF v_transfer_currency <> NEW.currency_code
       OR v_destination_currency <> NEW.currency_code THEN
        RAISE EXCEPTION
            'Contribution currency must match transfer destination currency';
    END IF;

    IF v_source_account_type = 'credit_card'
       OR v_destination_account_type = 'credit_card' THEN
        RAISE EXCEPTION
            'Credit cards cannot be used for savings goal contributions';
    END IF;

    IF NEW.status = 'posted'
       AND v_transaction_status <> 'posted' THEN
        RAISE EXCEPTION
            'Posted contribution must reference a posted transfer';
    END IF;

    IF NEW.status = 'void'
       AND v_transaction_status <> 'void' THEN
        RAISE EXCEPTION
            'Voided contribution must reference a void transfer';
    END IF;

    -- When both accounts use the same currency, the transfer
    -- cannot change the nominal amount.
    IF v_transaction_currency = v_transfer_currency
       AND v_transaction_amount <> v_transfer_amount THEN
        RAISE EXCEPTION
            'Same-currency contribution transfer amounts must match';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER savings_goal_contribution_integrity_trigger
BEFORE INSERT OR UPDATE OF
    goal_id,
    transaction_id,
    amount,
    currency_code,
    status
ON savings_goal_contributions
FOR EACH ROW
EXECUTE FUNCTION validate_savings_goal_contribution();


-- =========================================================
-- 5. PREVENT PHYSICAL CONTRIBUTION DELETION
-- =========================================================

CREATE OR REPLACE FUNCTION prevent_savings_goal_contribution_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Savings goal contributions cannot be physically deleted; void the contribution instead';
END;
$$;

CREATE TRIGGER savings_goal_contribution_no_delete_trigger
BEFORE DELETE ON savings_goal_contributions
FOR EACH ROW
EXECUTE FUNCTION prevent_savings_goal_contribution_delete();


-- =========================================================
-- 6. RECORD MIGRATION
-- =========================================================

INSERT INTO schema_migrations (version, description)
VALUES (
    '020',
    'Add savings goal contribution lifecycle and integrity'
);

COMMIT;