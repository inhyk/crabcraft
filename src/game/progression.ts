/** Cumulative thresholds keep the original level 1–3 pacing. */
export const LEVEL_XP = [0, 300, 900, 1400, 2000, 2700, 3500, 4400, 5400, 6500, 7600, 8800, 10100, 11500, 13000, 14600, 16300, 18100, 20000, 22000];
export const MAX_LEVEL = LEVEL_XP.length;
export const levelForXp = (xp: number) => LEVEL_XP.reduce((level, threshold, i) => xp >= threshold ? i + 1 : level, 1);
export const patrolReward = (level: number) => 180 + Math.min(20, Math.max(1, level)) * 50;
export const BOSS_PROFILES = {
  rust: { level: 3, hp: 1300, damage: 1, tempo: 1, color: '#ff672e', name: '코로디우스 · 녹의 폭군', title: '철의 난파선 수호자', reward: 500 },
  abyss: { level: 10, hp: 2600, damage: 2.1, tempo: 0.85, color: '#58e5ff', name: '네레이드 · 심해의 군주', title: '깨어난 심해의 왕관', reward: 0 },
  eclipse: { level: 20, hp: 6200, damage: 3.2, tempo: 0.78, color: '#bf8aff', name: '아스트라 · 일식의 여왕', title: '잊힌 별의 섬의 마지막 수호자', reward: 1500 },
} as const;
export type BossProfile = typeof BOSS_PROFILES[keyof typeof BOSS_PROFILES];
export const canEnterWorld2 = (abyssCleared: boolean, firstEndingSeen: boolean) => abyssCleared && firstEndingSeen;
export const canChallenge = (level: number, required: number, rustCleared: boolean, abyssCleared = false, chapter = 1) => level >= required && (required === 3 || rustCleared) && (required !== 20 || (abyssCleared && chapter === 2));
