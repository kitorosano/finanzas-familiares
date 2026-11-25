import type { FastifySchema } from 'fastify';

import { UUID_PATTERN } from '../../constants/patterns.js';

import {
  SCHEMA_ADDITIONAL_PROPERTIES,
  SCHEMA_MIN_PROPERTIES,
} from '../../constants/schema.js';

import {
  RECURRING_TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
  RECURRING_TRANSACTION_DESCRIPTION_MAX_LENGTH,
  RECURRING_TRANSACTION_DESCRIPTION_MIN_LENGTH,
  RECURRING_TRANSACTION_FREQUENCIES,
  RECURRING_TRANSACTION_INCLUDE_INACTIVE_DEFAULT,
  RECURRING_TRANSACTION_INTERVAL_MAX,
  RECURRING_TRANSACTION_INTERVAL_MIN,
  RECURRING_TRANSACTION_LIST_LIMIT_DEFAULT,
  RECURRING_TRANSACTION_LIST_LIMIT_MAX,
  RECURRING_TRANSACTION_LIST_LIMIT_MIN,
  RECURRING_TRANSACTION_LIST_OFFSET_DEFAULT,
  RECURRING_TRANSACTION_LIST_OFFSET_MIN,
  RECURRING_TRANSACTION_TYPES,
} from './recurring-transaction.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const dateSchema = {
  type: 'string',
  format: 'date',
} as const;

const descriptionSchema = {
  type: 'string',
  minLength: RECURRING_TRANSACTION_DESCRIPTION_MIN_LENGTH,
  maxLength: RECURRING_TRANSACTION_DESCRIPTION_MAX_LENGTH,
} as const;

const amountSchema = {
  type: 'number',
  exclusiveMinimum: RECURRING_TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
} as const;

const intervalSchema = {
  type: 'integer',
  minimum: RECURRING_TRANSACTION_INTERVAL_MIN,
  maximum: RECURRING_TRANSACTION_INTERVAL_MAX,
} as const;

const transactionTypeSchema = {
  type: 'string',
  enum: [...RECURRING_TRANSACTION_TYPES],
} as const;

const frequencySchema = {
  type: 'string',
  enum: [...RECURRING_TRANSACTION_FREQUENCIES],
} as const;

const recurringTransactionParamsSchema = {
  type: 'object',
  additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
  required: ['recurringTransactionId'],
  properties: {
    recurringTransactionId: uuidSchema,
  },
};

const endDateSchema = {
  type: ['string', 'null'],
  format: 'date',
} as const;

export const RECURRING_TRANSACTION_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,

    properties: {
      accountId: uuidSchema,
      categoryId: uuidSchema,

      transactionType: transactionTypeSchema,
      frequency: frequencySchema,

      includeInactive: {
        type: 'boolean',
        default: RECURRING_TRANSACTION_INCLUDE_INACTIVE_DEFAULT,
      },

      nextOccurrenceFrom: dateSchema,
      nextOccurrenceTo: dateSchema,

      limit: {
        type: 'integer',
        minimum: RECURRING_TRANSACTION_LIST_LIMIT_MIN,
        maximum: RECURRING_TRANSACTION_LIST_LIMIT_MAX,
        default: RECURRING_TRANSACTION_LIST_LIMIT_DEFAULT,
      },

      offset: {
        type: 'integer',
        minimum: RECURRING_TRANSACTION_LIST_OFFSET_MIN,
        default: RECURRING_TRANSACTION_LIST_OFFSET_DEFAULT,
      },
    },
  },
} satisfies FastifySchema;

export const RECURRING_TRANSACTION_DETAIL_SCHEMA = {
  params: recurringTransactionParamsSchema,
} satisfies FastifySchema;

export const RECURRING_TRANSACTION_CREATE_SCHEMA = {
  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,

    required: [
      'transactionType',
      'description',
      'amount',
      'accountId',
      'categoryId',
      'frequency',
      'startDate',
    ],

    properties: {
      transactionType: transactionTypeSchema,
      description: descriptionSchema,
      amount: amountSchema,

      accountId: uuidSchema,
      categoryId: uuidSchema,

      frequency: frequencySchema,
      intervalValue: intervalSchema,

      startDate: dateSchema,
      endDate: endDateSchema,
    },
  },
} satisfies FastifySchema;

export const RECURRING_TRANSACTION_UPDATE_SCHEMA = {
  params: recurringTransactionParamsSchema,

  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    minProperties: SCHEMA_MIN_PROPERTIES,

    properties: {
      transactionType: transactionTypeSchema,
      description: descriptionSchema,
      amount: amountSchema,

      accountId: uuidSchema,
      categoryId: uuidSchema,

      frequency: frequencySchema,
      intervalValue: intervalSchema,

      startDate: dateSchema,
      endDate: endDateSchema,

      isActive: {
        type: 'boolean',
      },
    },
  },
} satisfies FastifySchema;
