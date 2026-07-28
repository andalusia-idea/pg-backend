/**
 * DI tokens for injecting each peer's ClientProxy. Deliberately static (not
 * env-driven like CLIENT_*_NAME) - these only need to match between
 * ClientsModule.registerAsync() and @Inject() below, they never need to vary
 * per environment.
 */
export const AUTH_CLIENT = Symbol('AUTH_CLIENT');
export const CONFIG_CLIENT = Symbol('CONFIG_CLIENT');

/**
 * TCP message-pattern cmds. Both sides of a call must agree on these
 * strings: the client's `.send({ cmd })` here, and the receiving app's
 * `@MessagePattern({ cmd })` handler (built when that app's business module
 * is ported). Kept identical to the legacy services' cmd names.
 */
export const AUTH_CMD = {
  FIND_ALL_MERCHANTS_AND_AGENTS_BY_IDS: 'find_all_merchants_and_agents_by_ids',
  FIND_PROFILE_BANK: 'find_profile_bank',
  MERCHANT_SIGNATURE_VALIDATION: 'merchant_signature_validation',
  MERCHANT_SIGNATURE_URL: 'merchant_signature_url',
} as const;

export const CONFIG_CMD = {
  CALCULATE_FEE_PURCHASE: 'calculate_fee_purchase',
  CALCULATE_FEE_WITHDRAW: 'calculate_fee_withdraw',
  CALCULATE_FEE_TOPUP: 'calculate_fee_topup',
  CALCULATE_FEE_DISBURSEMENT: 'calculate_fee_disbursement',
  CREATE_MERCHANT_CONFIG: 'create_merchant_config',
  CREATE_AGENT_CONFIG: 'create_agent_config',
  FIND_PROFILE_PROVIDER: 'find_profile_provider',
} as const;

/** Default timeout for a TCP call before it's treated as failed. */
export const MICROSERVICE_CALL_TIMEOUT_MS = 5000;
