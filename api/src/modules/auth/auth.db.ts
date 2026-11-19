import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';

import type {
  CreatedIdRow,
  HouseholdRow,
  RefreshRow,
  UserRow,
} from './auth.types.js';

const AUTH_QUERIES = {
  createSession: `
    INSERT INTO auth_sessions (
      household_id,
      user_id,
      expires_at,
      ip_address,
      user_agent
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `,
  createRefreshToken: `
    INSERT INTO auth_refresh_tokens (
      session_id,
      token_hash,
      expires_at
    )
    VALUES ($1, $2, $3)
  `,
  findUserByEmail: `
    SELECT
      id,
      email,
      display_name,
      password_hash,
      is_active
    FROM users
    WHERE lower(btrim(email)) = $1
    LIMIT 1
  `,
  listUserHouseholds: `
    SELECT
      hm.household_id,
      h.name AS household_name,
      h.base_currency_code,
      hm.role
    FROM household_members hm
    JOIN households h
      ON h.id = hm.household_id
    WHERE hm.user_id = $1
    ORDER BY hm.joined_at, hm.household_id
  `,
  findRefreshSessionForUpdate: `
    SELECT
      rt.id AS refresh_token_id,
      rt.session_id,
      rt.expires_at AS token_expires_at,
      rt.used_at AS token_used_at,
      rt.revoked_at AS token_revoked_at,

      s.user_id,
      s.household_id,
      s.expires_at AS session_expires_at,
      s.revoked_at AS session_revoked_at,

      u.email,
      u.display_name,
      u.is_active,

      h.name AS household_name,
      h.base_currency_code,
      hm.role

    FROM auth_refresh_tokens rt
    JOIN auth_sessions s
      ON s.id = rt.session_id
    JOIN users u
      ON u.id = s.user_id
    JOIN household_members hm
      ON hm.household_id = s.household_id
     AND hm.user_id = s.user_id
    JOIN households h
      ON h.id = s.household_id

    WHERE rt.token_hash = $1

    FOR UPDATE OF rt, s
  `,
  revokeSessionOnRefreshTokenReuse: `
    UPDATE auth_sessions
    SET
      revoked_at = COALESCE(revoked_at, NOW()),
      revoked_reason = 'refresh_token_reuse'
    WHERE id = $1
  `,
  revokeRefreshTokensForSession: `
    UPDATE auth_refresh_tokens
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE session_id = $1
  `,
  revokeSessionForInactiveUser: `
    UPDATE auth_sessions
    SET
      revoked_at = COALESCE(revoked_at, NOW()),
      revoked_reason = 'user_inactive'
    WHERE id = $1
  `,
  consumeRefreshToken: `
    UPDATE auth_refresh_tokens
    SET used_at = NOW()
    WHERE id = $1
      AND used_at IS NULL
      AND revoked_at IS NULL
  `,
  insertReplacementRefreshToken: `
    INSERT INTO auth_refresh_tokens (
      session_id,
      token_hash,
      expires_at
    )
    VALUES ($1, $2, $3)
    RETURNING id
  `,
  linkReplacementRefreshToken: `
    UPDATE auth_refresh_tokens
    SET replaced_by_token_id = $2
    WHERE id = $1
  `,
  updateSessionLastUsed: `
    UPDATE auth_sessions
    SET
      last_used_at = NOW(),
      expires_at = $2
    WHERE id = $1
  `,
  revokeSessionOnLogout: `
    UPDATE auth_sessions
    SET
      revoked_at = COALESCE(revoked_at, NOW()),
      revoked_reason = 'logout'
    WHERE id = $1
      AND user_id = $2
  `,
  revokeRefreshTokensOnLogout: `
    UPDATE auth_refresh_tokens rt
    SET revoked_at = COALESCE(rt.revoked_at, NOW())
    FROM auth_sessions s
    WHERE rt.session_id = s.id
      AND s.id = $1
      AND s.user_id = $2
  `,
} as const;

export async function createSession(
  client: PoolClient,
  householdId: string,
  userId: string,
  expiresAt: Date,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<CreatedIdRow | undefined> {
  const result = await client.query<CreatedIdRow>(AUTH_QUERIES.createSession, [
    householdId,
    userId,
    expiresAt,
    ipAddress,
    userAgent,
  ]);

  return result.rows[0];
}

export async function createRefreshToken(
  client: PoolClient,
  sessionId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await client.query(AUTH_QUERIES.createRefreshToken, [
    sessionId,
    tokenHash,
    expiresAt,
  ]);
}

export async function findUserByEmail(
  email: string,
): Promise<UserRow | undefined> {
  const result = await db.query<UserRow>(AUTH_QUERIES.findUserByEmail, [email]);
  return result.rows[0];
}

export async function listUserHouseholds(
  userId: string,
): Promise<HouseholdRow[]> {
  const result = await db.query<HouseholdRow>(AUTH_QUERIES.listUserHouseholds, [
    userId,
  ]);

  return result.rows;
}

export async function findRefreshSessionForUpdate(
  client: PoolClient,
  tokenHash: string,
): Promise<RefreshRow | undefined> {
  const result = await client.query<RefreshRow>(
    AUTH_QUERIES.findRefreshSessionForUpdate,
    [tokenHash],
  );

  return result.rows[0];
}

export async function revokeSessionOnRefreshTokenReuse(
  client: PoolClient,
  sessionId: string,
): Promise<void> {
  await client.query(AUTH_QUERIES.revokeSessionOnRefreshTokenReuse, [
    sessionId,
  ]);
}

export async function revokeRefreshTokensForSession(
  client: PoolClient,
  sessionId: string,
): Promise<void> {
  await client.query(AUTH_QUERIES.revokeRefreshTokensForSession, [sessionId]);
}

export async function revokeSessionForInactiveUser(
  client: PoolClient,
  sessionId: string,
): Promise<void> {
  await client.query(AUTH_QUERIES.revokeSessionForInactiveUser, [sessionId]);
}

export async function consumeRefreshToken(
  client: PoolClient,
  refreshTokenId: string,
): Promise<number | null> {
  const result = await client.query(AUTH_QUERIES.consumeRefreshToken, [
    refreshTokenId,
  ]);

  return result.rowCount;
}

export async function insertReplacementRefreshToken(
  client: PoolClient,
  sessionId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<CreatedIdRow | undefined> {
  const result = await client.query<CreatedIdRow>(
    AUTH_QUERIES.insertReplacementRefreshToken,
    [sessionId, tokenHash, expiresAt],
  );

  return result.rows[0];
}

export async function linkReplacementRefreshToken(
  client: PoolClient,
  refreshTokenId: string,
  replacementTokenId: string,
): Promise<void> {
  await client.query(AUTH_QUERIES.linkReplacementRefreshToken, [
    refreshTokenId,
    replacementTokenId,
  ]);
}

export async function updateSessionLastUsed(
  client: PoolClient,
  sessionId: string,
  expiresAt: Date,
): Promise<void> {
  await client.query(AUTH_QUERIES.updateSessionLastUsed, [
    sessionId,
    expiresAt,
  ]);
}

export async function revokeSessionOnLogout(
  client: PoolClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  await client.query(AUTH_QUERIES.revokeSessionOnLogout, [sessionId, userId]);
}

export async function revokeRefreshTokensOnLogout(
  client: PoolClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  await client.query(AUTH_QUERIES.revokeRefreshTokensOnLogout, [
    sessionId,
    userId,
  ]);
}
