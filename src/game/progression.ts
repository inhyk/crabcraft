/** Cumulative thresholds keep the original level 1–3 pacing. */
export const LEVEL_XP = [0, 300, 900, 1400, 2000, 2700, 3500, 4400, 5400, 6500];
export const MAX_LEVEL = LEVEL_XP.length;
export const levelForXp = (xp: number) => LEVEL_XP.reduce((level, threshold, i) => xp >= threshold ? i + 1 : level, 1);
export const patrolReward = (level: number) => 180 + Math.min(10, Math.max(1, level)) * 50;
export const BOSS_PROFILES = {
  rust: { level: 3, hp: 1300, damage: 1, tempo: 1, color: '#ff672e', name: '코로디우스 · 녹의 폭군', title: '철의 난파선 수호자', reward: 500 },
  abyss: { level: 10, hp: 2600, damage: 2.1, tempo: 0.85, color: '#58e5ff', name: '네레이드 · 심해의 군주', title: '깨어난 심해의 왕관', reward: 0 },
} as const;
export type BossProfile = typeof BOSS_PROFILES[keyof typeof BOSS_PROFILES];
export const canChallenge = (level: number, required: number, rustCleared: boolean) => level >= required && (required === 3 || rustCleared);
