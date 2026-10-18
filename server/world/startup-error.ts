import { HostOwnershipError } from './ownership.ts';

/** Only application-owned validation paths are safe to display verbatim. */
export class WorldConfigError extends Error {
  constructor(path: string) { super(`world-config: ${path}`); this.name = 'WorldConfigError'; }
}

const SAFE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ENOENT', 'EACCES', '28P01', '57P01', '53300']);
export function describeWorldStartupFailure(error: unknown): string {
  if (error instanceof WorldConfigError || error instanceof HostOwnershipError) return error.message;
  if (error instanceof SyntaxError) return 'world-config: invalid JSON';
  const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
  return typeof code === 'string' && SAFE_CODES.has(code) ? `world-startup: ${code}` : 'world-startup: initialization failed';
}
