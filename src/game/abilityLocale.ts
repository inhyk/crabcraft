import type {AbilityDef} from '../data/classes';
import {t} from '../i18n';

const korean:Record<string,readonly [string,string]>={
  'pincer-strike':['집게 강타','묵직한 집게 공격을 가합니다.'],
  'shell-bash':['껍질 방패치기','대상을 2초 동안 기절시킵니다.'],
  'sideways-charge':['옆걸음 돌진','대상에게 돌진하고 분노를 15 얻습니다.'],
  whirlpool:['소용돌이','회전하며 주변의 모든 적을 공격합니다.'],
  'bubble-bolt':['물거품 화살','뜨거운 물거품을 날려 대상을 공격합니다.'],
  'frost-spray':['서리 분사','전방에 서리를 뿜어 적을 4초 동안 50% 느리게 만듭니다.'],
  'steam-blink':['증기 점멸','앞으로 8m 순간이동합니다.'],
  'tidal-nova':['해일 폭발','주변에 물결을 터뜨려 적을 밀쳐냅니다.'],
  smite:['성스러운 일격','성스러운 빛으로 대상을 공격합니다.'],
  'mend-shell':['껍질 치유','최대 체력의 35%를 회복합니다.'],
  'barnacle-ward':['따개비 보호막','10초 동안 피해를 흡수하는 보호막을 얻습니다.'],
  'holy-tide':['성스러운 파도','주변 적에게 피해를 주고 자신의 체력을 회복합니다.'],
};
export const abilityName=(ab:AbilityDef)=>t(korean[ab.id]?.[0]??ab.name,ab.name);
export const abilityDescription=(ab:AbilityDef)=>t(korean[ab.id]?.[1]??ab.description,ab.description);
