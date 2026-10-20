// People only. The capital's buildings, roads, collision and lighting remain owned by Tidecrown.
export type ResidentText = readonly [ko:string,en:string];
export interface CapitalResident {
  name:ResidentText; role:ResidentText; street:string; at:number; side:number; line:ResidentText;
}
const person=(name:ResidentText,role:ResidentText,street:string,at:number,side:number,line:ResidentText):CapitalResident=>({name,role,street,at,side,line});
export const CAPITAL_RESIDENTS:readonly CapitalResident[]=[
 person(['길잡이 나루','Naru'],['수도 길잡이','Capital Guide'],'gate-court',.25,-5,['육교를 건너 오셨군요! 곧장 가면 탈피 시장이에요. 분수에서 잠깐 쉬어 가세요.','Across the bridge at last! Moult Market is straight ahead. Rest beside the fountain.']),
 person(['경비대원 로크','Rook'],['집게문 경비대','Pincer Gate Guard'],'gate-court',.65,6,['성문 가운데는 마차가 다니니 비워 두고 있어요. 오늘도 안전한 여행 되세요!','We keep the middle of the gate clear for carts. Have a safe journey!']),
 person(['조개상인 모아','Moa'],['조개 장수','Shell Merchant'],'market-ring',.04,0,['이 조개는 파도 소리를 기억한대요. 귀에 대지 말고 마음으로 들어 보세요.','These shells remember the waves. Listen with your heart, rather than your ears.']),
 person(['빵굽는 토리','Tori'],['해초빵 제빵사','Seaweed Baker'],'market-ring',.16,0,['방금 구운 해초빵 냄새 맡았어요? 항구 선원들이 오기 전에 다 팔릴지도 몰라요.','Smell the fresh seaweed bread? The sailors might buy it all before lunch.']),
 person(['꽃장수 리아','Lia'],['수도 꽃장수','Flower Seller'],'market-ring',.29,0,['바닷바람에도 지지 않는 꽃을 골라 드릴게요. 여행자에게는 노란 꽃이 잘 어울려요.','I grow flowers that brave the sea breeze. Yellow suits a traveller like you.']),
 person(['지도상인 오린','Orin'],['지도 제작자','Cartographer'],'market-ring',.42,0,['시장의 동쪽 길은 운하와 항구로 이어져요. 배를 찾는다면 진주 거리를 따라가세요.','The eastern road leads to the canals and harbour. Follow Pearl Street to find the ships.']),
 person(['차상인 소라','Sora'],['바닷바람 찻집','Seabreeze Tea Seller'],'market-ring',.56,0,['집게가 시리면 따뜻한 차가 최고예요. 오늘은 달콤한 바다유리 향을 넣었답니다.','Warm tea is best for chilly claws. Today it has a sweet seaglass aroma.']),
 person(['우편배달 피코','Pico'],['왕관 우편국','Crown Post Courier'],'market-ring',.71,0,['윗마을까지 편지를 배달하면 다리가 튼튼해져요. 계단 수를 세다가 자꾸 까먹네요!','Delivering letters to Upper Town keeps my legs strong. I keep losing count of the steps!']),
 person(['어린 여행자 미루','Miru'],['시장 구경꾼','Market Explorer'],'market-ring',.85,0,['육교에 있는 여섯 영웅 동상 봤어요? 나도 언젠가 저렇게 멋진 모험가가 될 거예요!','Did you see the six heroes on the bridge? I want to become an adventurer like them!']),
 person(['수프장수 보니','Bonnie'],['시장 요리사','Market Cook'],'chandlers-lane',.25,0,['수프가 끓을 때는 서두르면 안 돼요. 모험도 가끔은 천천히 해야 맛이 나죠.','Soup needs time to simmer. Adventures are better when you take your time, too.']),
 person(['장인 브론','Bron'],['따개비 공방 장인','Barnacle Artisan'],'tide-street',.59,0,['공방의 물레방아가 도는 동안 망치질도 멈추지 않아요. 수도의 하루를 만드는 소리죠.','Our hammers work as long as the waterwheel turns. That is the sound of the city waking.']),
 person(['수습장인 틴','Tin'],['수습 대장장이','Apprentice Smith'],'smiths-lane',.25,0,['오늘은 못을 열 개나 만들었어요! 아홉 개는 조금 휘었지만 마지막 하나는 완벽해요.','I forged ten nails today! Nine are a little bent, but the last one is perfect.']),
 person(['등불지기 루니','Luni'],['등불 거리 관리인','Lantern Keeper'],'lantern-row',.28,0,['등불마다 유리를 닦고 심지를 살펴요. 집으로 돌아오는 길은 누구에게나 밝아야 하니까요.','I clean every lantern and check its wick. Everyone deserves a bright way home.']),
 person(['통장인 코브','Cove'],['참나무통 장인','Barrel Cooper'],'cooper-lane',.62,0,['배 위에서 굴러도 새지 않는 통을 만들죠. 비결은 마지막 고리를 꼭 맞추는 거예요.','My barrels stay sealed even aboard a rolling ship. The secret is a snug final hoop.']),
 person(['항구장 마렌','Maren'],['왕관 항구 관리인','Crown Harbourmaster'],'quay-street',.18,0,['왕관 항구에 오신 걸 환영해요. 짐을 나르는 길을 비켜 주시면 선원들이 고마워할 거예요.','Welcome to Crown Harbour. The sailors appreciate a clear path for their cargo.']),
 person(['선원 핀','Finn'],['먼바다 선원','Deepwater Sailor'],'quay-street',.48,0,['먼바다에서 돌아올 때 성의 불빛이 먼저 보여요. 그때야 집에 왔다는 기분이 들죠.','The castle light is the first thing I see coming home. That is when I know I am safe.']),
 person(['그물장인 네티','Netty'],['그물 수선공','Net Mender'],'salt-street',.25,0,['작은 구멍도 그냥 두면 물고기가 다 빠져나가요. 집게로 한 코씩 꼼꼼히 고쳐야죠.','Even a tiny hole lets fish escape. I mend each knot carefully with my claws.']),
 person(['짐꾼 도크','Dock'],['항구 운반꾼','Dock Porter'],'salt-street',.68,0,['이 상자는 보기보다 가벼워요. 저 상자는 보기보다 무겁고요. 꼭 들어 봐야 알죠!','This crate is lighter than it looks. That one is heavier. You have to lift them to know!']),
 person(['운하안내 세리','Seri'],['운하 길잡이','Canal Guide'],'pearl-street',.46,0,['운하의 반짝이는 물결을 따라가면 항구예요. 다리에서 서로 길을 양보해 주세요.','Follow the glittering canal to the harbour. Give one another room on the bridges.']),
 person(['종지기 벨라','Bella'],['조수 대성당 종지기','Cathedral Bell Keeper'],'cathedral-street',.65,0,['대성당 종은 멀리 바다까지 울려요. 안개 낀 날에는 선원들에게 길잡이가 되어 주죠.','The cathedral bells carry far out to sea. In fog they guide our sailors home.']),
 person(['기록관 에다','Edda'],['조수 기록관','Tide Archivist'],'chapter-street',.08,0,['수도의 기록에는 평범한 하루도 적혀 있어요. 오늘 당신이 찾아온 일도 한 줄 남길게요.','Our records treasure ordinary days, too. I will add a line about your visit today.']),
 person(['수도사 펄린','Perlin'],['조수 대성당 수도사','Tide Acolyte'],'cathedral-steps',.72,0,['여행에 지친 마음은 잠시 내려놓으세요. 파도가 물러나듯 걱정도 조금씩 잦아들 거예요.','Rest your weary thoughts a while. Worries recede just as the tide does.']),
 person(['서점주 루엔','Luen'],['조수 거리 서점주','Tide Street Bookseller'],'mercers-row',.44,0,['모험담을 읽고 길을 떠나는 분도, 길을 다녀와 책을 쓰는 분도 있죠. 당신은 어느 쪽인가요?','Some read adventures before travelling; others write them afterwards. Which are you?']),
 person(['유리장인 비아','Via'],['바다유리 장인','Seaglass Artisan'],'glass-street',.3,0,['파도가 닳게 만든 유리는 모서리가 부드러워요. 그 시간을 담아 등잔을 만들고 있어요.','The waves soften glass over time. I put a little of that patience into each lamp.']),
 person(['빛연구가 프리즘','Prism'],['바다유리 연구가','Seaglass Scholar'],'prism-lane',.35,0,['같은 유리도 빛이 비치는 방향에 따라 색이 달라져요. 가끔은 보는 자리를 바꿔 보세요.','The same glass changes colour with the light. Try looking from a different place.']),
 person(['가마지기 누리','Nuri'],['유리 가마 관리인','Glass Kiln Keeper'],'kiln-lane',.43,0,['뜨거운 유리는 천천히 식혀야 해요. 조급하게 꺼내면 예쁜 무늬 대신 금이 생기죠.','Hot glass must cool slowly. Rush it and you get cracks instead of patterns.']),
 person(['별관찰자 루스','Luce'],['바다유리 관측원','Seaglass Observer'],'crystal-walk',.62,0,['높은 탑에서는 바다와 하늘이 만나는 선이 잘 보여요. 오늘은 구름이 배처럼 생겼네요.','From the towers the sea meets the sky. Today the clouds look just like ships.']),
 person(['정원사 로제아','Rosea'],['윗마을 정원사','Upper Town Gardener'],'noble-street-west',.72,0,['바닷바람을 막아 주는 담 덕분에 꽃들이 잘 자라요. 봄에는 윗마을이 향기로 가득하죠.','The walls shelter our flowers from the sea breeze. In spring the upper town smells wonderful.']),
 person(['왕실전령 카이','Kai'],['왕실 전령','Royal Messenger'],'noble-street-east',.42,0,['성으로 가는 길은 큰 계단을 따라가세요. 급한 소식이 있어도 계단에서는 뛰지 않아요.','Follow the grand stair towards the keep. Even urgent messages are no reason to run on steps.']),
 person(['산책가 테오','Theo'],['윗마을 주민','Upper Town Resident'],'rim-walk',.38,0,['여기서는 지붕 너머 항구까지 보여요. 처음 온 친구에게 꼭 보여 주는 풍경이에요.','You can see the harbour over the rooftops here. This is where I bring friends on their first visit.']),
 person(['성벽지기 아르코','Arco'],['왕관 성벽 경비대','Crown Wall Watch'],'stair-lane',.55,0,['성벽은 제가 지킬 테니 수도를 마음껏 둘러보세요. 여행자들의 이야기가 이 도시를 채워요.','I will watch the walls while you explore. Travellers and their stories bring this city to life.']),
 person(['악사 멜로','Mello'],['거리 악사','Street Musician'],'market-ring',.94,0,['파도 소리에 맞춰 연습 중이에요. 박자가 자꾸 바뀌지만 그래서 더 재미있어요!','I practise to the rhythm of the waves. The beat keeps changing, but that is the fun of it!']),
];
