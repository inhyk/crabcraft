// This window's hold on its character's save. The Royal Vault (tidecrown/vault.ts) moves coins between the journey and
// the account's vault in one step, so a window that later saves the journey with coins from before a move made
// elsewhere, or from before a load of the account's save, would put coins back (or drop them). The hold is taken when
// the journey is read, before the first frame: a shared Web Lock per character, so the vault can see a second window on
// the same character, and a storage listener. It is lost for good, with a notice to reload (bossJourney.ts), once
// another window writes other coins for this character, removes its journey, or loads a save that changes it or the
// vault (accountStorage.ts loadKey); a lost hold saves nothing more and lets go of the lock.
import { holdName, loadKey, saveProfile, storageKey, VAULT_KEY } from '../accountStorage';
import { localStorageGet, localStorageSet } from '../app';

/** A stored journey's coins as the hold compares them. */
const coinsOf = (raw: string | null): number | 'none' | 'bad' => {
  if (raw === null) return 'none';
  try {
    const coins = JSON.parse(raw)?.coins;
    return Number.isSafeInteger(coins) ? coins : 'bad';
  } catch {
    return 'bad';
  }
};

/** 'other': another window wrote other coins for this character or removed it; 'loaded': a load of the account's save. */
export type HoldLoss = 'other' | 'loaded';

export class SaveHold {
  /** Why this window no longer saves its character; null while it does. */
  lost: HoldLoss | null = null;
  private readonly stored: string;
  private readonly name: string;
  /** The stored journey's coins when this window last read or wrote it. */
  private seen: ReturnType<typeof coinsOf>;
  private release: (() => void) | null = null;
  private disposed = false;
  private readonly onStorage = (e: StorageEvent) => {
    if (this.lost || this.disposed || e.storageArea !== localStorage) return;
    if (e.key === null) this.lose('other');
    else if (e.key === this.stored) { if (coinsOf(e.newValue) !== this.seen) this.lose('other'); }
    else if (e.key === loadKey(saveProfile()) && e.newValue !== null) {
      let keys: unknown = null;
      try { keys = JSON.parse(e.newValue).keys; } catch { /* Unreadable: taken as touching everything. */ }
      if (!Array.isArray(keys) || keys.includes(VAULT_KEY) || keys.includes(this.key)) this.lose('loaded');
    }
  };

  /** `key`: the journey's key as the game names it (storage resolves it per account). */
  constructor(private readonly key: string, private readonly onLost: (why: HoldLoss) => void) {
    this.stored = storageKey(key);
    this.name = holdName(this.stored);
    this.seen = coinsOf(localStorageGet(key));
    window.addEventListener('storage', this.onStorage);
    try {
      void navigator.locks?.request(this.name, { mode: 'shared' }, () => (this.lost || this.disposed ? undefined : new Promise<void>((r) => (this.release = r)))).catch(() => {});
    } catch { /* No Web Locks: the storage events still guard. */ }
  }

  /** Stores the journey unless the hold is lost, or another window changed its coins since this window last saw them
   *  (then it is lost now); false when nothing was stored. */
  write(value: string): boolean {
    if (this.lost) return false;
    if (coinsOf(localStorageGet(this.key)) !== this.seen) {
      this.lose('other');
      return false;
    }
    if (!localStorageSet(this.key, value)) return false;
    this.seen = coinsOf(value);
    return true;
  }

  /** Whether another window holds this character too (Web Locks; false where there are none). */
  async shared(): Promise<boolean> {
    try {
      const q = await navigator.locks?.query();
      return [...(q?.held ?? []), ...(q?.pending ?? [])].filter((l) => l.name === this.name).length > 1;
    } catch {
      return false;
    }
  }

  private lose(why: HoldLoss): void {
    this.lost = why;
    this.free();
    this.onLost(why);
  }

  private free(): void {
    this.release?.();
    this.release = null;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('storage', this.onStorage);
    this.free();
  }
}
