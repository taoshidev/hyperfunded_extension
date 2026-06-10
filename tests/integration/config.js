/**
 * Integration test configuration.
 *
 * Uses the testnet Hyperstack validator against the real mainnet HL wallet.
 * All credentials can be overridden via environment variables for CI.
 *
 * Two wallet slots:
 *   VALIDATOR_WALLET — the address registered with the testnet validator.
 *                      Used for read-only pipeline tests (no key needed).
 *   TRADING_WALLET  — the address whose private key is provided via
 *                     TEST_PRIVATE_KEY. Must be registered on the validator
 *                     AND have HL USDC balance to run lifecycle tests.
 *                     When TEST_PRIVATE_KEY is set, TRADING_WALLET is derived
 *                     from it automatically. Otherwise falls back to VALIDATOR_WALLET.
 */

export const VALIDATOR_URL = process.env.TEST_VALIDATOR_URL || 'https://validator.testnet.vantatrading.io';
export const HL_URL = process.env.TEST_HL_URL || 'https://api.hyperliquid.xyz';

// Main account: registered with the testnet validator, holds USDC balance.
// All HL state queries and validator checks use this address.
// Set TEST_WALLET to the HL address of the account registered on the testnet validator.
export const VAULT_ADDRESS = (process.env.TEST_WALLET || '').toLowerCase();

// Kept for backward-compat with existing test files (points to main account).
export const WALLET = VAULT_ADDRESS;
export const VALIDATOR_WALLET = VAULT_ADDRESS;

// Agent private key: authorized to sign orders on behalf of VAULT_ADDRESS.
// The agent address is derived at runtime; the HL exchange routes the order
// to VAULT_ADDRESS via the vaultAddress field in the request body.
// Provide via: TEST_PRIVATE_KEY=0x... npx vitest run --config vitest.config.integration.js
export const PRIVATE_KEY = process.env.TEST_PRIVATE_KEY || null;
export const HAS_PRIVATE_KEY = !!PRIVATE_KEY;
