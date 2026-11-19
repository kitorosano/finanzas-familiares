import argon2 from 'argon2';

import type { FastifyInstance } from 'fastify';

import type { PoolClient } from 'pg';

import { db } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { ERROR_CODES } from '../../errors/error-codes.js';
import {
  consumeRefreshToken,
  createRefreshToken as insertRefreshToken,
  createSession as insertSession,
  findRefreshSessionForUpdate,
  findUserByEmail,
  insertReplacementRefreshToken,
  linkReplacementRefreshToken,
  listUserHouseholds,
  revokeRefreshTokensForSession,
  revokeRefreshTokensOnLogout,
  revokeSessionForInactiveUser,
  revokeSessionOnLogout,
  revokeSessionOnRefreshTokenReuse,
  updateSessionLastUsed,
} from './auth.db.js';
import { REFRESH_TTL_MS } from './auth.constants.js';
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
  HouseholdRow,
  SessionMetadata,
  SessionResult,
} from './auth.types.js';

async function createSession(
  client: PoolClient,
  app: FastifyInstance,
  user: AuthUser,
  household: HouseholdRow,
  metadata: SessionMetadata,
): Promise<SessionResult> {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  const session = await insertSession(
    client,
    household.household_id,
    user.id,
    expiresAt,
    metadata.ipAddress,
    metadata.userAgent,
  );

  const sessionId = session?.id;

  if (!sessionId) {
    throw new Error('Could not create authentication session');
  }

  const refreshToken = createRefreshToken();

  await insertRefreshToken(
    client,
    sessionId,
    hashRefreshToken(refreshToken),
    expiresAt,
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

  const user = await findUserByEmail(normalizedEmail);

  // Perform an Argon2 verification even when the email
  // doesn't exist or the user has no password configured.
  const hashToVerify = user?.password_hash ?? (await getDummyPasswordHash());

  const passwordValid = await argon2
    .verify(hashToVerify, password)
    .catch(() => false);

  if (!user || !user.is_active || !user.password_hash || !passwordValid) {
    throw invalidCredentialsError();
  }

  const memberships = await listUserHouseholds(user.id);

  if (memberships.length === 0) {
    throw new AppError(
      403,
      ERROR_CODES.NO_HOUSEHOLD_MEMBERSHIP,
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
        ERROR_CODES.HOUSEHOLD_ACCESS_DENIED,
        'El usuario no tiene acceso al hogar solicitado',
      );
    }
  } else if (memberships.length === 1) {
    household = memberships[0];
  } else {
    throw new AppError(
      409,
      ERROR_CODES.HOUSEHOLD_SELECTION_REQUIRED,
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

    const row = await findRefreshSessionForUpdate(
      client,
      hashRefreshToken(rawRefreshToken),
    );

    if (!row) {
      throw new AppError(
        401,
        ERROR_CODES.INVALID_REFRESH_TOKEN,
        'La sesión no es válida o ha expirado',
      );
    }

    // Reusing an already rotated token revokes the complete session.
    if (row.token_used_at !== null) {
      await revokeSessionOnRefreshTokenReuse(client, row.session_id);
      await revokeRefreshTokensForSession(client, row.session_id);

      await client.query('COMMIT');
      transactionOpen = false;

      throw new AppError(
        401,
        ERROR_CODES.REFRESH_TOKEN_REUSE_DETECTED,
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
        ERROR_CODES.INVALID_REFRESH_TOKEN,
        'La sesión no es válida o ha expirado',
      );
    }

    if (!row.is_active) {
      await revokeSessionForInactiveUser(client, row.session_id);
      await revokeRefreshTokensForSession(client, row.session_id);

      await client.query('COMMIT');
      transactionOpen = false;

      throw new AppError(
        401,
        ERROR_CODES.USER_INACTIVE,
        'El usuario no está activo',
      );
    }

    const nextRefreshToken = createRefreshToken();
    const nextExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    // Mark the old token as consumed before inserting the new one.
    const consumedRowCount = await consumeRefreshToken(
      client,
      row.refresh_token_id,
    );

    if (consumedRowCount !== 1) {
      throw new AppError(
        401,
        ERROR_CODES.INVALID_REFRESH_TOKEN,
        'El token de renovación ya no está disponible',
      );
    }

    const nextToken = await insertReplacementRefreshToken(
      client,
      row.session_id,
      hashRefreshToken(nextRefreshToken),
      nextExpiresAt,
    );

    const nextTokenId = nextToken?.id;

    if (!nextTokenId) {
      throw new Error('Could not create replacement refresh token');
    }

    await linkReplacementRefreshToken(
      client,
      row.refresh_token_id,
      nextTokenId,
    );
    await updateSessionLastUsed(client, row.session_id, nextExpiresAt);

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

    await revokeSessionOnLogout(client, sessionId, userId);
    await revokeRefreshTokensOnLogout(client, sessionId, userId);

    await client.query('COMMIT');
  } catch (error) {
    await rollbackSafely(client);
    throw error;
  } finally {
    client.release();
  }
}
