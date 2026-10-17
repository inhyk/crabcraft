import {t} from '../i18n';

/** The same mechanic has the same instructions on the host and every follower. */
export function bossWarning(kind:'slam'|'spray'|'undertow'|'nova'|'eclipse'|'cross'|'barrage',level:number):string {
  switch(kind){
    case 'cross': return level===30?t('황혼의 십자화염! 두 주황색 길 밖으로 피하세요.','Twilight Crossfire! Leave both orange lanes.'):t('십자 해일! 교차하는 주황색 길 밖으로 피하세요.','Tidal Cross! Leave both orange lanes.');
    case 'barrage': return level===30?t('황혼 폭격! 세 개의 보라색 원을 피하세요.','Twilight Barrage! Leave all three violet circles.'):level===20?t('별똥별 세례! 세 개의 보라색 원을 피하세요.','Starfall Barrage! Leave all three violet circles.'):t('심해 폭격! 세 개의 보라색 원을 피하세요.','Brine Barrage! Leave all three violet circles.');
    case 'slam': return level===30?t('왕의 내려찍기! 붉은 원을 피하세요.','King’s Hammer! Leave the red circle.'):level===20?t('별의 집게! 붉은 원을 피하세요.','Star Claw! Leave the red circle.'):level>=10?t('심해의 집게! 붉은 원을 피하세요.','Abyssal Claw! Leave the red circle.'):t('닻 내려찍기! 붉은 원을 피하세요.','Anchor Slam! Leave the red circle.');
    case 'spray': return t('녹 분사! 부채꼴 밖으로 피하세요.','Rust Spray! Move outside the cone.');
    case 'undertow': return t('끌어당기기! 원 밖으로 달리세요.','Undertow! Run outside the circle.');
    case 'nova': return level===30?t('황혼의 폭발! 표시된 원 밖으로 피하세요.','Twilight Nova! Leave the marked circle.'):level===20?t('별빛 붕괴! 보라색 원 밖으로 피하세요.','Starfall! Leave the purple circle.'):t('심해 파동! 푸른 원 밖으로 피하세요.','Tidal Nova! Leave the blue circle.');
    case 'eclipse': return t('검은 일식! 보스 곁의 초록 원 안으로 피하세요.','Black Eclipse! Enter the green circle beside the boss.');
  }
}
