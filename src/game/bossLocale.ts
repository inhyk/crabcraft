import {t} from '../i18n';

/** The same mechanic has the same instructions on the host and every follower. */
export function bossWarning(kind:'slam'|'spray'|'undertow'|'nova'|'eclipse',level:number):string {
  switch(kind){
    case 'slam': return level===20?t('별의 집게! 붉은 원을 피하세요.','Star Claw! Leave the red circle.'):level>=10?t('심해의 집게! 붉은 원을 피하세요.','Abyssal Claw! Leave the red circle.'):t('닻 내려찍기! 붉은 원을 피하세요.','Anchor Slam! Leave the red circle.');
    case 'spray': return t('녹 분사! 부채꼴 밖으로 피하세요.','Rust Spray! Move outside the cone.');
    case 'undertow': return t('끌어당기기! 원 밖으로 달리세요.','Undertow! Run outside the circle.');
    case 'nova': return level===20?t('별빛 붕괴! 보라색 원 밖으로 피하세요.','Starfall! Leave the purple circle.'):t('심해 파동! 푸른 원 밖으로 피하세요.','Tidal Nova! Leave the blue circle.');
    case 'eclipse': return t('검은 일식! 보스 곁의 초록 원 안으로 피하세요.','Black Eclipse! Enter the green circle beside the boss.');
  }
}
