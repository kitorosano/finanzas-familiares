import type { FastifySchema } from 'fastify';

import { UUID_PATTERN } from '../../constants/patterns.js';
import {
  SCHEMA_ADDITIONAL_PROPERTIES,
  SCHEMA_MIN_PROPERTIES,
} from '../../constants/schema.js';
import { CATEGORY_TYPES } from '../categories/category.constants.js';

import {
  TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_INSTALLMENTS_MAX,
  TRANSACTION_INSTALLMENTS_MIN,
  TRANSACTION_LIST_LIMIT_DEFAULT,
  TRANSACTION_LIST_LIMIT_MAX,
  TRANSACTION_LIST_LIMIT_MIN,
  TRANSACTION_LIST_OFFSET_DEFAULT,
  TRANSACTION_LIST_OFFSET_MIN,
  TRANSACTION_NOTES_MAX_LENGTH,
  TRANSACTION_QUERY_STATUSES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  TRANSACTION_VOID_REASON_MAX_LENGTH,
  TRANSACTION_VOID_REASON_MIN_LENGTH,
} from './transaction.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const transactionCommonProperties = {
  accountId: uuidSchema,
  amount: {
    type: 'number',
    exclusiveMinimum: TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
  },
  occurredAt: {
    type: 'string',
    format: 'date-time',
  },
  description: {
    type: ['string', 'null'],
    maxLength: TRANSACTION_DESCRIPTION_MAX_LENGTH,
  },
  notes: {
    type: ['string', 'null'],
    maxLength: TRANSACTION_NOTES_MAX_LENGTH,
  },
  status: {
    type: 'string',
    enum: [...TRANSACTION_STATUSES],
  },
  exchangeRateToBase: {
    type: 'number',
    exclusiveMinimum: TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
  },
};

export const TRANSACTION_CREATE_SCHEMA = {
  body: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
        required: ['transactionType', 'accountId', 'amount', 'categoryId'],
        properties: {
          ...transactionCommonProperties,
          transactionType: {
            type: 'string',
            enum: [...CATEGORY_TYPES],
          },
          categoryId: uuidSchema,
          installmentsCount: {
            type: 'integer',
            minimum: TRANSACTION_INSTALLMENTS_MIN,
            maximum: TRANSACTION_INSTALLMENTS_MAX,
          },
        },
      },
      {
        type: 'object',
        additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
        required: [
          'transactionType',
          'accountId',
          'amount',
          'transferAccountId',
          'transferAmount',
        ],
        properties: {
          ...transactionCommonProperties,
          transactionType: {
            type: 'string',
            const: 'transfer',
          },
          transferAccountId: uuidSchema,
          transferAmount: {
            type: 'number',
            exclusiveMinimum: TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
          },
          transferExchangeRateToBase: {
            type: 'number',
            exclusiveMinimum: TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
          },
        },
      },
    ],
  },
} satisfies FastifySchema;

export const TRANSACTION_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    properties: {
      accountId: uuidSchema,
      categoryId: uuidSchema,
      transactionType: {
        type: 'string',
        enum: [...TRANSACTION_TYPES],
      },
      status: {
        type: 'string',
        enum: [...TRANSACTION_QUERY_STATUSES],
      },
      occurredFrom: {
        type: 'string',
        format: 'date',
      },
      occurredTo: {
        type: 'string',
        format: 'date',
      },
      limit: {
        type: 'integer',
        minimum: TRANSACTION_LIST_LIMIT_MIN,
        maximum: TRANSACTION_LIST_LIMIT_MAX,
        default: TRANSACTION_LIST_LIMIT_DEFAULT,
      },
      offset: {
        type: 'integer',
        minimum: TRANSACTION_LIST_OFFSET_MIN,
        default: TRANSACTION_LIST_OFFSET_DEFAULT,
      },
    },
  },
} satisfies FastifySchema;

export const TRANSACTION_DETAIL_SCHEMA = {
  params: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    required: ['transactionId'],
    properties: {
      transactionId: uuidSchema,
    },
  },
} satisfies FastifySchema;

export const TRANSACTION_UPDATE_SCHEMA = {
  params: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    required: ['transactionId'],
    properties: {
      transactionId: uuidSchema,
    },
  },

  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    minProperties: SCHEMA_MIN_PROPERTIES,

    properties: {
      accountId: uuidSchema,

      amount: {
        type: 'number',
        exclusiveMinimum: TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
      },

      occurredAt: {
        type: 'string',
        format: 'date-time',
      },

      description: {
        type: ['string', 'null'],
        maxLength: TRANSACTION_DESCRIPTION_MAX_LENGTH,
      },

      notes: {
        type: ['string', 'null'],
        maxLength: TRANSACTION_NOTES_MAX_LENGTH,
      },

      status: {
        type: 'string',
        enum: [...TRANSACTION_STATUSES],
      },

      exchangeRateToBase: {
        type: 'number',
        exclusiveMinimum: TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
      },

      categoryId: uuidSchema,

      transferAccountId: uuidSchema,

      transferAmount: {
        type: 'number',
        exclusiveMinimum: TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
      },

      transferExchangeRateToBase: {
        type: 'number',
        exclusiveMinimum: TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM,
      },
    },
  },
} satisfies FastifySchema;

export const TRANSACTION_VOID_SCHEMA = {
  params: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    required: ['transactionId'],
    properties: {
      transactionId: uuidSchema,
    },
  },

  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    required: ['reason'],
    properties: {
      reason: {
        type: 'string',
        minLength: TRANSACTION_VOID_REASON_MIN_LENGTH,
        maxLength: TRANSACTION_VOID_REASON_MAX_LENGTH,
      },
    },
  },
} satisfies FastifySchema;
