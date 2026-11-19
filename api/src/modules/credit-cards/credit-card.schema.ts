import type { FastifySchema } from 'fastify';

import { CURRENCY_CODES } from '../../constants/money.js';
import { UUID_PATTERN } from '../../constants/patterns.js';

import { CREDIT_CARD_STATEMENT_STATUSES } from './credit-card.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const creditCardParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cardAccountId'],
  properties: {
    cardAccountId: uuidSchema,
  },
};

export const CREDIT_CARD_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
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

export const CREDIT_CARD_STATEMENTS_SCHEMA = {
  params: creditCardParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: {
        type: 'string',
        enum: [...CREDIT_CARD_STATEMENT_STATUSES],
      },
      dueFrom: {
        type: 'string',
        format: 'date',
      },
      dueTo: {
        type: 'string',
        format: 'date',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
      offset: {
        type: 'integer',
        minimum: 0,
        maximum: 100000,
        default: 0,
      },
    },
  },
} satisfies FastifySchema;

export const CREDIT_CARD_STATEMENT_DETAIL_SCHEMA = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['cardAccountId', 'statementId'],
    properties: {
      cardAccountId: uuidSchema,
      statementId: uuidSchema,
    },
  },
} satisfies FastifySchema;

export const CREDIT_CARD_DETAIL_SCHEMA = {
  params: creditCardParamsSchema,
} satisfies FastifySchema;

export const CREDIT_CARD_PAYMENT_SCHEMA = {
  params: creditCardParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['sourceAccountId', 'amount'],
    properties: {
      sourceAccountId: uuidSchema,
      amount: {
        type: 'number',
        exclusiveMinimum: 0,
      },
      exchangeRateToBase: {
        type: 'number',
        exclusiveMinimum: 0,
      },
      occurredAt: {
        type: 'string',
        format: 'date-time',
      },
      notes: {
        type: ['string', 'null'],
        maxLength: 5000,
      },
    },
  },
} satisfies FastifySchema;
