
BEGIN;

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS holder_user_id UUID
REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN accounts.holder_user_id IS
'Usuario titular de la cuenta. NULL representa una cuenta compartida del hogar.';

CREATE INDEX IF NOT EXISTS accounts_holder_idx
ON accounts (holder_user_id);

INSERT INTO schema_migrations (version, description)
VALUES ('004', 'Add account holder ownership')
ON CONFLICT (version) DO NOTHING;

COMMIT;
