import type { FastifySchema } from 'fastify';

import { CURRENCY_CODES } from '../../constants/money.js';
import { UUID_PATTERN } from '../../constants/patterns.js';
import { SCHEMA_ADDITIONAL_PROPERTIES } from '../../constants/schema.js';

import {
  CREDIT_CARD_AMOUNT_EXCLUSIVE_MINIMUM,
  CREDIT_CARD_INCLUDE_INACTIVE_DEFAULT,
  CREDIT_CARD_PAYMENT_NOTES_MAX_LENGTH,
  CREDIT_CARD_STATEMENTS_LIMIT_DEFAULT,
  CREDIT_CARD_STATEMENTS_LIMIT_MAX,
  CREDIT_CARD_STATEMENTS_LIMIT_MIN,
  CREDIT_CARD_STATEMENTS_OFFSET_DEFAULT,
  CREDIT_CARD_STATEMENTS_OFFSET_MAX,
  CREDIT_CARD_STATEMENTS_OFFSET_MIN,
  CREDIT_CARD_STATEMENT_STATUSES,
} from './credit-card.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const creditCardParamsSchema = {
  type: 'object',
  additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
  required: ['cardAccountId'],
  properties: {
    cardAccountId: uuidSchema,
  },
};

export const CREDIT_CARD_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    properties: {
      currencyCode: {
        type: 'string',
        enum: [...CURRENCY_CODES],
      },
      includeInactive: {
        type: 'boolean',
        default: CREDIT_CARD_INCLUDE_INACTIVE_DEFAULT,
      },
    },
  },
} satisfies FastifySchema;

export const CREDIT_CARD_STATEMENTS_SCHEMA = {
  params: creditCardParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
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
        minimum: CREDIT_CARD_STATEMENTS_LIMIT_MIN,
        maximum: CREDIT_CARD_STATEMENTS_LIMIT_MAX,
        default: CREDIT_CARD_STATEMENTS_LIMIT_DEFAULT,
      },
      offset: {
        type: 'integer',
        minimum: CREDIT_CARD_STATEMENTS_OFFSET_MIN,
        maximum: CREDIT_CARD_STATEMENTS_OFFSET_MAX,
        default: CREDIT_CARD_STATEMENTS_OFFSET_DEFAULT,
      },
    },
  },
} satisfies FastifySchema;

export const CREDIT_CARD_STATEMENT_DETAIL_SCHEMA = {
  params: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
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
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    required: ['sourceAccountId', 'amount'],
    properties: {
      sourceAccountId: uuidSchema,
      amount: {
        type: 'number',
        exclusiveMinimum: CREDIT_CARD_AMOUNT_EXCLUSIVE_MINIMUM,
      },
      exchangeRateToBase: {
        type: 'number',
        exclusiveMinimum: CREDIT_CARD_AMOUNT_EXCLUSIVE_MINIMUM,
      },
      occurredAt: {
        type: 'string',
        format: 'date-time',
      },
      notes: {
        type: ['string', 'null'],
        maxLength: CREDIT_CARD_PAYMENT_NOTES_MAX_LENGTH,
      },
    },
  },
} satisfies FastifySchema;
