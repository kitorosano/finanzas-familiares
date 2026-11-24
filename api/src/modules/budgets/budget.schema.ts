import type { FastifySchema } from 'fastify';

import { CURRENCY_CODES } from '../../constants/money.js';
import { UUID_PATTERN } from '../../constants/patterns.js';

import {
  SCHEMA_ADDITIONAL_PROPERTIES,
  SCHEMA_MIN_PROPERTIES,
} from '../../constants/schema.js';

import {
  BUDGET_AMOUNT_EXCLUSIVE_MINIMUM,
  BUDGET_INCLUDE_INACTIVE_DEFAULT,
  BUDGET_LIST_LIMIT_DEFAULT,
  BUDGET_LIST_LIMIT_MAX,
  BUDGET_LIST_LIMIT_MIN,
  BUDGET_LIST_OFFSET_DEFAULT,
  BUDGET_LIST_OFFSET_MIN,
  BUDGET_NAME_MAX_LENGTH,
  BUDGET_NAME_MIN_LENGTH,
  BUDGET_NOTES_MAX_LENGTH,
} from './budget.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const budgetParamsSchema = {
  type: 'object',
  additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
  required: ['budgetId'],
  properties: {
    budgetId: uuidSchema,
  },
};

const budgetNameSchema = {
  type: ['string', 'null'],
  minLength: BUDGET_NAME_MIN_LENGTH,
  maxLength: BUDGET_NAME_MAX_LENGTH,
};

const budgetNotesSchema = {
  type: ['string', 'null'],
  maxLength: BUDGET_NOTES_MAX_LENGTH,
};

const budgetAmountSchema = {
  type: 'number',
  exclusiveMinimum: BUDGET_AMOUNT_EXCLUSIVE_MINIMUM,
};

const budgetCurrencySchema = {
  type: 'string',
  enum: [...CURRENCY_CODES],
};

const budgetExchangeRateSchema = {
  type: 'number',
  exclusiveMinimum: BUDGET_AMOUNT_EXCLUSIVE_MINIMUM,
};

const budgetDateSchema = {
  type: 'string',
  format: 'date',
};

export const BUDGET_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    properties: {
      categoryId: uuidSchema,

      includeInactive: {
        type: 'boolean',
        default: BUDGET_INCLUDE_INACTIVE_DEFAULT,
      },

      periodFrom: budgetDateSchema,
      periodTo: budgetDateSchema,

      limit: {
        type: 'integer',
        minimum: BUDGET_LIST_LIMIT_MIN,
        maximum: BUDGET_LIST_LIMIT_MAX,
        default: BUDGET_LIST_LIMIT_DEFAULT,
      },

      offset: {
        type: 'integer',
        minimum: BUDGET_LIST_OFFSET_MIN,
        default: BUDGET_LIST_OFFSET_DEFAULT,
      },
    },
  },
} satisfies FastifySchema;

export const BUDGET_DETAIL_SCHEMA = {
  params: budgetParamsSchema,
} satisfies FastifySchema;

export const BUDGET_CREATE_SCHEMA = {
  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,

    required: [
      'categoryId',
      'periodStart',
      'periodEnd',
      'amount',
      'currencyCode',
    ],

    properties: {
      name: budgetNameSchema,
      categoryId: uuidSchema,

      periodStart: budgetDateSchema,
      periodEnd: budgetDateSchema,

      amount: budgetAmountSchema,
      currencyCode: budgetCurrencySchema,
      exchangeRateToBase: budgetExchangeRateSchema,

      notes: budgetNotesSchema,
    },
  },
} satisfies FastifySchema;

export const BUDGET_UPDATE_SCHEMA = {
  params: budgetParamsSchema,

  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    minProperties: SCHEMA_MIN_PROPERTIES,

    properties: {
      name: budgetNameSchema,
      categoryId: uuidSchema,

      periodStart: budgetDateSchema,
      periodEnd: budgetDateSchema,

      amount: budgetAmountSchema,
      currencyCode: budgetCurrencySchema,
      exchangeRateToBase: budgetExchangeRateSchema,

      notes: budgetNotesSchema,
      isActive: {
        type: 'boolean',
      },
    },
  },
} satisfies FastifySchema;
