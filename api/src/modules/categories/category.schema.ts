import type { FastifySchema } from 'fastify';

import { UUID_PATTERN } from '../../constants/patterns.js';

import { CATEGORY_TYPES } from './category.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const categoryParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryId'],
  properties: {
    categoryId: uuidSchema,
  },
};

export const CATEGORY_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      categoryType: {
        type: 'string',
        enum: [...CATEGORY_TYPES],
      },
      includeInactive: {
        type: 'boolean',
        default: false,
      },
    },
  },
} satisfies FastifySchema;

export const CATEGORY_DETAIL_SCHEMA = {
  params: categoryParamsSchema,
} satisfies FastifySchema;

export const CATEGORY_CREATE_SCHEMA = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'categoryType'],
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
      },
      categoryType: {
        type: 'string',
        enum: [...CATEGORY_TYPES],
      },
      parentId: {
        type: ['string', 'null'],
        pattern: UUID_PATTERN,
      },
      sortOrder: {
        type: 'integer',
      },
    },
  },
} satisfies FastifySchema;

export const CATEGORY_UPDATE_SCHEMA = {
  params: categoryParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
      },
      parentId: {
        type: ['string', 'null'],
        pattern: UUID_PATTERN,
      },
      sortOrder: {
        type: 'integer',
      },
      isActive: {
        type: 'boolean',
      },
    },
  },
} satisfies FastifySchema;
