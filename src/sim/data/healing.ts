/** Lantern skills retain their own recovery and mana costs; allies receive a fixed share of their own max HP. */
export const LANTERN_HEALS = {
  'mend-shell': { range: 12, fraction: .35, cooldown: 10 },
  'holy-tide': { range: 6, fraction: .15, cooldown: 15 },
} as const;
export type LanternHeal = keyof typeof LANTERN_HEALS;
