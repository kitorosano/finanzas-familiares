import type { FastifySchema } from 'fastify';

import { CURRENCY_CODES } from '../../constants/money.js';
import { UUID_PATTERN } from '../../constants/patterns.js';

import {
  SCHEMA_ADDITIONAL_PROPERTIES,
  SCHEMA_MIN_PROPERTIES,
} from '../../constants/schema.js';

import {
  SAVINGS_GOAL_AMOUNT_EXCLUSIVE_MINIMUM,
  SAVINGS_GOAL_CONTRIBUTION_NOTES_MAX_LENGTH,
  SAVINGS_GOAL_CONTRIBUTION_STATUSES,
  SAVINGS_GOAL_CONTRIBUTIONS_LIMIT_DEFAULT,
  SAVINGS_GOAL_CONTRIBUTIONS_LIMIT_MAX,
  SAVINGS_GOAL_CONTRIBUTIONS_LIMIT_MIN,
  SAVINGS_GOAL_CONTRIBUTIONS_OFFSET_DEFAULT,
  SAVINGS_GOAL_CONTRIBUTIONS_OFFSET_MIN,
  SAVINGS_GOAL_DESCRIPTION_MAX_LENGTH,
  SAVINGS_GOAL_LIST_LIMIT_DEFAULT,
  SAVINGS_GOAL_LIST_LIMIT_MAX,
  SAVINGS_GOAL_LIST_LIMIT_MIN,
  SAVINGS_GOAL_LIST_OFFSET_DEFAULT,
  SAVINGS_GOAL_LIST_OFFSET_MIN,
  SAVINGS_GOAL_NAME_MAX_LENGTH,
  SAVINGS_GOAL_NAME_MIN_LENGTH,
  SAVINGS_GOAL_STATUSES,
  SAVINGS_GOAL_VOID_REASON_MAX_LENGTH,
  SAVINGS_GOAL_VOID_REASON_MIN_LENGTH,
} from './savings-goal.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const goalParamsSchema = {
  type: 'object',
  additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
  required: ['goalId'],
  properties: {
    goalId: uuidSchema,
  },
};

const contributionParamsSchema = {
  type: 'object',
  additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
  required: ['goalId', 'contributionId'],
  properties: {
    goalId: uuidSchema,
    contributionId: uuidSchema,
  },
};

const goalNameSchema = {
  type: 'string',
  minLength: SAVINGS_GOAL_NAME_MIN_LENGTH,
  maxLength: SAVINGS_GOAL_NAME_MAX_LENGTH,
};

const goalDescriptionSchema = {
  type: ['string', 'null'],
  maxLength: SAVINGS_GOAL_DESCRIPTION_MAX_LENGTH,
};

const goalAmountSchema = {
  type: 'number',
  exclusiveMinimum: SAVINGS_GOAL_AMOUNT_EXCLUSIVE_MINIMUM,
};

const goalCurrencySchema = {
  type: 'string',
  enum: [...CURRENCY_CODES],
};

const goalDateSchema = {
  type: ['string', 'null'],
  format: 'date',
};

const exchangeRateSchema = {
  type: 'number',
  exclusiveMinimum: SAVINGS_GOAL_AMOUNT_EXCLUSIVE_MINIMUM,
};

// =======================================================
// LIST SAVINGS GOALS
// =======================================================

export const SAVINGS_GOAL_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,

    properties: {
      status: {
        type: 'string',
        enum: [...SAVINGS_GOAL_STATUSES],
      },

      limit: {
        type: 'integer',
        minimum: SAVINGS_GOAL_LIST_LIMIT_MIN,
        maximum: SAVINGS_GOAL_LIST_LIMIT_MAX,
        default: SAVINGS_GOAL_LIST_LIMIT_DEFAULT,
      },

      offset: {
        type: 'integer',
        minimum: SAVINGS_GOAL_LIST_OFFSET_MIN,
        default: SAVINGS_GOAL_LIST_OFFSET_DEFAULT,
      },
    },
  },
} satisfies FastifySchema;

// =======================================================
// SAVINGS GOAL DETAIL
// =======================================================

export const SAVINGS_GOAL_DETAIL_SCHEMA = {
  params: goalParamsSchema,
} satisfies FastifySchema;

// =======================================================
// CREATE SAVINGS GOAL
// =======================================================

export const SAVINGS_GOAL_CREATE_SCHEMA = {
  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,

    required: ['name', 'targetAmount', 'currencyCode'],

    properties: {
      name: goalNameSchema,
      description: goalDescriptionSchema,
      targetAmount: goalAmountSchema,
      currencyCode: goalCurrencySchema,
      targetDate: goalDateSchema,
    },
  },
} satisfies FastifySchema;

// =======================================================
// UPDATE SAVINGS GOAL
// =======================================================

export const SAVINGS_GOAL_UPDATE_SCHEMA = {
  params: goalParamsSchema,

  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    minProperties: SCHEMA_MIN_PROPERTIES,

    properties: {
      name: goalNameSchema,
      description: goalDescriptionSchema,
      targetAmount: goalAmountSchema,
      currencyCode: goalCurrencySchema,
      targetDate: goalDateSchema,

      status: {
        type: 'string',
        enum: [...SAVINGS_GOAL_STATUSES],
      },
    },
  },
} satisfies FastifySchema;

// =======================================================
// LIST CONTRIBUTIONS
// =======================================================

export const SAVINGS_GOAL_CONTRIBUTIONS_LIST_SCHEMA = {
  params: goalParamsSchema,

  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,

    properties: {
      status: {
        type: 'string',
        enum: [...SAVINGS_GOAL_CONTRIBUTION_STATUSES],
      },

      limit: {
        type: 'integer',
        minimum: SAVINGS_GOAL_CONTRIBUTIONS_LIMIT_MIN,
        maximum: SAVINGS_GOAL_CONTRIBUTIONS_LIMIT_MAX,
        default: SAVINGS_GOAL_CONTRIBUTIONS_LIMIT_DEFAULT,
      },

      offset: {
        type: 'integer',
        minimum: SAVINGS_GOAL_CONTRIBUTIONS_OFFSET_MIN,
        default: SAVINGS_GOAL_CONTRIBUTIONS_OFFSET_DEFAULT,
      },
    },
  },
} satisfies FastifySchema;

// =======================================================
// CREATE CONTRIBUTION
// =======================================================

export const SAVINGS_GOAL_CONTRIBUTION_CREATE_SCHEMA = {
  params: goalParamsSchema,

  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,

    required: ['sourceAccountId', 'destinationAccountId', 'amount'],

    properties: {
      sourceAccountId: uuidSchema,
      destinationAccountId: uuidSchema,

      amount: goalAmountSchema,
      sourceAmount: goalAmountSchema,

      exchangeRateToBase: exchangeRateSchema,
      transferExchangeRateToBase: exchangeRateSchema,

      occurredAt: {
        type: 'string',
        format: 'date-time',
      },

      notes: {
        type: ['string', 'null'],
        maxLength: SAVINGS_GOAL_CONTRIBUTION_NOTES_MAX_LENGTH,
      },
    },
  },
} satisfies FastifySchema;

// =======================================================
// VOID CONTRIBUTION
// =======================================================

export const SAVINGS_GOAL_CONTRIBUTION_VOID_SCHEMA = {
  params: contributionParamsSchema,

  body: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,

    required: ['reason'],

    properties: {
      reason: {
        type: 'string',
        minLength: SAVINGS_GOAL_VOID_REASON_MIN_LENGTH,
        maxLength: SAVINGS_GOAL_VOID_REASON_MAX_LENGTH,
      },
    },
  },
} satisfies FastifySchema;
