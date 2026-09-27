/**
 * Feature flags for modules that roll out gradually (docs/FEATURE_ROADMAP.md,
 * decision 5).
 *
 * Every flag defaults to **off**. The server reads each one from a
 * `FEATURE_<NAME>` environment variable (e.g. `FEATURE_AI_ASSISTANT=true`) and
 * serves the resolved set at `GET /api/v1/features`; the client hides anything
 * whose flag is off. A module behind a flag must be entirely unreachable while
 * it's off — no half-visible buttons.
 */
export const FEATURE_FLAGS = {
  aiAssistant: 'FEATURE_AI_ASSISTANT',
  receiptOcr: 'FEATURE_RECEIPT_OCR',
  groupExpenses: 'FEATURE_GROUP_EXPENSES',
  invoicing: 'FEATURE_INVOICING',
  inventory: 'FEATURE_INVENTORY',
  investments: 'FEATURE_INVESTMENTS',
  householdWorkspaces: 'FEATURE_FAMILY_WORKSPACE',
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
export type FeatureFlags = Record<FeatureFlag, boolean>;

export const FEATURE_FLAG_NAMES = Object.keys(FEATURE_FLAGS) as FeatureFlag[];
