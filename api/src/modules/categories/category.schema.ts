import type { FastifySchema } from 'fastify';

import { UUID_PATTERN } from '../../constants/patterns.js';
import {
  SCHEMA_ADDITIONAL_PROPERTIES,
  SCHEMA_MIN_PROPERTIES,
} from '../../constants/schema.js';

import {
  CATEGORY_INCLUDE_INACTIVE_DEFAULT,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_NAME_MIN_LENGTH,
  CATEGORY_TYPES,
} from './category.constants.js';

const uuidSchema = {
  type: 'string',
  pattern: UUID_PATTERN,
} as const;

const categoryParamsSchema = {
  type: 'object',
  additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
  required: ['categoryId'],
  properties: {
    categoryId: uuidSchema,
  },
};

export const CATEGORY_LIST_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    properties: {
      categoryType: {
        type: 'string',
        enum: [...CATEGORY_TYPES],
      },
      includeInactive: {
        type: 'boolean',
        default: CATEGORY_INCLUDE_INACTIVE_DEFAULT,
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
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    required: ['name', 'categoryType'],
    properties: {
      name: {
        type: 'string',
        minLength: CATEGORY_NAME_MIN_LENGTH,
        maxLength: CATEGORY_NAME_MAX_LENGTH,
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
    additionalProperties: SCHEMA_ADDITIONAL_PROPERTIES,
    minProperties: SCHEMA_MIN_PROPERTIES,
    properties: {
      name: {
        type: 'string',
        minLength: CATEGORY_NAME_MIN_LENGTH,
        maxLength: CATEGORY_NAME_MAX_LENGTH,
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
