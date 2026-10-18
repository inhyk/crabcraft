// "The Rust Tide" quest chain (docs/design.md): data, dialogue and progress state.
import type { PoiId } from '../world/types';
import { Emitter } from './util';
import {language,t,type Language} from '../i18n';
import {translatedQuest} from './questLocale';
import {SNOW_QUESTS,type SnowQuestId,type SnowObjectiveKind} from './snowQuests';
import {DAWN_QUESTS,type DawnQuestId,type DawnObjectiveKind} from './dawnQuests';

export type QuestId = SnowQuestId | DawnQuestId | 'q1' | 'q2' | 'q3' | 'q4' | 'w1' | 'w2' | 'w3' | 'w4' | 'w5' | 'w6' | 'w7' | 'd1' | 'd2' | 's1' | 's2';
export type NpcId = 'brinebeard' | 'silvermoon' | 'coralline' | 'grukk' | 'hoofclaw' | 'rattlebolt' | 'pip';
export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';
export type ObjectiveKind = SnowObjectiveKind | DawnObjectiveKind | 'kill-scrapling' | 'kill-scavenger' | 'collect-cog' | 'deliver' | 'beacon' | 'boss' | 'crystal-a' | 'crystal-b' | 'crystal-c' | 'crystal-d' | 'lamp-a' | 'lamp-b' | 'lamp-c' | 'explore-west' | 'explore-east' | 'explore-north' | 'deliver-supplies' | 'eclipse-boss' | 'dawn-boss' | 'frost-boss';

export interface ObjectiveDef {
  id: string;
  kind: ObjectiveKind;
  label: string;
  count: number;
  poi: PoiId;
}

export interface QuestDef {
  id: QuestId;
  chapter?: 1 | 2 | 3 | 4;
  title: string;
  giver: NpcId;
  /** null = completes by itself when the objectives are done. */
  turnIn: NpcId | null;
  offer: string[];
  progress: string;
  complete: string[];
  /** Quest log description. */
  summary: string;
  /** Tracker line once every objective is done. */
  readyHint: string;
  objectives: ObjectiveDef[];
  xp: number;
  completeButton?: string;
}

export const QUESTS: Record<QuestId, QuestDef> = {
 ...DAWN_QUESTS,
 ...SNOW_QUESTS,
 s1:{id:'s1',chapter:4,title:'Patrol the Snowfields',giver:'grukk',turnIn:'grukk',offer:['Frost sentinels are gathering beneath the aurora. Keep the path to our warm village safe.','Defeat eight Glacial Sentinels, then return for your reward.'],progress:'Defeat eight Glacial Sentinels in the snowfields.',complete:['The trail is safe again! Keep patrolling to prepare for Boreas.'],summary:'Protect Snowfall Village from the glacial patrols.',readyHint:'Return to Grukk in Snowfall Village.',objectives:[{id:'s1-kill',kind:'kill-scavenger',label:'Glacial Sentinels defeated',count:8,poi:'wreck'}],xp:18000},
 s2:{id:'s2',chapter:4,title:'The Eternal Winter',giver:'brinebeard',turnIn:null,offer:['Boreas has taken your friend Mira to his ice prison beyond the aurora. He will only face a hero who reaches level 300.','Take the lantern road north, defeat Boreas, free Mira and reclaim the Frozen Crown.'],progress:'Reach level 300 and defeat Boreas at the Frozen Throne.',complete:['Mira is free and the Frozen Crown is reclaimed. All four islands will dance together!'],summary:'Defeat level 300 Boreas, rescue Mira and celebrate with all four islands.',readyHint:'Your reward is granted automatically.',objectives:[{id:'s2-boss',kind:'frost-boss',label:'Boreas defeated and Mira rescued',count:1,poi:'bossArena'}],xp:24000},
 d1:{id:'d1',chapter:3,title:'The Missing Friend',giver:'brinebeard',turnIn:'brinebeard',offer:['Boreas took Mira to an ice prison in Frostlight. Solarkan blocks our route north.','Defeat six Twilight Sentinels along the ascent. Reach level 100 and reclaim the crown to open the route to Frostlight.'],progress:'Clear the sentinel patrols on the way to the citadel.',complete:['The ascent is safe! Follow the golden road north to Solarkan, who guards the route to Frostlight.'],summary:'Help the Dawnharbor captain by defeating six Twilight Sentinels.',readyHint:'Return to the captain in Dawnharbor.',objectives:[{id:'d1-kill',kind:'kill-scavenger',label:'Twilight Sentinels defeated',count:6,poi:'wreck'}],xp:2800},
 d2:{id:'d2',chapter:3,title:'The Road to Frostlight',giver:'brinebeard',turnIn:'brinebeard',offer:['Boreas holds Mira in the snowfields. Solarkan guards the portal to his realm.','Defeat the level 100 king to open the portal. Then we can rescue Mira from Boreas.'],progress:'Defeat Solarkan at level 100 and open the route to Frostlight.',complete:['The route is open! Find Mira in Boreas’s ice prison in Frostlight.'],summary:'Defeat Solarkan to reach Boreas and rescue Mira in Frostlight.',readyHint:'Return to the captain.',objectives:[{id:'d2-boss',kind:'dawn-boss',label:'Solarkan defeated and Frostlight unlocked',count:1,poi:'bossArena'}],xp:3500},
  q1: {
    id: 'q1',
    title: 'Salt in the Gears',
    giver: 'brinebeard',
    turnIn: 'brinebeard',
    offer: [
      "Ahoy, fresh shell! Captain Brinebeard, Clawhaven Watch. You've got sturdy pincers, and I've got a rusty problem.",
      'Every night Scraplings crawl up the Brine Shore from the Iron Wreck. Little rustbuckets. Wherever they scuttle, crabs wake up stiff as old hinges with their LEDs gone dim.',
      'Take the road out of the square down to the Brine Shore. Scrap 6 Scraplings and bring me 4 Rusted Cogs from their innards. I want to know what makes them tick. And creak.',
    ],
    progress: 'Still crunching? The Brine Shore is down the road past the gate. Follow the surf and the smell of old pennies.',
    complete: [
      "Four cogs! Look at this rust, it's practically growing a beard. Mine's nicer.",
      "You've done Clawhaven proud, shellmate. But a cog this rotten didn't rot on its own...",
    ],
    summary:
      'Captain Brinebeard wants 6 Scraplings scrapped on the Brine Shore and 4 Rusted Cogs brought back to him in Clawhaven Square.',
    readyHint: 'Return to Captain Brinebeard in Clawhaven Square.',
    objectives: [
      { id: 'q1-kill', kind: 'kill-scrapling', label: 'Scraplings scrapped', count: 6, poi: 'shore' },
      { id: 'q1-cog', kind: 'collect-cog', label: 'Rusted Cogs', count: 4, poi: 'shore' },
    ],
    xp: 250,
  },
  q2: {
    id: 'q2',
    title: 'Moonwater',
    giver: 'brinebeard',
    turnIn: 'silvermoon',
    offer: [
      "This rust isn't natural. It smells like trouble and tastes like a battery. Don't ask how I know.",
      "Lady Silvermoon keeps the Moonpool in the grove at the edge of the pine wood. If anyone can read a rusted cog, it's her. Take these to her, and mind the pinecones. They're pointy and they know it.",
    ],
    progress: 'Lady Silvermoon is at Moonpool Grove, where the pine wood starts. Follow the glow.',
    complete: [
      'Hush now. Let the moonwater speak.',
      '(She dips a cog into the glowing pool. The rust hisses away like steam off a kettle.)',
      'Do you see that red glint? This rust was cast by light. Corrupted light. The Saltmere Lighthouse has gone dark, and in that darkness something in the Iron Wreck has grown bold.',
    ],
    summary: 'Bring the Rusted Cogs to Lady Silvermoon at Moonpool Grove, on the edge of the pine wood.',
    readyHint: 'Speak with Lady Silvermoon at Moonpool Grove.',
    objectives: [{ id: 'q2-deliver', kind: 'deliver', label: 'Cogs brought to Lady Silvermoon', count: 1, poi: 'npc:silvermoon' }],
    xp: 120,
  },
  q3: {
    id: 'q3',
    title: 'Light the Beacon',
    giver: 'silvermoon',
    turnIn: null,
    offer: [
      'The lighthouse stands on the cliff past the Brine Shore. Rustclaw Scavengers nest along its path, and they leap like startled shrimp. Clear 3 of them.',
      'Then climb to the lantern and relight the beacon. Hold F and keep the flame steady until it catches. The moon will be watching. So will I, from a comfortable distance.',
    ],
    progress:
      'The lighthouse is past the Brine Shore, up the cliff path. Old Rattlebolt keeps it, if he is still keeping anything.',
    complete: [],
    summary:
      'Defeat 3 Rustclaw Scavengers on the path to Saltmere Lighthouse, then relight the beacon at the top. Hold F at the beacon until the flame catches.',
    readyHint: 'The beacon blazes!',
    objectives: [
      { id: 'q3-kill', kind: 'kill-scavenger', label: 'Rustclaw Scavengers defeated', count: 3, poi: 'lighthouse' },
      { id: 'q3-beacon', kind: 'beacon', label: 'Saltmere beacon relit (hold F)', count: 1, poi: 'beacon' },
    ],
    xp: 330,
  },
  q4: {
    id: 'q4',
    title: 'The Rust Tide',
    giver: 'silvermoon',
    turnIn: 'brinebeard',
    offer: [
      'The beacon swept across the bay and found the Iron Wreck. Something enormous heaved itself up on the deck, crowned in rust and furnace light: Corrodius, the Rust Tyrant.',
      "Board the wreck at the far end of the shore and end the Rust Tide. Lady Silvermoon's moonwater blessing will keep your shell mending while you fight.",
    ],
    progress: 'Corrodius waits on the deck of the Iron Wreck.',
    complete: [
      'You did WHAT? Corrodius was a wee red crab stuck in a rusty tin can the whole time?',
      "Ha! Well, the sea will be kinder to him than rust ever was. And the beacon's burning bright again. Listen... hear that? The whole town's turned out.",
      "Clawhaven owes you a dance, shellmate. Several, actually. We're crabs. We've got a lot of legs.",
    ],
    summary: 'Defeat Corrodius, the Rust Tyrant, on the deck of the Iron Wreck at the far end of the Brine Shore.',
    readyHint: 'Return to Captain Brinebeard in Clawhaven Square.',
    objectives: [{ id: 'q4-boss', kind: 'boss', label: 'Corrodius defeated', count: 1, poi: 'bossArena' }],
    xp: 600,
    completeButton: 'Keep exploring toward level 10',
  },
  w1: {
  "id": "w1",
  "chapter": 2,
  "title": "새로운 보금자리",
  "giver": "brinebeard",
  "turnIn": "brinebeard",
  "offer": [
    "차원문 너머까지 함께 왔구나! 이 섬에 별빛 마을을 세우기로 했어.",
    "서쪽 수정 정원의 파수꾼 6마리를 처치해 주민들이 안심하고 이사할 수 있게 도와줘."
  ],
  "progress": "서쪽 수정 정원에서 파수꾼을 처치하고 선장에게 돌아오세요.",
  "complete": [
    "덕분에 이삿짐을 풀 수 있겠어. 이곳에도 웃음소리가 들리겠구나!"
  ],
  "summary": "차원문 너머까지 함께 왔구나! 이 섬에 별빛 마을을 세우기로 했어. 서쪽 수정 정원의 파수꾼 6마리를 처치해 주민들이 안심하고 이사할 수 있게 도와줘.",
  "readyHint": "브라인비어드 선장에게 돌아가세요.",
  "objectives": [
    {
      "id": "w1-kill",
      "kind": "kill-scrapling",
      "label": "수정 껍질 파수꾼 처치",
      "count": 6,
      "poi": "shore"
    }
  ],
  "xp": 1100,
  "completeButton": "보상 받기"
},
  w2: {
  "id": "w2",
  "chapter": 2,
  "title": "별빛 대장간의 첫 불꽃",
  "giver": "pip",
  "turnIn": "pip",
  "offer": [
    "이사하느라 모루까지 끌고 왔지! 그런데 이곳 수정 없이는 새 장비를 만들 수 없어.",
    "수정 정원과 유적에 흩어진 네 개의 별빛 원석을 찾아 F로 주워 와."
  ],
  "progress": "빛나는 원석 가까이에서 F를 누르세요.",
  "complete": [
    "이 빛 좀 봐! 별빛 대장간이 드디어 문을 열었어."
  ],
  "summary": "이사하느라 모루까지 끌고 왔지! 그런데 이곳 수정 없이는 새 장비를 만들 수 없어. 수정 정원과 유적에 흩어진 네 개의 별빛 원석을 찾아 F로 주워 와.",
  "readyHint": "대장장이 핍에게 돌아가세요.",
  "objectives": [
    {
      "id": "w2-gem-0",
      "kind": "crystal-a",
      "label": "별빛 원석 1",
      "count": 1,
      "poi": "shore"
    },
    {
      "id": "w2-gem-1",
      "kind": "crystal-b",
      "label": "별빛 원석 2",
      "count": 1,
      "poi": "shore"
    },
    {
      "id": "w2-gem-2",
      "kind": "crystal-c",
      "label": "별빛 원석 3",
      "count": 1,
      "poi": "wreck"
    },
    {
      "id": "w2-gem-3",
      "kind": "crystal-d",
      "label": "별빛 원석 4",
      "count": 1,
      "poi": "wreck"
    }
  ],
  "xp": 1500,
  "completeButton": "보상 받기"
},
  w3: {
  "id": "w3",
  "chapter": 2,
  "title": "잠든 길에 불을 켜다",
  "giver": "rattlebolt",
  "turnIn": "rattlebolt",
  "offer": [
    "내 등대는 바다 건너에 두고 왔지만, 여기에도 불을 밝힐 일이 있더군.",
    "유적길의 세 별빛 등불에 다가가 F를 길게 눌러 불을 켜 줘."
  ],
  "progress": "세 등불에서 F를 길게 눌러 밝히세요.",
  "complete": [
    "봐라! 이젠 누구도 어두운 유적길에서 길을 잃지 않겠구나."
  ],
  "summary": "내 등대는 바다 건너에 두고 왔지만, 여기에도 불을 밝힐 일이 있더군. 유적길의 세 별빛 등불에 다가가 F를 길게 눌러 불을 켜 줘.",
  "readyHint": "등불지기 래틀볼트에게 돌아가세요.",
  "objectives": [
    {
      "id": "w3-lamp-0",
      "kind": "lamp-a",
      "label": "남쪽 별빛 등불 점화",
      "count": 1,
      "poi": "lighthouse"
    },
    {
      "id": "w3-lamp-1",
      "kind": "lamp-b",
      "label": "동쪽 별빛 등불 점화",
      "count": 1,
      "poi": "lighthouse"
    },
    {
      "id": "w3-lamp-2",
      "kind": "lamp-c",
      "label": "북쪽 별빛 등불 점화",
      "count": 1,
      "poi": "lighthouse"
    }
  ],
  "xp": 1700,
  "completeButton": "보상 받기"
},
  w4: {
  "id": "w4",
  "chapter": 2,
  "title": "그룩의 유적 순찰",
  "giver": "grukk",
  "turnIn": "grukk",
  "offer": [
    "그룩 새 마을 지킨다. 새 마을 간식도 지킨다.",
    "동쪽 폐허의 유적 수호자 여덟 마리! 네가 정리하면 그룩 문 지킨다."
  ],
  "progress": "동쪽 유적에서 별빛 유적 수호자 8마리를 처치하세요.",
  "complete": [
    "그룩 인정한다. 너, 이사 잘했다."
  ],
  "summary": "그룩 새 마을 지킨다. 새 마을 간식도 지킨다. 동쪽 폐허의 유적 수호자 여덟 마리! 네가 정리하면 그룩 문 지킨다.",
  "readyHint": "그룩에게 돌아가세요.",
  "objectives": [
    {
      "id": "w4-kill",
      "kind": "kill-scavenger",
      "label": "별빛 유적 수호자 처치",
      "count": 8,
      "poi": "wreck"
    }
  ],
  "xp": 1800,
  "completeButton": "보상 받기"
},
  w5: {
  "id": "w5",
  "chapter": 2,
  "title": "잊힌 섬의 기억",
  "giver": "silvermoon",
  "turnIn": "silvermoon",
  "offer": [
    "우리가 이곳으로 온 것은 우연이 아니에요. 섬의 별들이 당신을 기다렸어요.",
    "수정 정원, 별의 전망대, 왕좌 앞 기억의 성소를 탐험하고 돌아오세요."
  ],
  "progress": "세 장소의 빛나는 표식 안으로 들어가세요.",
  "complete": [
    "섬의 기억이 다시 이어졌어요. 이제 일식의 그림자를 걷을 수 있을 거예요."
  ],
  "summary": "우리가 이곳으로 온 것은 우연이 아니에요. 섬의 별들이 당신을 기다렸어요. 수정 정원, 별의 전망대, 왕좌 앞 기억의 성소를 탐험하고 돌아오세요.",
  "readyHint": "실버문에게 돌아가세요.",
  "objectives": [
    {
      "id": "w5-west",
      "kind": "explore-west",
      "label": "서쪽 수정 정원 탐험",
      "count": 1,
      "poi": "shore"
    },
    {
      "id": "w5-east",
      "kind": "explore-east",
      "label": "동쪽 별의 전망대 탐험",
      "count": 1,
      "poi": "grove"
    },
    {
      "id": "w5-north",
      "kind": "explore-north",
      "label": "기억의 성소 탐험",
      "count": 1,
      "poi": "lighthouse"
    }
  ],
  "xp": 2000,
  "completeButton": "보상 받기"
},
  w6: {
  "id": "w6",
  "chapter": 2,
  "title": "이삿짐 속 따뜻한 마음",
  "giver": "hoofclaw",
  "turnIn": "coralline",
  "offer": [
    "바다를 건너 이사했어도 따뜻한 수프는 빠질 수 없지!",
    "성소 앞의 코랄린에게 이 수프 바구니를 전해 주렴. 긴 여정에 모두 배가 고플 거야."
  ],
  "progress": "별빛 성소의 코랄린에게 수프를 전달하세요.",
  "complete": [
    "모두 같은 마을에서 다시 만나니 기쁘네요. 따뜻한 마음을 전해 줘서 고마워요."
  ],
  "summary": "바다를 건너 이사했어도 따뜻한 수프는 빠질 수 없지! 성소 앞의 코랄린에게 이 수프 바구니를 전해 주렴. 긴 여정에 모두 배가 고플 거야.",
  "readyHint": "코랄린에게 돌아가세요.",
  "objectives": [
    {
      "id": "w6-deliver",
      "kind": "deliver-supplies",
      "label": "코랄린에게 이삿짐 수프 전달",
      "count": 1,
      "poi": "npc:coralline"
    }
  ],
  "xp": 1000,
  "completeButton": "보상 받기"
},
  w7: {
  "id": "w7",
  "chapter": 2,
  "title": "일식 너머의 약속",
  "giver": "coralline",
  "turnIn": null,
  "offer": [
    "이 섬에 온 주민들은 당신과 함께 새 삶을 시작했어요. 이제 마지막 그림자만 남았어요.",
    "20레벨이 되면 별의 왕좌에서 일식의 여왕 아스트라를 쓰러뜨려 주세요."
  ],
  "progress": "20레벨부터 보스 여정에서 아스트라에게 도전하세요.",
  "complete": [
    "두 세계와 우리의 새 보금자리에 평화가 돌아왔습니다."
  ],
  "summary": "이 섬에 온 주민들은 당신과 함께 새 삶을 시작했어요. 이제 마지막 그림자만 남았어요. 20레벨이 되면 별의 왕좌에서 일식의 여왕 아스트라를 쓰러뜨려 주세요.",
  "readyHint": "보상이 지급됩니다.",
  "objectives": [
    {
      "id": "w7-boss",
      "kind": "eclipse-boss",
      "label": "아스트라 · 일식의 여왕 처치",
      "count": 1,
      "poi": "bossArena"
    }
  ],
  "xp": 2600,
  "completeButton": "보상 받기"
},
};

export const QUEST_ORDER: QuestId[] = ['q1', 'q2', 'q3', 'q4', 'w1','w2','w3','w4','w5','w6','w7','d1','d2','d3','d4','d5','d6','d7','d8','d9','d10','d11','d12','s1','s2','s3','s4','s5','s6','s7','s8','s9','s10','s11','s12'];

export interface NpcDef {
  id: NpcId;
  name: string;
  title: string;
  race: 'human' | 'orc' | 'dwarf' | 'undead' | 'nightelf' | 'tauren';
  sex: 'male' | 'female';
  classId: 'warrior' | 'mage' | 'priest';
  shell: number;
  crest: number;
  led: number;
  extras: string[];
  poi: PoiId;
  /** Idle gestures this NPC likes. */
  gestures: ('gesture_paw' | 'gesture_salute' | 'gesture_bow' | 'claw_left' | 'claw_right' | 'gesture_hello')[];
  lines: string[];
}

export const NPCS: NpcDef[] = [
  {
    id: 'brinebeard',
    name: 'Captain Brinebeard',
    title: 'Clawhaven Watch',
    race: 'dwarf',
    sex: 'male',
    classId: 'warrior',
    shell: 0,
    crest: 3,
    led: 1,
    extras: ['captain-hat'],
    poi: 'npc:brinebeard',
    gestures: ['gesture_salute', 'gesture_paw'],
    lines: [
      "The tide's turned, shellmate. I can feel it in my joints. Mostly because they're not creaking.",
      'Best crab on the Watch, you are. Second best. I am the best. But you are close.',
    ],
  },
  {
    id: 'silvermoon',
    name: 'Lady Silvermoon',
    title: 'Keeper of the Moonpool',
    race: 'nightelf',
    sex: 'female',
    classId: 'priest',
    shell: 0,
    crest: 2,
    led: 1,
    extras: [],
    poi: 'npc:silvermoon',
    gestures: ['gesture_bow', 'gesture_paw'],
    lines: [
      'The moon is pleased with you. I can tell. It is doing the thing with the light.',
      'The pool remembers every crab who has looked into it. It remembers you as brave, and slightly sandy.',
    ],
  },
  {
    id: 'coralline',
    name: 'Sister Coralline',
    title: 'Chapel of the Tide',
    race: 'human',
    sex: 'female',
    classId: 'priest',
    shell: 2,
    crest: 2,
    led: 0,
    extras: [],
    poi: 'npc:coralline',
    gestures: ['gesture_bow', 'gesture_paw'],
    lines: [
      'May the Tide mend your shell. There, good as new, and only slightly holier.',
      'Light a candle for the lighthouse, child. Then step back. Candles and claws do not mix.',
    ],
  },
  {
    id: 'grukk',
    name: 'Grukk Shellbreaker',
    title: 'Gate Guard',
    race: 'orc',
    sex: 'male',
    classId: 'warrior',
    shell: 0,
    crest: 1,
    led: 0,
    extras: [],
    poi: 'npc:grukk',
    gestures: ['claw_left', 'claw_right'],
    lines: [
      'Grukk guard gate. Grukk also guard snacks. You want claw-wrestle? No? Smart crab.',
      'Scraplings come at night. Grukk bonk them. Grukk run out of bonk. You help.',
      'Tavern wall says Grukk 212, everyone else 0. Wall does not lie. Grukk wrote it.',
    ],
  },
  {
    id: 'hoofclaw',
    name: 'Mama Hoofclaw',
    title: 'The Molting Kettle',
    race: 'tauren',
    sex: 'female',
    classId: 'priest',
    shell: 1,
    crest: 2,
    led: 1,
    extras: [],
    poi: 'npc:hoofclaw',
    gestures: ['gesture_paw', 'gesture_hello'],
    lines: [
      "Sit, sit! Kelp stew's on. Two bowls for heroes, three if you're Grukk. He says he's not hungry, then he's hungry.",
      'The secret ingredient is patience. And barnacles. Mostly barnacles.',
    ],
  },
  {
    id: 'rattlebolt',
    name: 'Old Rattlebolt',
    title: 'Lighthouse Keeper',
    race: 'undead',
    sex: 'male',
    classId: 'mage',
    shell: 0,
    crest: 3,
    led: 0,
    extras: [],
    poi: 'npc:rattlebolt',
    gestures: ['gesture_paw', 'claw_left'],
    lines: [
      "Eh? The light's been out three nights now. Can't see my own claws, and I've got spares.",
      'Scavengers on my stairs again. Rude. They never wipe their legs.',
    ],
  },
  {
    id: 'pip',
    name: 'Ironjaw Pip',
    title: 'Barnacle Forge',
    race: 'dwarf',
    sex: 'female',
    classId: 'warrior',
    shell: 1,
    crest: 2,
    led: 2,
    extras: [],
    poi: 'npc:pip',
    gestures: ['claw_right', 'gesture_salute'],
    lines: [
      "Mind the sparks! This anvil's older than my beard, and my beard's older than me. Long story. Involves a cable spool.",
      "Bring me a Rusted Cog and I'll... no, actually, keep it. It's disgusting.",
    ],
  },
];

export const RATTLEBOLT_Q3 =
  'Climbing my lighthouse? The beacon is up top. Hold the flame till it catches. F for Flame, I always say. Well, I said it once. Then I died. Then I came back.';
export const RATTLEBOLT_AFTER = "Lovely light. I'd cry, but my tear ducts rusted shut years ago.";

export const TOWNSFOLK_BARKS = [
  'Lovely evening for a scuttle.',
  'Have you tried walking forwards? Me neither.',
  'My LEDs feel dim today. Must be the rust.',
  'Grukk owes me three claw-wrestles.',
  'Did the lighthouse just blink? No? Just me?',
  'I polished my shell for nothing. NOTHING.',
  'Six legs and I still trip on the cobbles.',
  "The tavern stew smells like victory. And kelp.",
  'Sideways is the only way.',
  "I heard the Captain's beard is load-bearing.",
];

export const ENDING_BARKS = ['Hooray!', 'Dance, everyone!', 'Mind my legs!', 'The light is back!', 'Best night ever!', 'Pinch me, I am dreaming!'];

export const BOSS_YELLS = {
  get wake(){return t('누가 감히 내 녹에 빛을 비추는가?','Who dares shine a light on MY rust?');},
  get engage(){return t('새 볼트로군! 이리 오너라, 작은 껍질아!','Fresh bolts! Come closer, little shell!');},
  get phase2(){return t('일어나라, 녹의 하수인들이여! 잔치를 벌여라!','Rise, my rustlings! Feast!');},
  get undertow(){return t('밀려오는 파도가… 모두를… 삼킨다!','The tide... takes... ALL!');},
  get phase3(){return t('모든 것을… 녹슬게… 만들겠다!','I... WILL... CORRODE... EVERYTHING!');},
  get kill(){return t('고철 더미에 껍질 하나가 더 늘었군!','Another shell for the scrap heap!');},
  get death(){return t('이 빛은… 따뜻하구나…','The light... it is... warm...');},
};

// ------------------------------------------------------------------ state

export interface QuestEvents extends Record<string, unknown> {
  accepted: QuestId;
  progress: { quest: QuestId; objective: ObjectiveDef; value: number };
  ready: QuestId;
  completed: QuestId;
}

export interface CurrentObjective {
  quest: QuestId;
  /** 'objective' = go do it; 'turnin' / 'accept' = talk to an NPC. */
  step: 'objective' | 'turnin' | 'accept';
  objective?: ObjectiveDef;
  poi: PoiId;
  label: string;
}

export class QuestLog {
  readonly status: Record<QuestId, QuestStatus> = { q1: 'available', q2: 'locked', q3: 'locked', q4: 'locked', w1:'locked',w2:'locked',w3:'locked',w4:'locked',w5:'locked',w6:'locked',w7:'locked',d1:'locked',d2:'locked',d3:'locked',d4:'locked',d5:'locked',d6:'locked',d7:'locked',d8:'locked',d9:'locked',d10:'locked',d11:'locked',d12:'locked',s1:'locked',s2:'locked',s3:'locked',s4:'locked',s5:'locked',s6:'locked',s7:'locked',s8:'locked',s9:'locked',s10:'locked',s11:'locked',s12:'locked' };
  chapter:1|2|3|4=1;
  inChapter(id: QuestId) { return (QUESTS[id].chapter ?? 1)===this.chapter; }
  setChapter(chapter:1|2|3|4) {
    this.chapter=chapter;
    if(chapter>=2)for(const id of QUEST_ORDER)if(this.inChapter(id) && this.status[id]==='locked')this.status[id]='available';
  }
  readonly progress = new Map<string, number>();
  /** Personal navigation choices stay separate for the two worlds. */
  readonly tracked: Partial<Record<1 | 2 | 3 | 4, QuestId>> = {};
  readonly events = new Emitter<QuestEvents>();
  cogs = 0;

  private canTrack(id: QuestId, chapter = this.chapter): boolean {
    return (QUESTS[id].chapter ?? 1) === chapter &&
      (['active', 'ready'].includes(this.status[id]) || chapter >= 2 && this.status[id] === 'available');
  }

  track(id: QuestId): boolean {
    if (!this.canTrack(id)) return false;
    this.tracked[this.chapter] = id;
    return true;
  }

  get trackedQuest(): QuestId | null {
    const id = this.tracked[this.chapter];
    return id && this.canTrack(id) ? id : null;
  }

  restoreTracking(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const chapter of [1, 2, 3, 4] as const) {
      const id = (value as Record<string, unknown>)[chapter];
      if (typeof id === 'string' && QUEST_ORDER.includes(id as QuestId) && this.canTrack(id as QuestId, chapter)) this.tracked[chapter] = id as QuestId;
    }
  }

  value(o: ObjectiveDef): number {
    return this.progress.get(o.id) ?? 0;
  }

  objectiveDone(o: ObjectiveDef): boolean {
    return this.value(o) >= o.count;
  }

  accept(id: QuestId): void {
    if (!this.inChapter(id)) return;
    if (this.status[id] !== 'available' && this.status[id] !== 'locked') return;
    this.status[id] = 'active';
    this.events.emit('accepted', id);
    // Delivery quests are ready as soon as they start if the player already has the goods.
    this.checkReady(id);
  }

  /** Count an event toward every active quest objective of that kind. */
  bump(kind: ObjectiveKind, amount = 1): void {
    for (const id of QUEST_ORDER) {
      if (!this.inChapter(id) || this.status[id] !== 'active') continue;
      for (const o of QUESTS[id].objectives) {
        if (o.kind !== kind) continue;
        const v = this.value(o);
        if (v >= o.count) continue;
        const nv = Math.min(o.count, v + amount);
        this.progress.set(o.id, nv);
        this.events.emit('progress', { quest: id, objective: o, value: nv });
      }
      this.checkReady(id);
    }
  }

  /** Force the next missing objective of an active quest (debug F9). */
  completeObjective(o: ObjectiveDef): void {
    const v = this.value(o);
    if (v >= o.count) return;
    this.bump(o.kind, o.count - v);
  }

  private checkReady(id: QuestId): void {
    if (this.status[id] !== 'active') return;
    const def = QUESTS[id];
    if (!def.objectives.every((o) => this.objectiveDone(o))) return;
    if (def.turnIn === null) {
      this.complete(id);
    } else {
      this.status[id] = 'ready';
      this.events.emit('ready', id);
    }
  }

  complete(id: QuestId): void {
    if (this.status[id] === 'done') return;
    this.status[id] = 'done';
    const i = QUEST_ORDER.indexOf(id);
    const next = QUEST_ORDER[i + 1];
    if (next && (QUESTS[next].chapter??1)===(QUESTS[id].chapter??1) && this.status[next] === 'locked') this.status[next] = 'available';
    this.events.emit('completed', id);
  }

  /** Quests this NPC can offer right now. */
  offeredBy(npc: NpcId): QuestId | null {
    for (const id of QUEST_ORDER) if (this.inChapter(id) && this.status[id] === 'available' && QUESTS[id].giver === npc && id !== 'q4') return id;
    return null;
  }

  readyAt(npc: NpcId): QuestId | null {
    for (const id of QUEST_ORDER) if (this.inChapter(id) && this.status[id] === 'ready' && QUESTS[id].turnIn === npc) return id;
    return null;
  }

  /** Active (not ready) quest whose giver or turn-in is this NPC. */
  inProgressAt(npc: NpcId): QuestId | null {
    for (const id of QUEST_ORDER) {
      const d = QUESTS[id];
      if (this.inChapter(id) && this.status[id] === 'active' && (d.turnIn === npc || d.giver === npc)) return id;
    }
    return null;
  }

  active(): QuestId[] {
    return QUEST_ORDER.filter((id) => this.inChapter(id) && (this.status[id] === 'active' || this.status[id] === 'ready'));
  }

  get allDone(): boolean {
    return QUEST_ORDER.filter(id=>this.inChapter(id)).every((id) => this.status[id] === 'done');
  }

  current(): CurrentObjective | null {
    const tracked = this.trackedQuest;
    if (tracked && this.status[tracked] === 'available') {
      const giver = QUESTS[tracked].giver;
      return { quest: tracked, step: 'accept', poi: `npc:${giver}` as PoiId, label: t(`${npcName(giver)}에게 말 걸기`,`Speak with ${npcName(giver)}`) };
    }
    const order = tracked ? [tracked, ...QUEST_ORDER.filter(id => id !== tracked)] : QUEST_ORDER;
    for (const id of order) {
      if(!this.inChapter(id))continue;
      const def = QUESTS[id];
      if (this.status[id] === 'ready' && def.turnIn) {
        return { quest: id, step: 'turnin', poi: `npc:${def.turnIn}` as PoiId, label: def.readyHint };
      }
      if (this.status[id] === 'active') {
        const o = def.objectives.find((x) => !this.objectiveDone(x));
        if (o) return { quest: id, step: 'objective', objective: o, poi: o.poi, label: o.label };
      }
    }
    for (const id of QUEST_ORDER) {
      // The Rust Tide is pushed to the player when the beacon catches; nobody hands it out.
      if (this.inChapter(id) && this.status[id] === 'available' && id !== 'q4') {
        const giver = QUESTS[id].giver;
        return { quest: id, step: 'accept', poi: `npc:${giver}` as PoiId, label: t(`${npcName(giver)}에게 말 걸기`,`Speak with ${npcName(giver)}`) };
      }
    }
    return null;
  }
}

export function npcName(id: NpcId): string {
  return NPCS.find((n) => n.id === id)?.name ?? id;
}

const originalQuestText=structuredClone(QUESTS);
const originalNpcText=structuredClone(NPCS);
const koreanNpcText:Record<NpcId,{name:string;title:string;lines:string[]}>= {
 brinebeard:{name:'브라인비어드 선장',title:'클로헤이븐의 선장',lines:['어서 오게, 새 친구! 바다에서 돌아온 이야기 좀 들려주겠나?','주민들과 이야기해 보게. 작은 도움이 멋진 모험의 시작이 된다네.']},
 silvermoon:{name:'실버문',title:'달빛 연못의 수호자',lines:['달빛이 당신의 껍질 위에서 반짝이네요.','연못은 이곳을 찾아온 모든 게를 기억한답니다.']},
 coralline:{name:'코랄린',title:'파도의 성소',lines:['파도가 당신의 껍질을 치유하기를. 아픈 곳은 없나요?','지친 몸을 잠시 쉬게 해 주세요. 모험은 기다려 줄 거예요.']},
 grukk:{name:'그룩',title:'마을 경비병',lines:['그룩 마을 지킨다. 간식도 지킨다.','고철 게 오면 그룩이 혼내 준다! 같이 할래?']},
 hoofclaw:{name:'마마 후프클로',title:'허물을 벗는 주전자 주점',lines:['앉으렴! 영웅을 위한 해초 수프가 끓고 있단다.','따뜻한 밥을 먹으면 다시 모험할 힘이 생기지!']},
 rattlebolt:{name:'래틀볼트',title:'등대지기',lines:['등대가 꺼지면 배들이 길을 잃어. 꼭대기에 불을 켜 주겠나?','등대를 켜면 밤의 수호자가 깨어나지. 끄면 다시 아침이 된다네.']},
 pip:{name:'대장장이 핍',title:'따개비 대장간',lines:['불꽃 조심해! 오늘도 좋은 장비를 만들고 있지.','집게를 단단히! 모험에는 튼튼한 장비가 필요한 법이야.']},
};
export function setQuestLanguage(value:Language){for(const id of QUEST_ORDER)Object.assign(QUESTS[id],translatedQuest(originalQuestText[id],value));for(const npc of NPCS){const source=value==='ko'?koreanNpcText[npc.id]:originalNpcText.find(n=>n.id===npc.id)!;npc.name=source.name;npc.title=source.title;npc.lines=[...source.lines];}}
setQuestLanguage(language());
