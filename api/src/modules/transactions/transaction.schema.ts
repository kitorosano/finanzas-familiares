import type { FastifySchema } from 'fastify';

import { UUID_PATTERN } from '../../constants/patterns.js';

import {
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from './transaction.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const transactionCommonProperties = {
  accountId: uuidSchema,
  amount: {
    type: 'number',
    exclusiveMinimum: 0,
  },
  occurredAt: {
    type: 'string',
    format: 'date-time',
  },
  description: {
    type: ['string', 'null'],
    maxLength: 1000,
  },
  notes: {
    type: ['string', 'null'],
    maxLength: 5000,
  },
  status: {
    type: 'string',
    enum: [...TRANSACTION_STATUSES],
  },
  exchangeRateToBase: {
    type: 'number',
    exclusiveMinimum: 0,
  },
};

export const TRANSACTION_CREATE_SCHEMA = {
  body: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['transactionType', 'accountId', 'amount', 'categoryId'],
        properties: {
          ...transactionCommonProperties,
          transactionType: {
            type: 'string',
            enum: TRANSACTION_TYPES.filter(
              (transactionType) => transactionType !== 'transfer',
            ),
          },
          categoryId: uuidSchema,
          installmentsCount: {
            type: 'integer',
            minimum: 1,
            maximum: 240,
          },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
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
            exclusiveMinimum: 0,
          },
          transferExchangeRateToBase: {
            type: 'number',
            exclusiveMinimum: 0,
          },
        },
      },
    ],
  },
} satisfies FastifySchema;
