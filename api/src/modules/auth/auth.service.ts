import argon2 from 'argon2';

import type { FastifyInstance } from 'fastify';

import type { PoolClient } from 'pg';

import { db } from '../../db.js';
import { AppError } from '../../errors/app-error.js';
import { ARGON2_OPTIONS, REFRESH_TTL_MS } from './auth.constants.js';
import {
  createAccessToken,
  createAuthResponse,
  createRefreshToken,
  getDummyPasswordHash,
  hashRefreshToken,
  invalidCredentialsError,
  rollbackSafely,
} from './auth.utils.js';

import type {
  AuthUser,
  CreatedIdRow,
  HouseholdRow,
  RefreshRow,
  SessionMetadata,
  SessionResult,
  UserRow,
} from './auth.types.js';

async function createSession(
  client: PoolClient,
  app: FastifyInstance,
  user: AuthUser,
  household: HouseholdRow,
  metadata: SessionMetadata,
): Promise<SessionResult> {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  const sessionResult = await client.query<CreatedIdRow>(
    `
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
    [
      household.household_id,
      user.id,
      expiresAt,
      metadata.ipAddress,
      metadata.userAgent,
    ],
  );

  const sessionId = sessionResult.rows[0]?.id;

  if (!sessionId) {
    throw new Error('Could not create authentication session');
  }

  const refreshToken = createRefreshToken();

  await client.query(
    `
      INSERT INTO auth_refresh_tokens (
        session_id,
        token_hash,
        expires_at
      )
      VALUES ($1, $2, $3)
    `,
    [sessionId, hashRefreshToken(refreshToken), expiresAt],
  );

  const accessToken = createAccessToken(
    app,
    user.id,
    sessionId,
    household.household_id,
  );

  return {
    refreshToken,
    accessToken,
    authResponse: createAuthResponse(accessToken, user, {
      id: household.household_id,
      name: household.household_name,
      baseCurrencyCode: household.base_currency_code,
      role: household.role,
    }),
  };
}

export async function loginUser(
  app: FastifyInstance,
  email: string,
  password: string,
  householdId: string | undefined,
  metadata: SessionMetadata,
): Promise<SessionResult> {
  const normalizedEmail = email.trim().toLowerCase();

  const userResult = await db.query<UserRow>(
    `
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
    [normalizedEmail],
  );

  const user = userResult.rows[0];

  // Perform an Argon2 verification even when the email
  // doesn't exist or the user has no password configured.
  const hashToVerify = user?.password_hash ?? (await getDummyPasswordHash());

  const passwordValid = await argon2
    .verify(hashToVerify, password)
    .catch(() => false);

  if (!user || !user.is_active || !user.password_hash || !passwordValid) {
    throw invalidCredentialsError();
  }

  const membershipsResult = await db.query<HouseholdRow>(
    `
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
    [user.id],
  );

  const memberships = membershipsResult.rows;

  if (memberships.length === 0) {
    throw new AppError(
      403,
      'NO_HOUSEHOLD_MEMBERSHIP',
      'El usuario no pertenece a ningún hogar activo',
    );
  }

  let household: HouseholdRow | undefined;

  if (householdId) {
    household = memberships.find(
      (membership) => membership.household_id === householdId,
    );

    if (!household) {
      throw new AppError(
        403,
        'HOUSEHOLD_ACCESS_DENIED',
        'El usuario no tiene acceso al hogar solicitado',
      );
    }
  } else if (memberships.length === 1) {
    household = memberships[0];
  } else {
    throw new AppError(
      409,
      'HOUSEHOLD_SELECTION_REQUIRED',
      'Se debe seleccionar un hogar para iniciar sesión',
    );
  }

  if (!household) {
    throw new Error('Household resolution failed');
  }

  const client = await db.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const result = await createSession(
      client,
      app,
      {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
      household,
      metadata,
    );

    await client.query('COMMIT');
    transactionOpen = false;

    return result;
  } catch (error) {
    if (transactionOpen) {
      await rollbackSafely(client);
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function refreshSession(
  app: FastifyInstance,
  rawRefreshToken: string,
): Promise<SessionResult> {
  const client = await db.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;

    const result = await client.query<RefreshRow>(
      `
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
      [hashRefreshToken(rawRefreshToken)],
    );

    const row = result.rows[0];

    if (!row) {
      throw new AppError(
        401,
        'INVALID_REFRESH_TOKEN',
        'La sesión no es válida o ha expirado',
      );
    }

    // Reusing an already rotated token revokes the complete session.
    if (row.token_used_at !== null) {
      await client.query(
        `
          UPDATE auth_sessions
          SET
            revoked_at = COALESCE(revoked_at, NOW()),
            revoked_reason = 'refresh_token_reuse'
          WHERE id = $1
        `,
        [row.session_id],
      );

      await client.query(
        `
          UPDATE auth_refresh_tokens
          SET revoked_at = COALESCE(revoked_at, NOW())
          WHERE session_id = $1
        `,
        [row.session_id],
      );

      await client.query('COMMIT');
      transactionOpen = false;

      throw new AppError(
        401,
        'REFRESH_TOKEN_REUSE_DETECTED',
        'Se detectó la reutilización de un token de renovación',
      );
    }

    const now = Date.now();

    if (
      row.token_revoked_at !== null ||
      row.session_revoked_at !== null ||
      row.token_expires_at.getTime() <= now ||
      row.session_expires_at.getTime() <= now
    ) {
      throw new AppError(
        401,
        'INVALID_REFRESH_TOKEN',
        'La sesión no es válida o ha expirado',
      );
    }

    if (!row.is_active) {
      await client.query(
        `
          UPDATE auth_sessions
          SET
            revoked_at = COALESCE(revoked_at, NOW()),
            revoked_reason = 'user_inactive'
          WHERE id = $1
        `,
        [row.session_id],
      );

      await client.query(
        `
          UPDATE auth_refresh_tokens
          SET revoked_at = COALESCE(revoked_at, NOW())
          WHERE session_id = $1
        `,
        [row.session_id],
      );

      await client.query('COMMIT');
      transactionOpen = false;

      throw new AppError(401, 'USER_INACTIVE', 'El usuario no está activo');
    }

    const nextRefreshToken = createRefreshToken();
    const nextExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    // Mark the old token as consumed before inserting the new one.
    const consumedResult = await client.query(
      `
        UPDATE auth_refresh_tokens
        SET used_at = NOW()
        WHERE id = $1
          AND used_at IS NULL
          AND revoked_at IS NULL
      `,
      [row.refresh_token_id],
    );

    if (consumedResult.rowCount !== 1) {
      throw new AppError(
        401,
        'INVALID_REFRESH_TOKEN',
        'El token de renovación ya no está disponible',
      );
    }

    const nextTokenResult = await client.query<CreatedIdRow>(
      `
        INSERT INTO auth_refresh_tokens (
          session_id,
          token_hash,
          expires_at
        )
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [row.session_id, hashRefreshToken(nextRefreshToken), nextExpiresAt],
    );

    const nextTokenId = nextTokenResult.rows[0]?.id;

    if (!nextTokenId) {
      throw new Error('Could not create replacement refresh token');
    }

    await client.query(
      `
        UPDATE auth_refresh_tokens
        SET replaced_by_token_id = $2
        WHERE id = $1
      `,
      [row.refresh_token_id, nextTokenId],
    );

    await client.query(
      `
        UPDATE auth_sessions
        SET
          last_used_at = NOW(),
          expires_at = $2
        WHERE id = $1
      `,
      [row.session_id, nextExpiresAt],
    );

    const user = {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
    };

    const household = {
      household_id: row.household_id,
      household_name: row.household_name,
      base_currency_code: row.base_currency_code,
      role: row.role,
    };

    const accessToken = createAccessToken(
      app,
      row.user_id,
      row.session_id,
      row.household_id,
    );

    await client.query('COMMIT');
    transactionOpen = false;

    return {
      refreshToken: nextRefreshToken,
      accessToken,
      authResponse: createAuthResponse(accessToken, user, {
        id: household.household_id,
        name: household.household_name,
        baseCurrencyCode: household.base_currency_code,
        role: household.role,
      }),
    };
  } catch (error) {
    if (transactionOpen) {
      await rollbackSafely(client);
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function revokeSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE auth_sessions
        SET
          revoked_at = COALESCE(revoked_at, NOW()),
          revoked_reason = 'logout'
        WHERE id = $1
          AND user_id = $2
      `,
      [sessionId, userId],
    );

    await client.query(
      `
        UPDATE auth_refresh_tokens rt
        SET revoked_at = COALESCE(rt.revoked_at, NOW())
        FROM auth_sessions s
        WHERE rt.session_id = s.id
          AND s.id = $1
          AND s.user_id = $2
      `,
      [sessionId, userId],
    );

    await client.query('COMMIT');
  } catch (error) {
    await rollbackSafely(client);
    throw error;
  } finally {
    client.release();
  }
}
