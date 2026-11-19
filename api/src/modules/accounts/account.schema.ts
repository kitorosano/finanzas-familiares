import type { FastifySchema } from 'fastify';

import { CURRENCY_CODES } from '../../constants/money.js';
import { UUID_PATTERN } from '../../constants/patterns.js';

import { ACCOUNT_TYPES } from './account.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

export const ACCOUNT_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      accountType: {
        type: 'string',
        enum: [...ACCOUNT_TYPES],
      },
      currencyCode: {
        type: 'string',
        enum: [...CURRENCY_CODES],
      },
      includeInactive: {
        type: 'boolean',
        default: false,
      },
    },
  },
} satisfies FastifySchema;

export const ACCOUNT_DETAIL_SCHEMA = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['accountId'],
    properties: {
      accountId: uuidSchema,
    },
  },
} satisfies FastifySchema;
