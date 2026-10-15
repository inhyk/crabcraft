import {t} from '../i18n';
import type {NpcId,QuestId,QuestStatus} from './quests';

type Line=readonly [string,string];
const completed:Record<NpcId,readonly [QuestId,Line]>={
  brinebeard:['w1',['네 순찰 덕분에 이삿짐 마차가 무사히 들어왔네. 이제 별빛 항구의 시장도 북적이겠어!','Your patrol brought the moving carts home safely. Starhaven market can finally bustle!']],
  pip:['w2',['네가 가져온 수정으로 새 모루에 첫 불꽃을 피웠어. 주민들의 수레부터 튼튼하게 고쳐 줘야지!','Your crystals lit the first spark at my new anvil. Time to repair the settlers’ carts!']],
  rattlebolt:['w3',['네가 밝힌 세 등불이 별빛길을 지키고 있구나. 이젠 주민들도 길을 잃지 않을 게야.','The three waystones you lit are watching over the Starroad. Our neighbors can find their way home.']],
  grukk:['w4',['그룩 동쪽에서 쿵쾅 소리 안 듣는다. 네가 수호자들 잠재웠다. 그룩 이제 새 문에 이름 붙인다.','Grukk hears no more stomping in the east. You quieted the guardians. Now Grukk names the new gate.']],
  silvermoon:['w5',['네가 찾아 준 세 기억이 하나의 노래가 되었어요. 이 섬도 이제 우리를 기억할 거예요.','The three memories you found have become one song. Now this island will remember us too.']],
  hoofclaw:['w6',['수프 바구니가 무사히 도착했구나. 이사한 이웃들이 모두 같은 식탁에 앉게 됐어. 고맙다!','The soup basket arrived safely. Our neighbors can gather at one table again. Thank you!']],
  coralline:['w6',['따뜻한 수프를 나누니 성소가 집처럼 느껴지네요. 서로 돌보는 마음도 바다를 건너왔어요.','Sharing warm soup makes the sanctuary feel like home. Our care for one another crossed the sea too.']],
};
const victory:Record<NpcId,Line>={
  brinebeard:['항해 끝에 우리가 지킬 두 번째 고향이 생겼군. 오늘은 경계 대신 축배를 들겠네!','At the end of our voyage, we found a second home to protect. Tonight we raise a toast instead of a watch!'],
  silvermoon:['일식이 걷히니 잊힌 별들의 노래가 돌아왔어요. 두 세계의 하늘에 같은 빛이 흐르고 있어요.','With the eclipse gone, the forgotten stars sing again. The same light flows through the skies of both worlds.'],
  coralline:['두 세계를 지켜 줘서 고마워요. 이제 이 성소에는 두려움보다 이웃들의 웃음이 가득해요.','Thank you for protecting both worlds. Our sanctuary is filled with neighbors’ laughter instead of fear.'],
  grukk:['그룩 별의 왕좌 조용한 것 좋다. 네가 큰 그림자 이겼다. 그룩 오늘 간식 두 상자 연다!','Grukk likes a quiet Star Throne. You beat the big shadow. Grukk opens two snack boxes today!'],
  hoofclaw:['오늘은 승리를 축하하는 수프란다! 포탈 너머 친구들도 불러 오렴. 모두 앉을 자리가 있어!','Today’s soup celebrates our victory! Bring your friends from across the portal. There is a seat for everyone!'],
  rattlebolt:['일식의 그림자는 사라졌지만 등불은 계속 켜 둘 게야. 이제는 싸움이 아니라 집으로 오는 길을 비추려고.','The eclipse’s shadow is gone, but I will keep the lanterns lit. Now they light the way home.'],
  pip:['세 왕관을 되찾은 날을 기념해서 작은 별빛 장식을 만들고 있어. 새 마을 대문에 달아 두자!','I am making a little star ornament to remember the day you reclaimed the three crowns. Let’s hang it on our new village gate!'],
};
export function starNpcProgressLine(id:NpcId,status:Record<QuestId,QuestStatus>,won:boolean):string|null{
  if(won)return t(...victory[id]);
  const [quest,line]=completed[id];
  return status[quest]==='done'?t(...line):null;
}
export const STAR_VICTORY_BARKS:readonly Line[]=[
  ['이제 별의 왕좌까지 소풍을 갈 수 있겠어요!','Now we can take a picnic all the way to the Star Throne!'],
  ['두 세계를 구한 친구에게 수프 한 그릇 더!','One more bowl of soup for the friend who saved both worlds!'],
  ['일식이 사라진 하늘 아래서 새 집이 더 반짝여요.','Our new home shines brighter beneath a sky free of the eclipse.'],
  ['포탈 너머 이웃들도 축제에 초대했어요.','We invited our neighbors across the portal to celebrate.'],
  ['별빛 항구가 정말 우리 집이 되었네요.','Starhaven truly feels like our home now.'],
  ['어제는 이삿짐을 나르고, 오늘은 승리의 춤을 춰요!','Yesterday we carried moving boxes. Today we dance in victory!'],
];
