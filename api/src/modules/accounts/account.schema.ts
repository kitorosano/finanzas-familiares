import type { FastifySchema } from 'fastify';

import { CURRENCY_CODES } from '../../constants/money.js';
import { UUID_PATTERN } from '../../constants/patterns.js';
import { SCHEMA_ADDITIONAL_PROPERTIES } from '../../constants/schema.js';

import {
  ACCOUNT_INCLUDE_INACTIVE_DEFAULT,
  ACCOUNT_TYPES,
} from './account.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

export const ACCOUNT_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
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
        default: ACCOUNT_INCLUDE_INACTIVE_DEFAULT,
      },
    },
  },
} satisfies FastifySchema;

export const ACCOUNT_DETAIL_SCHEMA = {
  params: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    required: ['accountId'],
    properties: {
      accountId: uuidSchema,
    },
  },
} satisfies FastifySchema;
