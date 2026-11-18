
-- Migration 017: Authentication sessions and refresh token storage

BEGIN;

-- =========================================================
-- 1. Validate and normalize email uniqueness
-- =========================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        GROUP BY lower(btrim(email))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate user emails found after normalization';
    END IF;
END;
$$;

ALTER TABLE users
ADD CONSTRAINT users_email_not_blank
CHECK (btrim(email) <> '');

CREATE UNIQUE INDEX users_email_normalized_unique
ON users (lower(btrim(email)));

COMMENT ON COLUMN users.password_hash IS
'Argon2id password hash. NULL is permitted only during initial account setup.';


-- =========================================================
-- 2. Authentication sessions
-- =========================================================

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    household_id UUID NOT NULL,
    user_id UUID NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(100),

    ip_address INET,
    user_agent TEXT,

    CONSTRAINT auth_sessions_membership_fkey
        FOREIGN KEY (household_id, user_id)
        REFERENCES household_members (household_id, user_id)
        ON DELETE CASCADE,

    CONSTRAINT auth_sessions_expiration_check
        CHECK (expires_at > created_at),

    CONSTRAINT auth_sessions_revocation_check
        CHECK (
            revoked_at IS NULL
            OR revoked_at >= created_at
        )
);

CREATE INDEX auth_sessions_user_idx
ON auth_sessions (user_id, created_at DESC);

CREATE INDEX auth_sessions_household_idx
ON auth_sessions (household_id, created_at DESC);

CREATE INDEX auth_sessions_active_idx
ON auth_sessions (user_id, expires_at)
WHERE revoked_at IS NULL;

COMMENT ON TABLE auth_sessions IS
'Authenticated user sessions, scoped to a household and revocable independently.';


-- =========================================================
-- 3. Refresh token history and rotation
-- =========================================================

CREATE TABLE auth_refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    session_id UUID NOT NULL
        REFERENCES auth_sessions(id)
        ON DELETE CASCADE,

    token_hash VARCHAR(64) NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    replaced_by_token_id UUID
        REFERENCES auth_refresh_tokens(id)
        ON DELETE SET NULL,

    CONSTRAINT auth_refresh_tokens_hash_format
        CHECK (token_hash ~ '^[a-f0-9]{64}$'),

    CONSTRAINT auth_refresh_tokens_expiration_check
        CHECK (expires_at > created_at),

    CONSTRAINT auth_refresh_tokens_used_check
        CHECK (
            used_at IS NULL
            OR used_at >= created_at
        ),

    CONSTRAINT auth_refresh_tokens_revoked_check
        CHECK (
            revoked_at IS NULL
            OR revoked_at >= created_at
        )
);

CREATE INDEX auth_refresh_tokens_session_idx
ON auth_refresh_tokens (session_id, created_at DESC);

-- Only one unused, non-revoked refresh token per session.
CREATE UNIQUE INDEX auth_refresh_tokens_active_session_unique
ON auth_refresh_tokens (session_id)
WHERE used_at IS NULL
  AND revoked_at IS NULL;

COMMENT ON TABLE auth_refresh_tokens IS
'Hashed refresh token history. Used tokens remain stored to detect replay attempts.';


-- =========================================================
-- 4. Register migration
-- =========================================================

INSERT INTO schema_migrations (version, description)
VALUES (
    '017',
    'Create authentication sessions and refresh token history'
);

COMMIT;
