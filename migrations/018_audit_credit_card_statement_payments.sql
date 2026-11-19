BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '018'
    ) THEN
        RAISE EXCEPTION 'Migration 018 already applied';
    END IF;
END;
$$;


-- =========================================================
-- 1. Auditoría de asignaciones de pagos a tarjetas
-- =========================================================

CREATE OR REPLACE FUNCTION public.audit_credit_card_statement_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    v_action VARCHAR(30);
    v_household_id UUID;
    v_entity_id UUID;
    v_transaction_id UUID;
    v_user_id UUID;

    v_old_values JSONB;
    v_new_values JSONB;
BEGIN

    -- INSERT: nueva asignación
    IF TG_OP = 'INSERT' THEN

        v_action := 'create';
        v_household_id := NEW.household_id;
        v_entity_id := NEW.id;
        v_transaction_id := NEW.transaction_id;

        v_new_values := jsonb_build_object(
            'statementId', NEW.statement_id,
            'transactionId', NEW.transaction_id,
            'amount', NEW.amount,
            'notes', NEW.notes
        );

    -- UPDATE: modificación de asignación
    ELSIF TG_OP = 'UPDATE' THEN

        IF OLD IS NOT DISTINCT FROM NEW THEN
            RETURN NULL;
        END IF;

        v_action := 'update';
        v_household_id := NEW.household_id;
        v_entity_id := NEW.id;
        v_transaction_id := NEW.transaction_id;

        v_old_values := jsonb_build_object(
            'statementId', OLD.statement_id,
            'transactionId', OLD.transaction_id,
            'amount', OLD.amount,
            'notes', OLD.notes
        );

        v_new_values := jsonb_build_object(
            'statementId', NEW.statement_id,
            'transactionId', NEW.transaction_id,
            'amount', NEW.amount,
            'notes', NEW.notes
        );

    -- DELETE: eliminación de asignación
    ELSIF TG_OP = 'DELETE' THEN

        v_action := 'delete';
        v_household_id := OLD.household_id;
        v_entity_id := OLD.id;
        v_transaction_id := OLD.transaction_id;

        v_old_values := jsonb_build_object(
            'statementId', OLD.statement_id,
            'transactionId', OLD.transaction_id,
            'amount', OLD.amount,
            'notes', OLD.notes
        );

    ELSE
        RAISE EXCEPTION
            'Unsupported operation for credit card payment audit: %',
            TG_OP;
    END IF;


    -- =====================================================
    -- 2. Identificar al usuario que ejecuta la operación
    -- =====================================================

    -- La API establece este valor dentro de la transacción.
    v_user_id := NULLIF(
        current_setting('app.current_user_id', TRUE),
        ''
    )::UUID;

    -- Respaldo para operaciones ejecutadas directamente en SQL
    -- o desde otros procesos que no establezcan el contexto.
    IF v_user_id IS NULL THEN
        SELECT t.created_by
        INTO v_user_id
        FROM transactions t
        WHERE t.id = v_transaction_id
          AND t.household_id = v_household_id;
    END IF;


    -- =====================================================
    -- 3. Registrar el evento de auditoría
    -- =====================================================

    INSERT INTO audit_log (
        household_id,
        user_id,
        action,
        entity_name,
        entity_id,
        old_values,
        new_values
    )
    VALUES (
        v_household_id,
        v_user_id,
        v_action,
        'credit_card_statement_payments',
        v_entity_id,
        v_old_values,
        v_new_values
    );

    RETURN NULL;
END;
$function$;


-- =========================================================
-- 4. Trigger de auditoría
-- =========================================================

DROP TRIGGER IF EXISTS
    credit_card_statement_payment_audit_trigger
ON credit_card_statement_payments;

CREATE TRIGGER credit_card_statement_payment_audit_trigger
AFTER INSERT OR UPDATE OR DELETE
ON credit_card_statement_payments
FOR EACH ROW
EXECUTE FUNCTION public.audit_credit_card_statement_payment();


-- =========================================================
-- 5. Registrar migración
-- =========================================================

INSERT INTO schema_migrations (
    version,
    description
)
VALUES (
    '018',
    'Audit credit card statement payment allocations'
);

COMMIT;