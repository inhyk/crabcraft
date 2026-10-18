import {t} from '../i18n';

/** The same mechanic has the same instructions on the host and every follower. */
export function bossWarning(kind:'slam'|'spray'|'undertow'|'nova'|'eclipse'|'cross'|'barrage',level:number):string {
  if(level===300){const warnings={
    cross:t('빙결 광선! 여섯 방향의 푸른 길 사이로 피하세요.','Frozen Rays! Dodge between the six cyan lanes.'),
    barrage:t('일곱 겹 눈보라! 일곱 개의 표시된 원 밖으로 피하세요.','Sevenfold Blizzard! Leave all seven marked circles.'),
    slam:t('서리왕의 망치! 붉은 원을 벗어나세요.','Frost Hammer! Leave the red circle.'),
    spray:t('얼음 숨결! 부채꼴 밖으로 피하세요.','Ice Breath! Leave the cone.'),
    undertow:t('겨울의 소용돌이! 끌려가기 전에 원 밖으로 달리세요.','Winter Vortex! Run outside before the pull.'),
    nova:t('빙하 폭발! 표시된 원을 벗어나세요.','Glacial Burst! Leave the marked circle.'),
    eclipse:t('서리 감옥! 보스 곁의 초록 원 안이 안전해요.','Frost Prison! The green circle beside the boss is safe.'),
  };return warnings[kind];}
  switch(kind){
    case 'cross': return level===100?t('황혼의 십자화염! 여덟 방향 화염 사이의 빈 공간으로 피하세요.','Twilight Crossfire! Dodge between the eight fire rays.'):t('십자 해일! 교차하는 주황색 길 밖으로 피하세요.','Tidal Cross! Leave both orange lanes.');
    case 'barrage': return level===100?t('왕관 폭격! 다섯 개의 보라색 원을 피하세요.','Crown Barrage! Leave all five violet circles.'):level===20?t('별똥별 세례! 세 개의 보라색 원을 피하세요.','Starfall Barrage! Leave all three violet circles.'):t('심해 폭격! 세 개의 보라색 원을 피하세요.','Brine Barrage! Leave all three violet circles.');
    case 'slam': return level===100?t('왕의 내려찍기! 붉은 원을 피하세요.','King’s Hammer! Leave the red circle.'):level===20?t('별의 집게! 붉은 원을 피하세요.','Star Claw! Leave the red circle.'):level>=10?t('심해의 집게! 붉은 원을 피하세요.','Abyssal Claw! Leave the red circle.'):t('닻 내려찍기! 붉은 원을 피하세요.','Anchor Slam! Leave the red circle.');
    case 'spray': return t('녹 분사! 부채꼴 밖으로 피하세요.','Rust Spray! Move outside the cone.');
    case 'undertow': return t('끌어당기기! 원 밖으로 달리세요.','Undertow! Run outside the circle.');
    case 'nova': return level===100?t('황혼의 폭발! 표시된 원 밖으로 피하세요.','Twilight Nova! Leave the marked circle.'):level===20?t('별빛 붕괴! 보라색 원 밖으로 피하세요.','Starfall! Leave the purple circle.'):t('심해 파동! 푸른 원 밖으로 피하세요.','Tidal Nova! Leave the blue circle.');
    case 'eclipse': return t('검은 일식! 보스 곁의 초록 원 안으로 피하세요.','Black Eclipse! Enter the green circle beside the boss.');
  }
}
