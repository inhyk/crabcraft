// The Royal Vault's arithmetic, apart from storage and the keeper: what a stored vault holds and how many coins a
// deposit or a withdrawal moves. Both sides stay safe integers of at least 0 and at most Number.MAX_SAFE_INTEGER.

export type VaultMove = 'deposit' | 'withdraw';
/** A fixed amount, or every coin that can go. */
export type VaultAmount = number | 'all';
/** The amounts the vault keeper offers, besides "all". */
export const VAULT_AMOUNTS = [100, 1000, 10000] as const;

const coinsOk = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** The stored vault's coins: 0 when there is none yet, null when the value is not a vault the account servers accept
 *  (server/node/accounts.ts vaultOf, which also caps it at 200 characters); such a value is left alone. */
export function vaultCoins(raw: string | null): number | null {
  if (raw === null) return 0;
  if (raw.length > 200) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) && coinsOk(data.coins) ? data.coins : null;
  } catch {
    return null;
  }
}

export const vaultValue = (coins: number): string => JSON.stringify({ coins });

/** How many coins `move` carries with `carried` coins on the player and `vault` in the vault: 0 when it cannot (not
 *  enough on the giving side, or no room under the safe-integer limit on the taking side). "All" moves what fits. */
export function vaultAmount(carried: number, vault: number, move: VaultMove, amount: VaultAmount): number {
  if (!coinsOk(carried) || !coinsOk(vault)) return 0;
  const from = move === 'deposit' ? carried : vault, room = Number.MAX_SAFE_INTEGER - (move === 'deposit' ? vault : carried);
  if (amount === 'all') return Math.min(from, room);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= from && amount <= room ? amount : 0;
}

/** Both sides after `move` of `n` coins (n from vaultAmount). */
export function vaultAfter(carried: number, vault: number, move: VaultMove, n: number): { carried: number; vault: number } {
  return move === 'deposit' ? { carried: carried - n, vault: vault + n } : { carried: carried + n, vault: vault - n };
}
