import type { FastifySchema } from 'fastify';

import { EMAIL_PATTERN, UUID_PATTERN } from '../../constants/patterns.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

export const AUTH_LOGIN_SCHEMA = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: {
        type: 'string',
        minLength: 3,
        maxLength: 254,
        pattern: EMAIL_PATTERN,
      },
      password: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
      },
      householdId: uuidSchema,
    },
  },
} satisfies FastifySchema;
