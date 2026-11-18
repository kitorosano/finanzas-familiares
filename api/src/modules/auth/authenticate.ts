import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db.js';

import type { AuthenticatedSessionRow } from './auth.types.js';

export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({
      error: 'UNAUTHORIZED',
      message: 'Token de acceso inválido o expirado',
    });
    return;
  }

  const payload = request.user;

  if (
    payload.tokenType !== 'access' ||
    !payload.sub ||
    !payload.sid ||
    !payload.hid
  ) {
    reply.code(401).send({
      error: 'INVALID_TOKEN',
      message: 'El token no tiene los permisos necesarios',
    });
    return;
  }

  // Checking every request makes logout and revocation effective immediately.
  const result = await db.query<AuthenticatedSessionRow>(
    `
      SELECT
        s.id AS session_id,
        u.id AS user_id,
        u.email,
        u.display_name,
        h.id AS household_id,
        h.name AS household_name,
        h.base_currency_code,
        hm.role

      FROM auth_sessions s
      JOIN users u
        ON u.id = s.user_id
      JOIN household_members hm
        ON hm.user_id = s.user_id
       AND hm.household_id = s.household_id
      JOIN households h
        ON h.id = s.household_id

      WHERE s.id = $1
        AND s.user_id = $2
        AND s.household_id = $3
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_active = TRUE
    `,
    [payload.sid, payload.sub, payload.hid],
  );

  const session = result.rows[0];

  if (!session) {
    reply.code(401).send({
      error: 'SESSION_EXPIRED',
      message: 'La sesión no existe, expiró o fue revocada',
    });
    return;
  }

  request.auth = {
    sessionId: session.session_id,
    user: {
      id: session.user_id,
      email: session.email,
      displayName: session.display_name,
    },
    household: {
      id: session.household_id,
      name: session.household_name,
      baseCurrencyCode: session.base_currency_code,
      role: session.role,
    },
  };
}
