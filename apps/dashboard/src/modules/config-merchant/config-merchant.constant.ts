/** Row-level intent in an upsert batch: Insert, Update, Delete. */
export const ActionEnum = {
  I: 'I',
  U: 'U',
  D: 'D',
} as const;
export type ActionEnum = (typeof ActionEnum)[keyof typeof ActionEnum];

/** Agent shareholder percentages must total exactly this. */
export const AGENT_SHAREHOLDER_TOTAL_PERCENTAGE = 100;
