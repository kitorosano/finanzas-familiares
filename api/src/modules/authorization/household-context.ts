import type { FastifyRequest } from 'fastify';

import { AppError } from '../../errors/app-error.js';

import type { AuthContext } from '../auth/auth.types.js';

export interface HouseholdScope {
  householdId: string;
  userId: string;
}

export function requireAuthContext(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new AppError(
      401,
      'UNAUTHORIZED',
      'Se requiere una sesión autenticada',
    );
  }

  return request.auth;
}

export function getHouseholdScope(request: FastifyRequest): HouseholdScope {
  const auth = requireAuthContext(request);

  return {
    householdId: auth.household.id,
    userId: auth.user.id,
  };
}
