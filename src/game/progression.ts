import {t} from '../i18n.ts';

/** Cumulative thresholds keep the original level 1–3 pacing. */
export const LEVEL_XP = [0, 300, 900, 1400, 2000, 2700, 3500, 4400, 5400, 6500, 7600, 8800, 10100, 11500, 13000, 14600, 16300, 18100, 20000, 22000];
/** Story bosses culminate at 100; character growth has no gameplay level cap. */
export const xpForLevel = (level: number): number => {
  const n=Math.max(0,Math.floor(level)-20);
  return level<=20 ? LEVEL_XP[Math.max(0,Math.floor(level)-1)] : 22000+2200*n+100*n*(n-1);
};
export const levelForXp = (xp: number): number => {
  if(xp<22000)return LEVEL_XP.reduce((level,threshold,i)=>xp>=threshold?i+1:level,1);
  return 20+Math.floor((-2100+Math.sqrt(4410000+400*(xp-22000)))/200);
};
export const patrolReward = (level: number) => 180 + Math.max(1,level)*50;
export const BOSS_PROFILES = {
  rust: { level: 3, hp: 1300, damage: 1, tempo: 1, color: '#ff672e', get name(){return t('코로디우스 · 녹의 폭군','Corrodius · Tyrant of Rust');}, get title(){return t('철의 난파선 수호자','Guardian of the Iron Wreck');}, reward: 500 },
  abyss: { level: 10, hp: 2600, damage: 2.1, tempo: 0.85, color: '#58e5ff', get name(){return t('네레이드 · 심해의 군주','Nereid · Lord of the Deep');}, get title(){return t('깨어난 심해의 왕관','The Awakened Crown of the Deep');}, reward: 0 },
  eclipse: { level: 20, hp: 6200, damage: 3.2, tempo: 0.78, color: '#bf8aff', get name(){return t('아스트라 · 일식의 여왕','Astra · Queen of the Eclipse');}, get title(){return t('잊힌 별의 섬의 마지막 수호자','Last Guardian of the Forgotten Isle');}, reward: 1500 },
  dawn: { level: 100, hp: 180000, damage: 32, tempo: .68, color: '#ffb44f', get name(){return t('솔라칸 · 새벽을 삼킨 왕','Solarkan · King of the Stolen Dawn');}, get title(){return t('친구를 가둔 황혼 성채의 지배자','Jailer of the Twilight Citadel');}, reward: 3200 },
} as const;
export type BossProfile = typeof BOSS_PROFILES[keyof typeof BOSS_PROFILES];
export const canEnterWorld2 = (abyssCleared: boolean, _firstEndingSeen = false) => abyssCleared;
export const canChallenge = (level: number, required: number, rustCleared: boolean, _abyssCleared = false, chapter = 1) => level >= required && (required === 100 ? chapter === 3 && _abyssCleared : required === 20 ? chapter === 2 && _abyssCleared : chapter === 1 && (required === 3 || rustCleared));
