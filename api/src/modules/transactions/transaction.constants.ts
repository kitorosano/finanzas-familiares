export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;

// Estados permitidos al crear un movimiento.
export const TRANSACTION_STATUSES = ['pending', 'posted'] as const;

// Estados que pueden existir en la base de datos.
export const TRANSACTION_QUERY_STATUSES = [
  ...TRANSACTION_STATUSES,
  'void',
] as const;

export const TRANSACTION_DESCRIPTION_MAX_LENGTH = 1000;
export const TRANSACTION_NOTES_MAX_LENGTH = 5000;
export const TRANSACTION_INSTALLMENTS_MIN = 1;
export const TRANSACTION_INSTALLMENTS_MAX = 240;
export const TRANSACTION_LIST_LIMIT_MIN = 1;
export const TRANSACTION_LIST_LIMIT_MAX = 100;
export const TRANSACTION_LIST_LIMIT_DEFAULT = 50;
export const TRANSACTION_LIST_OFFSET_MIN = 0;
export const TRANSACTION_LIST_OFFSET_DEFAULT = 0;
export const TRANSACTION_AMOUNT_EXCLUSIVE_MINIMUM = 0;
export const TRANSACTION_VOID_REASON_MIN_LENGTH = 1;
export const TRANSACTION_VOID_REASON_MAX_LENGTH = 1000;