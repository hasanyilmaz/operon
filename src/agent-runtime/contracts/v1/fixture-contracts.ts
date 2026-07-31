/**
 * Development-only portable contract surface used by fixture and schema
 * parity checks. Production Runtime code must import its required contract
 * modules directly and must not import this aggregate.
 */
export * from './index';
export * from './fixture-decoders';
