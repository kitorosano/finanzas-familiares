import type { FastifySchema } from 'fastify';

import { EMAIL_PATTERN, UUID_PATTERN } from '../../constants/patterns.js';
import { SCHEMA_ADDITIONAL_PROPERTIES } from '../../constants/schema.js';

import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
} from './auth.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

export const AUTH_LOGIN_SCHEMA = {
  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    required: ['email', 'password'],
    properties: {
      email: {
        type: 'string',
        minLength: AUTH_EMAIL_MIN_LENGTH,
        maxLength: AUTH_EMAIL_MAX_LENGTH,
        pattern: EMAIL_PATTERN,
      },
      password: {
        type: 'string',
        minLength: AUTH_PASSWORD_MIN_LENGTH,
        maxLength: AUTH_PASSWORD_MAX_LENGTH,
      },
      householdId: uuidSchema,
    },
  },
} satisfies FastifySchema;
