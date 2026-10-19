import type {QuestDef} from './quests';

export type SnowQuestId = 's3' | 's4' | 's5' | 's6' | 's7' | 's8' | 's9' | 's10' | 's11' | 's12';
export type SnowObjectiveKind = `snow-${'crate'|'herb'|'lamp'|'ore'|'pearl'|'seal'}-${'a'|'b'|'c'}` | `snow-visit-${'forest'|'overlook'|'aurora'}` | 'snow-letter';

export const SNOW_QUESTS = {
  "s3": {
    "id": "s3",
    "chapter": 4,
    "title": "Winter Relief",
    "giver": "brinebeard",
    "turnIn": "coralline",
    "offer": [
      "Recover three supply crates around Snowfall Village and bring them to the medic."
    ],
    "progress": "Recover three supply crates around Snowfall Village and bring them to the medic.",
    "complete": [
      "Our frostbitten scouts finally have medicine."
    ],
    "summary": "Recover three supply crates around Snowfall Village and bring them to the medic.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s3-1",
        "kind": "snow-crate-a",
        "label": "Supply crate 1",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "s3-2",
        "kind": "snow-crate-b",
        "label": "Supply crate 2",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "s3-3",
        "kind": "snow-crate-c",
        "label": "Supply crate 3",
        "count": 1,
        "poi": "shore"
      }
    ],
    "xp": 22000
  },
  "s4": {
    "id": "s4",
    "chapter": 4,
    "title": "Blossoms Beneath the Snow",
    "giver": "coralline",
    "turnIn": "coralline",
    "offer": [
      "Gather three blue frost blossoms in the western Frostpine Woods."
    ],
    "progress": "Gather three blue frost blossoms in the western Frostpine Woods.",
    "complete": [
      "Life still grows beneath the snow. Thank you!"
    ],
    "summary": "Gather three blue frost blossoms in the western Frostpine Woods.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s4-1",
        "kind": "snow-herb-a",
        "label": "Frost blossom 1",
        "count": 1,
        "poi": "grove"
      },
      {
        "id": "s4-2",
        "kind": "snow-herb-b",
        "label": "Frost blossom 2",
        "count": 1,
        "poi": "grove"
      },
      {
        "id": "s4-3",
        "kind": "snow-herb-c",
        "label": "Frost blossom 3",
        "count": 1,
        "poi": "grove"
      }
    ],
    "xp": 24000
  },
  "s5": {
    "id": "s5",
    "chapter": 4,
    "title": "A Light Through the Blizzard",
    "giver": "rattlebolt",
    "turnIn": "rattlebolt",
    "offer": [
      "Hold F to light three guide lanterns along the northern road."
    ],
    "progress": "Hold F to light three guide lanterns along the northern road.",
    "complete": [
      "Lost travelers can follow these lights home."
    ],
    "summary": "Hold F to light three guide lanterns along the northern road.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s5-1",
        "kind": "snow-lamp-a",
        "label": "Guide lantern 1",
        "count": 1,
        "poi": "lighthouse"
      },
      {
        "id": "s5-2",
        "kind": "snow-lamp-b",
        "label": "Guide lantern 2",
        "count": 1,
        "poi": "lighthouse"
      },
      {
        "id": "s5-3",
        "kind": "snow-lamp-c",
        "label": "Guide lantern 3",
        "count": 1,
        "poi": "lighthouse"
      }
    ],
    "xp": 28000
  },
  "s6": {
    "id": "s6",
    "chapter": 4,
    "title": "Charting the Aurora",
    "giver": "silvermoon",
    "turnIn": "silvermoon",
    "offer": [
      "Visit the western forest shelter, eastern ice overlook and northern aurora ridge to chart Frostlight."
    ],
    "progress": "Visit the western forest shelter, eastern ice overlook and northern aurora ridge to chart Frostlight.",
    "complete": [
      "There is beauty beyond the blizzard after all."
    ],
    "summary": "Visit the western forest shelter, eastern ice overlook and northern aurora ridge to chart Frostlight.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s6-1",
        "kind": "snow-visit-forest",
        "label": "Forest shelter discovered",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "s6-2",
        "kind": "snow-visit-overlook",
        "label": "Ice overlook discovered",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "s6-3",
        "kind": "snow-visit-aurora",
        "label": "Aurora ridge discovered",
        "count": 1,
        "poi": "shore"
      }
    ],
    "xp": 30000
  },
  "s7": {
    "id": "s7",
    "chapter": 4,
    "title": "Frostiron for the Forge",
    "giver": "pip",
    "turnIn": "pip",
    "offer": [
      "Mine three distinct frostiron ores among the rocks of the eastern snowfields."
    ],
    "progress": "Mine three distinct frostiron ores among the rocks of the eastern snowfields.",
    "complete": [
      "These ores will make tools that withstand the cold!"
    ],
    "summary": "Mine three distinct frostiron ores among the rocks of the eastern snowfields.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s7-1",
        "kind": "snow-ore-a",
        "label": "Frostiron ore 1",
        "count": 1,
        "poi": "wreck"
      },
      {
        "id": "s7-2",
        "kind": "snow-ore-b",
        "label": "Frostiron ore 2",
        "count": 1,
        "poi": "wreck"
      },
      {
        "id": "s7-3",
        "kind": "snow-ore-c",
        "label": "Frostiron ore 3",
        "count": 1,
        "poi": "wreck"
      }
    ],
    "xp": 35000
  },
  "s8": {
    "id": "s8",
    "chapter": 4,
    "title": "A Place at the Warm Table",
    "giver": "hoofclaw",
    "turnIn": "hoofclaw",
    "offer": [
      "Find three ice pearls in the eastern glacial valley for Mira’s welcome decorations."
    ],
    "progress": "Find three ice pearls in the eastern glacial valley for Mira’s welcome decorations.",
    "complete": [
      "A hot bowl of soup will be waiting when Mira returns."
    ],
    "summary": "Find three ice pearls in the eastern glacial valley for Mira’s welcome decorations.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s8-1",
        "kind": "snow-pearl-a",
        "label": "Ice pearl 1",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "s8-2",
        "kind": "snow-pearl-b",
        "label": "Ice pearl 2",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "s8-3",
        "kind": "snow-pearl-c",
        "label": "Ice pearl 3",
        "count": 1,
        "poi": "shore"
      }
    ],
    "xp": 32000
  },
  "s9": {
    "id": "s9",
    "chapter": 4,
    "title": "The Blizzard Report",
    "giver": "rattlebolt",
    "turnIn": "brinebeard",
    "offer": [
      "Deliver the blizzard patrol report to Captain Brinebeard in Snowfall Village."
    ],
    "progress": "Deliver the blizzard patrol report to Captain Brinebeard in Snowfall Village.",
    "complete": [
      "We have located the northern ice prison. We will bring Mira home!"
    ],
    "summary": "Deliver the blizzard patrol report to Captain Brinebeard in Snowfall Village.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s9-1",
        "kind": "snow-letter",
        "label": "Deliver the report to the captain",
        "count": 1,
        "poi": "npc:brinebeard"
      }
    ],
    "xp": 26000
  },
  "s10": {
    "id": "s10",
    "chapter": 4,
    "title": "Defend Snowfall Village",
    "giver": "grukk",
    "turnIn": "grukk",
    "offer": [
      "Defeat eight Frost-shell Raiders to protect the village supply route."
    ],
    "progress": "Defeat eight Frost-shell Raiders to protect the village supply route.",
    "complete": [
      "Grukk happy! Soup deliveries safe again!"
    ],
    "summary": "Defeat eight Frost-shell Raiders to protect the village supply route.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s10-1",
        "kind": "kill-scrapling",
        "label": "Frost-shell Raiders defeated",
        "count": 8,
        "poi": "shore"
      }
    ],
    "xp": 40000
  },
  "s11": {
    "id": "s11",
    "chapter": 4,
    "title": "Seals of the Frozen Throne",
    "giver": "silvermoon",
    "turnIn": "silvermoon",
    "offer": [
      "Recover three aurora seals scattered along the approach to the Frozen Throne."
    ],
    "progress": "Recover three aurora seals scattered along the approach to the Frozen Throne.",
    "complete": [
      "Their light carries hope of ending Boreas’s endless winter."
    ],
    "summary": "Recover three aurora seals scattered along the approach to the Frozen Throne.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s11-1",
        "kind": "snow-seal-a",
        "label": "Aurora seal 1",
        "count": 1,
        "poi": "wreck"
      },
      {
        "id": "s11-2",
        "kind": "snow-seal-b",
        "label": "Aurora seal 2",
        "count": 1,
        "poi": "wreck"
      },
      {
        "id": "s11-3",
        "kind": "snow-seal-c",
        "label": "Aurora seal 3",
        "count": 1,
        "poi": "wreck"
      }
    ],
    "xp": 50000
  },
  "s12": {
    "id": "s12",
    "chapter": 4,
    "title": "The Last Glacial Patrol",
    "giver": "grukk",
    "turnIn": "grukk",
    "offer": [
      "Defeat twelve Glacial Sentinels on the approach to the Frozen Throne."
    ],
    "progress": "Defeat twelve Glacial Sentinels on the approach to the Frozen Throne.",
    "complete": [
      "The road is clear! At level 300, defeat the Frost King and rescue your friend!"
    ],
    "summary": "Defeat twelve Glacial Sentinels on the approach to the Frozen Throne.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "s12-1",
        "kind": "kill-scavenger",
        "label": "Glacial Sentinels defeated",
        "count": 12,
        "poi": "wreck"
      }
    ],
    "xp": 65000
  }
} satisfies Record<SnowQuestId,QuestDef>;

export const SNOW_KOREAN = {
  "s3": {
    "title": "겨울 보급대",
    "offer": [
      "눈꽃 마을 주변에 떨어진 보급 상자 세 개를 의무관에게 가져다주세요."
    ],
    "progress": "눈꽃 마을 주변에 떨어진 보급 상자 세 개를 의무관에게 가져다주세요.",
    "complete": [
      "동상에 걸린 정찰대원들에게 약을 나눠 줄 수 있겠어요."
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "보급 상자 1",
      "보급 상자 2",
      "보급 상자 3"
    ]
  },
  "s4": {
    "title": "눈 속에 피는 약초",
    "offer": [
      "서쪽 서리 소나무 숲에서 푸르게 빛나는 설원 약초 세 송이를 모아 주세요."
    ],
    "progress": "서쪽 서리 소나무 숲에서 푸르게 빛나는 설원 약초 세 송이를 모아 주세요.",
    "complete": [
      "눈 속에서도 생명은 자라고 있어요. 고마워요!"
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "설원 약초 1",
      "설원 약초 2",
      "설원 약초 3"
    ]
  },
  "s5": {
    "title": "눈보라 속 귀갓길",
    "offer": [
      "북쪽 길의 꺼진 길잡이 등불 세 곳에서 F를 길게 눌러 불을 밝혀 주세요."
    ],
    "progress": "북쪽 길의 꺼진 길잡이 등불 세 곳에서 F를 길게 눌러 불을 밝혀 주세요.",
    "complete": [
      "길 잃은 여행자들도 마을의 불빛을 찾겠구나."
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "길잡이 등불 1",
      "길잡이 등불 2",
      "길잡이 등불 3"
    ]
  },
  "s6": {
    "title": "오로라 탐험 지도",
    "offer": [
      "서쪽 숲 쉼터, 동쪽 얼음 전망대, 북쪽 오로라 언덕을 방문해 설원의 지도를 완성하세요."
    ],
    "progress": "서쪽 숲 쉼터, 동쪽 얼음 전망대, 북쪽 오로라 언덕을 방문해 설원의 지도를 완성하세요.",
    "complete": [
      "눈보라 너머에도 아름다운 풍경이 있었군요."
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "서리 숲 쉼터 발견",
      "얼음 전망대 발견",
      "오로라 언덕 발견"
    ]
  },
  "s7": {
    "title": "대장간을 위한 서리철",
    "offer": [
      "동쪽 설원 바위밭에서 서로 다른 서리철 광석 세 개를 캐 주세요."
    ],
    "progress": "동쪽 설원 바위밭에서 서로 다른 서리철 광석 세 개를 캐 주세요.",
    "complete": [
      "이 광석으로 추위에도 부서지지 않는 도구를 만들겠어!"
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "서리철 광석 1",
      "서리철 광석 2",
      "서리철 광석 3"
    ]
  },
  "s8": {
    "title": "따뜻한 식탁의 약속",
    "offer": [
      "동쪽 얼음 계곡에서 빛나는 얼음 진주 세 개를 찾아 미라의 환영 장식을 만들어 주세요."
    ],
    "progress": "동쪽 얼음 계곡에서 빛나는 얼음 진주 세 개를 찾아 미라의 환영 장식을 만들어 주세요.",
    "complete": [
      "미라가 돌아오면 뜨끈한 수프부터 내어 줄 거예요."
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "얼음 진주 1",
      "얼음 진주 2",
      "얼음 진주 3"
    ]
  },
  "s9": {
    "title": "눈보라 정찰 보고서",
    "offer": [
      "정찰 보고서를 눈꽃 마을의 브라인비어드 선장에게 전해 주세요."
    ],
    "progress": "정찰 보고서를 눈꽃 마을의 브라인비어드 선장에게 전해 주세요.",
    "complete": [
      "북쪽 얼음 감옥의 위치를 확인했네. 미라를 꼭 구하자!"
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "선장에게 보고서 전달"
    ]
  },
  "s10": {
    "title": "눈꽃 마을 방위전",
    "offer": [
      "마을 보급로를 지키기 위해 서리 껍질 약탈자 여덟을 물리쳐 주세요."
    ],
    "progress": "마을 보급로를 지키기 위해 서리 껍질 약탈자 여덟을 물리쳐 주세요.",
    "complete": [
      "그룩 기쁘다! 이제 수프 배달도 안전하다!"
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "서리 껍질 약탈자 처치"
    ]
  },
  "s11": {
    "title": "얼음 왕좌의 봉인",
    "offer": [
      "왕좌로 향하는 길에서 흩어진 오로라 봉인 세 개를 회수해 주세요."
    ],
    "progress": "왕좌로 향하는 길에서 흩어진 오로라 봉인 세 개를 회수해 주세요.",
    "complete": [
      "봉인의 빛이 보레아스의 긴 겨울을 끝낼 희망이 될 거예요."
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "오로라 봉인 1",
      "오로라 봉인 2",
      "오로라 봉인 3"
    ]
  },
  "s12": {
    "title": "빙하 성채의 마지막 순찰",
    "offer": [
      "얼음 왕좌로 가는 길의 빙하 성채 파수병 열둘을 물리쳐 주세요."
    ],
    "progress": "얼음 왕좌로 가는 길의 빙하 성채 파수병 열둘을 물리쳐 주세요.",
    "complete": [
      "길 열렸다! 300레벨이 되면 서리왕을 쓰러뜨리고 친구를 구해!"
    ],
    "readyHint": "지도의 표시를 따라 눈꽃 마을 주민에게 돌아가세요.",
    "labels": [
      "빙하 성채 파수병 처치"
    ]
  }
};

export const SNOW_POINTS:Partial<Record<SnowObjectiveKind,[number,number]>> = {
  "snow-crate-a": [
    -4.6,
    93.2
  ],
  "snow-crate-b": [
    12,
    72
  ],
  "snow-crate-c": [
    -8.2,
    56.2
  ],
  "snow-herb-a": [
    -47,
    40
  ],
  "snow-herb-b": [
    -52,
    28
  ],
  "snow-herb-c": [
    -44,
    14
  ],
  "snow-lamp-a": [
    -7,
    26
  ],
  "snow-lamp-b": [
    7,
    4
  ],
  "snow-lamp-c": [
    -7,
    -22
  ],
  "snow-visit-forest": [
    -50,
    26
  ],
  "snow-visit-overlook": [
    61,
    22
  ],
  "snow-visit-aurora": [
    0,
    -34
  ],
  "snow-ore-a": [
    36,
    8
  ],
  "snow-ore-b": [
    44,
    -6
  ],
  "snow-ore-c": [
    34,
    -22
  ],
  "snow-pearl-a": [
    62,
    34
  ],
  "snow-pearl-b": [
    68,
    20
  ],
  "snow-pearl-c": [
    60,
    4
  ],
  "snow-seal-a": [
    -17,
    -34
  ],
  "snow-seal-b": [
    17,
    -42
  ],
  "snow-seal-c": [
    -16,
    -54
  ]
};
