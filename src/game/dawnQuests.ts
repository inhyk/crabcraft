import type {QuestDef} from './quests';

export type DawnQuestId = 'd3' | 'd4' | 'd5' | 'd6' | 'd7' | 'd8' | 'd9' | 'd10' | 'd11' | 'd12';
export type DawnObjectiveKind = `dawn-${'crate'|'herb'|'lamp'|'ore'|'pearl'|'seal'}-${'a'|'b'|'c'}` | `dawn-visit-${'garden'|'coast'|'watch'}` | 'dawn-letter';

export const DAWN_QUESTS = {
  "d3": {
    "id": "d3",
    "chapter": 3,
    "title": "Harbor Relief",
    "giver": "brinebeard",
    "turnIn": "coralline",
    "offer": [
      "Recover three marked supply crates around Goldsand Harbor, then bring them to Medic Coral."
    ],
    "progress": "Recover three marked supply crates around Goldsand Harbor, then bring them to Medic Coral.",
    "complete": [
      "The medicine has reached our village. Mira would be proud of you."
    ],
    "summary": "Recover three marked supply crates around Goldsand Harbor, then bring them to Medic Coral.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d3-a",
        "kind": "dawn-crate-a",
        "label": "Supply crate 1",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "d3-b",
        "kind": "dawn-crate-b",
        "label": "Supply crate 2",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "d3-c",
        "kind": "dawn-crate-c",
        "label": "Supply crate 3",
        "count": 1,
        "poi": "shore"
      }
    ],
    "xp": 6000
  },
  "d4": {
    "id": "d4",
    "chapter": 3,
    "title": "Seabreeze Remedies",
    "giver": "coralline",
    "turnIn": "coralline",
    "offer": [
      "Gather three different healing blossoms in the western Seabreeze Gardens."
    ],
    "progress": "Gather three different healing blossoms in the western Seabreeze Gardens.",
    "complete": [
      "Fresh remedies! Our injured scouts can finally rest."
    ],
    "summary": "Gather three different healing blossoms in the western Seabreeze Gardens.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d4-a",
        "kind": "dawn-herb-a",
        "label": "Healing blossom 1",
        "count": 1,
        "poi": "grove"
      },
      {
        "id": "d4-b",
        "kind": "dawn-herb-b",
        "label": "Healing blossom 2",
        "count": 1,
        "poi": "grove"
      },
      {
        "id": "d4-c",
        "kind": "dawn-herb-c",
        "label": "Healing blossom 3",
        "count": 1,
        "poi": "grove"
      }
    ],
    "xp": 6500
  },
  "d5": {
    "id": "d5",
    "chapter": 3,
    "title": "Lanterns on the Ascent",
    "giver": "rattlebolt",
    "turnIn": "rattlebolt",
    "offer": [
      "Hold F at all three unlit lanterns along the northern ascent."
    ],
    "progress": "Hold F at all three unlit lanterns along the northern ascent.",
    "complete": [
      "The scouts can see their way home through the twilight."
    ],
    "summary": "Hold F at all three unlit lanterns along the northern ascent.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d5-a",
        "kind": "dawn-lamp-a",
        "label": "Ascent lantern 1",
        "count": 1,
        "poi": "lighthouse"
      },
      {
        "id": "d5-b",
        "kind": "dawn-lamp-b",
        "label": "Ascent lantern 2",
        "count": 1,
        "poi": "lighthouse"
      },
      {
        "id": "d5-c",
        "kind": "dawn-lamp-c",
        "label": "Ascent lantern 3",
        "count": 1,
        "poi": "lighthouse"
      }
    ],
    "xp": 7000
  },
  "d6": {
    "id": "d6",
    "chapter": 3,
    "title": "A Map of the Lost Dawn",
    "giver": "silvermoon",
    "turnIn": "silvermoon",
    "offer": [
      "Visit the western garden, eastern pearl coast and southern watchpoint to chart our island."
    ],
    "progress": "Visit the western garden, eastern pearl coast and southern watchpoint to chart our island.",
    "complete": [
      "Three landmarks, one safe route. Keep following Mira’s trail north."
    ],
    "summary": "Visit the western garden, eastern pearl coast and southern watchpoint to chart our island.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d6-garden",
        "kind": "dawn-visit-garden",
        "label": "Seabreeze Gardens",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "d6-coast",
        "kind": "dawn-visit-coast",
        "label": "Pearl Coast",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "d6-watch",
        "kind": "dawn-visit-watch",
        "label": "Dawnwatch Outlook",
        "count": 1,
        "poi": "shore"
      }
    ],
    "xp": 7500
  },
  "d7": {
    "id": "d7",
    "chapter": 3,
    "title": "Keep the Docks Safe",
    "giver": "grukk",
    "turnIn": "grukk",
    "offer": [
      "Defeat eight Ash Coast Raiders so the supply crews can leave the harbor."
    ],
    "progress": "Defeat eight Ash Coast Raiders so the supply crews can leave the harbor.",
    "complete": [
      "Baron approves. The boats and their crews are safe!"
    ],
    "summary": "Defeat eight Ash Coast Raiders so the supply crews can leave the harbor.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d7-kill",
        "kind": "kill-scrapling",
        "label": "Ash Coast Raiders defeated",
        "count": 8,
        "poi": "shore"
      }
    ],
    "xp": 8000
  },
  "d8": {
    "id": "d8",
    "chapter": 3,
    "title": "Embers for the Forge",
    "giver": "pip",
    "turnIn": "pip",
    "offer": [
      "Collect three distinct ember ores along the ascent for Flynn’s forge."
    ],
    "progress": "Collect three distinct ember ores along the ascent for Flynn’s forge.",
    "complete": [
      "The forge burns bright. These tools will help us reach Frostlight."
    ],
    "summary": "Collect three distinct ember ores along the ascent for Flynn’s forge.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d8-a",
        "kind": "dawn-ore-a",
        "label": "Ember ore 1",
        "count": 1,
        "poi": "wreck"
      },
      {
        "id": "d8-b",
        "kind": "dawn-ore-b",
        "label": "Ember ore 2",
        "count": 1,
        "poi": "wreck"
      },
      {
        "id": "d8-c",
        "kind": "dawn-ore-c",
        "label": "Ember ore 3",
        "count": 1,
        "poi": "wreck"
      }
    ],
    "xp": 8500
  },
  "d9": {
    "id": "d9",
    "chapter": 3,
    "title": "Pearls for the Homecoming",
    "giver": "hoofclaw",
    "turnIn": "hoofclaw",
    "offer": [
      "Gather three sea pearls on the eastern coast to decorate Mira’s welcome table."
    ],
    "progress": "Gather three sea pearls on the eastern coast to decorate Mira’s welcome table.",
    "complete": [
      "We will keep her place at the table until she returns."
    ],
    "summary": "Gather three sea pearls on the eastern coast to decorate Mira’s welcome table.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d9-a",
        "kind": "dawn-pearl-a",
        "label": "Sea pearl 1",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "d9-b",
        "kind": "dawn-pearl-b",
        "label": "Sea pearl 2",
        "count": 1,
        "poi": "shore"
      },
      {
        "id": "d9-c",
        "kind": "dawn-pearl-c",
        "label": "Sea pearl 3",
        "count": 1,
        "poi": "shore"
      }
    ],
    "xp": 8000
  },
  "d10": {
    "id": "d10",
    "chapter": 3,
    "title": "The Scout’s Letter",
    "giver": "rattlebolt",
    "turnIn": "brinebeard",
    "offer": [
      "Deliver Lumen’s sealed report to Captain Roan in Goldsand Harbor."
    ],
    "progress": "Deliver Lumen’s sealed report to Captain Roan in Goldsand Harbor.",
    "complete": [
      "Boreas took Mira through the snow portal. Now we know where to search."
    ],
    "summary": "Deliver Lumen’s sealed report to Captain Roan in Goldsand Harbor.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d10-letter",
        "kind": "dawn-letter",
        "label": "Deliver the report to the captain",
        "count": 1,
        "poi": "npc:brinebeard"
      }
    ],
    "xp": 6500
  },
  "d11": {
    "id": "d11",
    "chapter": 3,
    "title": "Seals of the Dawn",
    "giver": "silvermoon",
    "turnIn": "silvermoon",
    "offer": [
      "Recover three scattered dawn seals before the gates of the Twilight Citadel."
    ],
    "progress": "Recover three scattered dawn seals before the gates of the Twilight Citadel.",
    "complete": [
      "The seals remember the dawn. Even Boreas cannot freeze our hope."
    ],
    "summary": "Recover three scattered dawn seals before the gates of the Twilight Citadel.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d11-a",
        "kind": "dawn-seal-a",
        "label": "Dawn seal 1",
        "count": 1,
        "poi": "wreck"
      },
      {
        "id": "d11-b",
        "kind": "dawn-seal-b",
        "label": "Dawn seal 2",
        "count": 1,
        "poi": "wreck"
      },
      {
        "id": "d11-c",
        "kind": "dawn-seal-c",
        "label": "Dawn seal 3",
        "count": 1,
        "poi": "wreck"
      }
    ],
    "xp": 9500
  },
  "d12": {
    "id": "d12",
    "chapter": 3,
    "title": "The Last Sentinel Patrol",
    "giver": "grukk",
    "turnIn": "grukk",
    "offer": [
      "Defeat twelve Twilight Sentinels to clear the approach to Solarkan."
    ],
    "progress": "Defeat twelve Twilight Sentinels to clear the approach to Solarkan.",
    "complete": [
      "The approach is clear. Reach level 100 and open the road to Mira in Frostlight."
    ],
    "summary": "Defeat twelve Twilight Sentinels to clear the approach to Solarkan.",
    "readyHint": "Return to the villager marked on your map.",
    "objectives": [
      {
        "id": "d12-kill",
        "kind": "kill-scavenger",
        "label": "Twilight Sentinels defeated",
        "count": 12,
        "poi": "wreck"
      }
    ],
    "xp": 12000
  }
} satisfies Record<DawnQuestId, QuestDef>;

export const DAWN_KOREAN = {
  "d3": {
    "title": "항구의 구호 물자",
    "offer": [
      "항구에 흩어진 구호 상자 세 개를 모아 의무관 산호에게 가져다주세요."
    ],
    "progress": "항구에 흩어진 구호 상자 세 개를 모아 의무관 산호에게 가져다주세요.",
    "complete": [
      "약품이 무사히 도착했어요. 미라도 기뻐할 거예요."
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "구호 상자 1",
      "구호 상자 2",
      "구호 상자 3"
    ]
  },
  "d4": {
    "title": "바닷바람 약초",
    "offer": [
      "서쪽 바닷바람 정원의 서로 다른 약초 세 송이를 채집해 주세요."
    ],
    "progress": "서쪽 바닷바람 정원의 서로 다른 약초 세 송이를 채집해 주세요.",
    "complete": [
      "신선한 약초네요! 다친 정찰대원들을 치료할 수 있겠어요."
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "치유 약초 1",
      "치유 약초 2",
      "치유 약초 3"
    ]
  },
  "d5": {
    "title": "오르막길에 등불을",
    "offer": [
      "북쪽 오르막길의 꺼진 등불 세 곳에서 F를 길게 눌러 불을 밝혀 주세요."
    ],
    "progress": "북쪽 오르막길의 꺼진 등불 세 곳에서 F를 길게 눌러 불을 밝혀 주세요.",
    "complete": [
      "이제 정찰대가 황혼 속에서도 집으로 오는 길을 찾겠군!"
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "오르막 등불 1",
      "오르막 등불 2",
      "오르막 등불 3"
    ]
  },
  "d6": {
    "title": "잃어버린 새벽의 지도",
    "offer": [
      "서쪽 정원, 동쪽 진주 해안, 남쪽 전망대를 찾아 섬의 지도를 완성해 주세요."
    ],
    "progress": "서쪽 정원, 동쪽 진주 해안, 남쪽 전망대를 찾아 섬의 지도를 완성해 주세요.",
    "complete": [
      "세 장소가 안전한 길로 이어졌어요. 북쪽으로 미라의 흔적을 따라가세요."
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "바닷바람 정원 발견",
      "진주 해안 발견",
      "새벽 전망대 발견"
    ]
  },
  "d7": {
    "title": "항구를 지켜라",
    "offer": [
      "보급대가 항구를 나설 수 있도록 잿빛 해안 약탈자 여덟을 처치해 주세요."
    ],
    "progress": "보급대가 항구를 나설 수 있도록 잿빛 해안 약탈자 여덟을 처치해 주세요.",
    "complete": [
      "바론도 만족할 거예요. 배도 선원들도 안전해졌어요!"
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "해안 약탈자 처치"
    ]
  },
  "d8": {
    "title": "대장간을 깨울 불씨",
    "offer": [
      "플린의 대장간을 위해 오르막길에서 서로 다른 불씨 광석 세 개를 캐 주세요."
    ],
    "progress": "플린의 대장간을 위해 오르막길에서 서로 다른 불씨 광석 세 개를 캐 주세요.",
    "complete": [
      "대장간에 다시 불이 붙었어. 이 도구로 설원까지 길을 열자!"
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "불씨 광석 1",
      "불씨 광석 2",
      "불씨 광석 3"
    ]
  },
  "d9": {
    "title": "돌아올 친구를 위한 진주",
    "offer": [
      "미라가 돌아올 날을 위해 동쪽 해안에서 바다 진주 세 개를 모아 주세요."
    ],
    "progress": "미라가 돌아올 날을 위해 동쪽 해안에서 바다 진주 세 개를 모아 주세요.",
    "complete": [
      "미라가 돌아올 때까지 식탁의 자리를 비워 둘게요."
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "바다 진주 1",
      "바다 진주 2",
      "바다 진주 3"
    ]
  },
  "d10": {
    "title": "정찰대의 편지",
    "offer": [
      "루멘이 맡긴 봉인된 정찰 보고서를 골드샌드 항구의 로안 선장에게 전해 주세요."
    ],
    "progress": "루멘이 맡긴 봉인된 정찰 보고서를 골드샌드 항구의 로안 선장에게 전해 주세요.",
    "complete": [
      "보레아스가 미라를 설원 포탈로 데려갔다고 하네. 이제 찾을 곳을 알았어."
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "선장에게 보고서 전달"
    ]
  },
  "d11": {
    "title": "새벽의 봉인",
    "offer": [
      "황혼 성채로 가는 길에 흩어진 새벽의 봉인 세 개를 찾아 주세요."
    ],
    "progress": "황혼 성채로 가는 길에 흩어진 새벽의 봉인 세 개를 찾아 주세요.",
    "complete": [
      "봉인이 새벽의 빛을 기억해요. 보레아스도 우리의 희망을 얼릴 수는 없어요."
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "새벽의 봉인 1",
      "새벽의 봉인 2",
      "새벽의 봉인 3"
    ]
  },
  "d12": {
    "title": "성채 앞 마지막 순찰",
    "offer": [
      "솔라칸에게 가는 길을 열기 위해 황혼 파수병 열둘을 처치해 주세요."
    ],
    "progress": "솔라칸에게 가는 길을 열기 위해 황혼 파수병 열둘을 처치해 주세요.",
    "complete": [
      "성채 앞이 안전하다! 100레벨이 되면 설원으로 미라를 구하러 가라!"
    ],
    "readyHint": "지도의 표시를 따라 주민에게 돌아가세요.",
    "labels": [
      "황혼 파수병 처치"
    ]
  }
};

export const DAWN_POINTS:Partial<Record<DawnObjectiveKind,[number,number]>> = {
  "dawn-crate-a": [
    -12,
    76
  ],
  "dawn-crate-b": [
    12,
    70
  ],
  "dawn-crate-c": [
    -12,
    62
  ],
  "dawn-herb-a": [
    -55,
    44
  ],
  "dawn-herb-b": [
    -62,
    38
  ],
  "dawn-herb-c": [
    -56,
    30
  ],
  "dawn-lamp-a": [
    -7,
    20
  ],
  "dawn-lamp-b": [
    7,
    0
  ],
  "dawn-lamp-c": [
    -7,
    -22
  ],
  "dawn-ore-a": [
    24,
    6
  ],
  "dawn-ore-b": [
    32,
    -8
  ],
  "dawn-ore-c": [
    22,
    -25
  ],
  "dawn-pearl-a": [
    68,
    30
  ],
  "dawn-pearl-b": [
    72,
    18
  ],
  "dawn-pearl-c": [
    64,
    4
  ],
  "dawn-seal-a": [
    -18,
    -20
  ],
  "dawn-seal-b": [
    18,
    -35
  ],
  "dawn-seal-c": [
    -16,
    -44
  ],
  "dawn-visit-garden": [
    -54,
    40
  ],
  "dawn-visit-coast": [
    69,
    20
  ],
  "dawn-visit-watch": [
    62,
    68
  ]
};
