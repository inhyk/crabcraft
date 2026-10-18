import type {QuestDef} from './quests';
export type FrontierQuestId=`r${5|6}q${1|2|3|4|5|6|7|8|9|10|11|12}`;
export type FrontierObjectiveKind=`${'ember'|'sky'}-${'crate'|'herb'|'lamp'|'visit'|'ore'|'pearl'|'seal'}-${'a'|'b'|'c'}`|`${'ember'|'sky'}-letter`;
export const FRONTIER_QUESTS={
 "r5q1": {
  "id": "r5q1",
  "chapter": 5,
  "title": "Harbor Supplies of Emberreach",
  "giver": "brinebeard",
  "turnIn": "coralline",
  "offer": [
   "Find three supply crate objects on the marked trail."
  ],
  "progress": "Find three supply crate objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three supply crate objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q1-a",
    "kind": "ember-crate-a",
    "label": "Supply crate 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q1-b",
    "kind": "ember-crate-b",
    "label": "Supply crate 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q1-c",
    "kind": "ember-crate-c",
    "label": "Supply crate 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 66000
 },
 "r5q2": {
  "id": "r5q2",
  "chapter": 5,
  "title": "Flowers of Hope of Emberreach",
  "giver": "coralline",
  "turnIn": "coralline",
  "offer": [
   "Find three rare herb objects on the marked trail."
  ],
  "progress": "Find three rare herb objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three rare herb objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q2-a",
    "kind": "ember-herb-a",
    "label": "Rare herb 1",
    "count": 1,
    "poi": "grove"
   },
   {
    "id": "r5q2-b",
    "kind": "ember-herb-b",
    "label": "Rare herb 2",
    "count": 1,
    "poi": "grove"
   },
   {
    "id": "r5q2-c",
    "kind": "ember-herb-c",
    "label": "Rare herb 3",
    "count": 1,
    "poi": "grove"
   }
  ],
  "xp": 72000
 },
 "r5q3": {
  "id": "r5q3",
  "chapter": 5,
  "title": "A Light for Home of Emberreach",
  "giver": "rattlebolt",
  "turnIn": "rattlebolt",
  "offer": [
   "Hold F to light three lanterns on the northern road."
  ],
  "progress": "Hold F to light three lanterns on the northern road.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Hold F to light three lanterns on the northern road.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q3-a",
    "kind": "ember-lamp-a",
    "label": "Guide lantern 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q3-b",
    "kind": "ember-lamp-b",
    "label": "Guide lantern 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q3-c",
    "kind": "ember-lamp-c",
    "label": "Guide lantern 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 84000
 },
 "r5q4": {
  "id": "r5q4",
  "chapter": 5,
  "title": "Chart the Frontier of Emberreach",
  "giver": "silvermoon",
  "turnIn": "silvermoon",
  "offer": [
   "Visit the western woods, eastern overlook and northern sanctuary."
  ],
  "progress": "Visit the western woods, eastern overlook and northern sanctuary.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Visit the western woods, eastern overlook and northern sanctuary.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q4-a",
    "kind": "ember-visit-a",
    "label": "Landmark 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q4-b",
    "kind": "ember-visit-b",
    "label": "Landmark 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q4-c",
    "kind": "ember-visit-c",
    "label": "Landmark 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 90000
 },
 "r5q5": {
  "id": "r5q5",
  "chapter": 5,
  "title": "The Heart of the Forge of Emberreach",
  "giver": "pip",
  "turnIn": "pip",
  "offer": [
   "Find three upgrade ore objects on the marked trail."
  ],
  "progress": "Find three upgrade ore objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three upgrade ore objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q5-a",
    "kind": "ember-ore-a",
    "label": "Upgrade ore 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q5-b",
    "kind": "ember-ore-b",
    "label": "Upgrade ore 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q5-c",
    "kind": "ember-ore-c",
    "label": "Upgrade ore 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 105000
 },
 "r5q6": {
  "id": "r5q6",
  "chapter": 5,
  "title": "A Feast for Friends of Emberreach",
  "giver": "hoofclaw",
  "turnIn": "hoofclaw",
  "offer": [
   "Find three luminous fruit objects on the marked trail."
  ],
  "progress": "Find three luminous fruit objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three luminous fruit objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q6-a",
    "kind": "ember-pearl-a",
    "label": "Luminous fruit 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q6-b",
    "kind": "ember-pearl-b",
    "label": "Luminous fruit 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q6-c",
    "kind": "ember-pearl-c",
    "label": "Luminous fruit 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 96000
 },
 "r5q7": {
  "id": "r5q7",
  "chapter": 5,
  "title": "The Scout Report of Emberreach",
  "giver": "rattlebolt",
  "turnIn": "brinebeard",
  "offer": [
   "Take the scout report to Captain Brinebeard in the village."
  ],
  "progress": "Take the scout report to Captain Brinebeard in the village.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Take the scout report to Captain Brinebeard in the village.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q7-letter",
    "kind": "ember-letter",
    "label": "Deliver the report to the captain",
    "count": 1,
    "poi": "npc:brinebeard"
   }
  ],
  "xp": 78000
 },
 "r5q8": {
  "id": "r5q8",
  "chapter": 5,
  "title": "Defend the Harbor of Emberreach",
  "giver": "grukk",
  "turnIn": "grukk",
  "offer": [
   "Defeat 8 raider enemies outside the village, then return to report."
  ],
  "progress": "Defeat 8 raider enemies outside the village, then return to report.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Defeat 8 raider enemies outside the village, then return to report.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q8-kill",
    "kind": "kill-scrapling",
    "label": "Raider defeated",
    "count": 8,
    "poi": "wreck"
   }
  ],
  "xp": 120000
 },
 "r5q9": {
  "id": "r5q9",
  "chapter": 5,
  "title": "Restore Ancient Seals of Emberreach",
  "giver": "silvermoon",
  "turnIn": "silvermoon",
  "offer": [
   "Find three ancient seal objects on the marked trail."
  ],
  "progress": "Find three ancient seal objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three ancient seal objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q9-a",
    "kind": "ember-seal-a",
    "label": "Ancient seal 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q9-b",
    "kind": "ember-seal-b",
    "label": "Ancient seal 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r5q9-c",
    "kind": "ember-seal-c",
    "label": "Ancient seal 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 150000
 },
 "r5q10": {
  "id": "r5q10",
  "chapter": 5,
  "title": "Reclaim the Ruins of Emberreach",
  "giver": "grukk",
  "turnIn": "grukk",
  "offer": [
   "Defeat 10 ruin guardian enemies outside the village, then return to report."
  ],
  "progress": "Defeat 10 ruin guardian enemies outside the village, then return to report.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Defeat 10 ruin guardian enemies outside the village, then return to report.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q10-kill",
    "kind": "kill-scavenger",
    "label": "Ruin guardian defeated",
    "count": 10,
    "poi": "wreck"
   }
  ],
  "xp": 165000
 },
 "r5q11": {
  "id": "r5q11",
  "chapter": 5,
  "title": "Keep the Trails Safe of Emberreach",
  "giver": "brinebeard",
  "turnIn": "brinebeard",
  "offer": [
   "Defeat 12 raider enemies outside the village, then return to report."
  ],
  "progress": "Defeat 12 raider enemies outside the village, then return to report.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Defeat 12 raider enemies outside the village, then return to report.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q11-kill",
    "kind": "kill-scrapling",
    "label": "Raider defeated",
    "count": 12,
    "poi": "wreck"
   }
  ],
  "xp": 180000
 },
 "r5q12": {
  "id": "r5q12",
  "chapter": 5,
  "title": "The Final Patrol of Emberreach",
  "giver": "grukk",
  "turnIn": "grukk",
  "offer": [
   "Defeat 14 elite sentinel enemies outside the village, then return to report."
  ],
  "progress": "Defeat 14 elite sentinel enemies outside the village, then return to report.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Defeat 14 elite sentinel enemies outside the village, then return to report.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r5q12-kill",
    "kind": "kill-scavenger",
    "label": "Elite sentinel defeated",
    "count": 14,
    "poi": "wreck"
   }
  ],
  "xp": 225000
 },
 "r6q1": {
  "id": "r6q1",
  "chapter": 6,
  "title": "Harbor Supplies of Skybloom",
  "giver": "brinebeard",
  "turnIn": "coralline",
  "offer": [
   "Find three supply crate objects on the marked trail."
  ],
  "progress": "Find three supply crate objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three supply crate objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q1-a",
    "kind": "sky-crate-a",
    "label": "Supply crate 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q1-b",
    "kind": "sky-crate-b",
    "label": "Supply crate 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q1-c",
    "kind": "sky-crate-c",
    "label": "Supply crate 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 110000
 },
 "r6q2": {
  "id": "r6q2",
  "chapter": 6,
  "title": "Flowers of Hope of Skybloom",
  "giver": "coralline",
  "turnIn": "coralline",
  "offer": [
   "Find three rare herb objects on the marked trail."
  ],
  "progress": "Find three rare herb objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three rare herb objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q2-a",
    "kind": "sky-herb-a",
    "label": "Rare herb 1",
    "count": 1,
    "poi": "grove"
   },
   {
    "id": "r6q2-b",
    "kind": "sky-herb-b",
    "label": "Rare herb 2",
    "count": 1,
    "poi": "grove"
   },
   {
    "id": "r6q2-c",
    "kind": "sky-herb-c",
    "label": "Rare herb 3",
    "count": 1,
    "poi": "grove"
   }
  ],
  "xp": 120000
 },
 "r6q3": {
  "id": "r6q3",
  "chapter": 6,
  "title": "A Light for Home of Skybloom",
  "giver": "rattlebolt",
  "turnIn": "rattlebolt",
  "offer": [
   "Hold F to light three lanterns on the northern road."
  ],
  "progress": "Hold F to light three lanterns on the northern road.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Hold F to light three lanterns on the northern road.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q3-a",
    "kind": "sky-lamp-a",
    "label": "Guide lantern 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q3-b",
    "kind": "sky-lamp-b",
    "label": "Guide lantern 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q3-c",
    "kind": "sky-lamp-c",
    "label": "Guide lantern 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 140000
 },
 "r6q4": {
  "id": "r6q4",
  "chapter": 6,
  "title": "Chart the Frontier of Skybloom",
  "giver": "silvermoon",
  "turnIn": "silvermoon",
  "offer": [
   "Visit the western woods, eastern overlook and northern sanctuary."
  ],
  "progress": "Visit the western woods, eastern overlook and northern sanctuary.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Visit the western woods, eastern overlook and northern sanctuary.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q4-a",
    "kind": "sky-visit-a",
    "label": "Landmark 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q4-b",
    "kind": "sky-visit-b",
    "label": "Landmark 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q4-c",
    "kind": "sky-visit-c",
    "label": "Landmark 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 150000
 },
 "r6q5": {
  "id": "r6q5",
  "chapter": 6,
  "title": "The Heart of the Forge of Skybloom",
  "giver": "pip",
  "turnIn": "pip",
  "offer": [
   "Find three upgrade ore objects on the marked trail."
  ],
  "progress": "Find three upgrade ore objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three upgrade ore objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q5-a",
    "kind": "sky-ore-a",
    "label": "Upgrade ore 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q5-b",
    "kind": "sky-ore-b",
    "label": "Upgrade ore 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q5-c",
    "kind": "sky-ore-c",
    "label": "Upgrade ore 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 175000
 },
 "r6q6": {
  "id": "r6q6",
  "chapter": 6,
  "title": "A Feast for Friends of Skybloom",
  "giver": "hoofclaw",
  "turnIn": "hoofclaw",
  "offer": [
   "Find three luminous fruit objects on the marked trail."
  ],
  "progress": "Find three luminous fruit objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three luminous fruit objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q6-a",
    "kind": "sky-pearl-a",
    "label": "Luminous fruit 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q6-b",
    "kind": "sky-pearl-b",
    "label": "Luminous fruit 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q6-c",
    "kind": "sky-pearl-c",
    "label": "Luminous fruit 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 160000
 },
 "r6q7": {
  "id": "r6q7",
  "chapter": 6,
  "title": "The Scout Report of Skybloom",
  "giver": "rattlebolt",
  "turnIn": "brinebeard",
  "offer": [
   "Take the scout report to Captain Brinebeard in the village."
  ],
  "progress": "Take the scout report to Captain Brinebeard in the village.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Take the scout report to Captain Brinebeard in the village.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q7-letter",
    "kind": "sky-letter",
    "label": "Deliver the report to the captain",
    "count": 1,
    "poi": "npc:brinebeard"
   }
  ],
  "xp": 130000
 },
 "r6q8": {
  "id": "r6q8",
  "chapter": 6,
  "title": "Defend the Harbor of Skybloom",
  "giver": "grukk",
  "turnIn": "grukk",
  "offer": [
   "Defeat 8 raider enemies outside the village, then return to report."
  ],
  "progress": "Defeat 8 raider enemies outside the village, then return to report.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Defeat 8 raider enemies outside the village, then return to report.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q8-kill",
    "kind": "kill-scrapling",
    "label": "Raider defeated",
    "count": 8,
    "poi": "wreck"
   }
  ],
  "xp": 200000
 },
 "r6q9": {
  "id": "r6q9",
  "chapter": 6,
  "title": "Restore Ancient Seals of Skybloom",
  "giver": "silvermoon",
  "turnIn": "silvermoon",
  "offer": [
   "Find three ancient seal objects on the marked trail."
  ],
  "progress": "Find three ancient seal objects on the marked trail.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Find three ancient seal objects on the marked trail.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q9-a",
    "kind": "sky-seal-a",
    "label": "Ancient seal 1",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q9-b",
    "kind": "sky-seal-b",
    "label": "Ancient seal 2",
    "count": 1,
    "poi": "shore"
   },
   {
    "id": "r6q9-c",
    "kind": "sky-seal-c",
    "label": "Ancient seal 3",
    "count": 1,
    "poi": "shore"
   }
  ],
  "xp": 250000
 },
 "r6q10": {
  "id": "r6q10",
  "chapter": 6,
  "title": "Reclaim the Ruins of Skybloom",
  "giver": "grukk",
  "turnIn": "grukk",
  "offer": [
   "Defeat 10 ruin guardian enemies outside the village, then return to report."
  ],
  "progress": "Defeat 10 ruin guardian enemies outside the village, then return to report.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Defeat 10 ruin guardian enemies outside the village, then return to report.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q10-kill",
    "kind": "kill-scavenger",
    "label": "Ruin guardian defeated",
    "count": 10,
    "poi": "wreck"
   }
  ],
  "xp": 275000
 },
 "r6q11": {
  "id": "r6q11",
  "chapter": 6,
  "title": "Keep the Trails Safe of Skybloom",
  "giver": "brinebeard",
  "turnIn": "brinebeard",
  "offer": [
   "Defeat 12 raider enemies outside the village, then return to report."
  ],
  "progress": "Defeat 12 raider enemies outside the village, then return to report.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Defeat 12 raider enemies outside the village, then return to report.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q11-kill",
    "kind": "kill-scrapling",
    "label": "Raider defeated",
    "count": 12,
    "poi": "wreck"
   }
  ],
  "xp": 300000
 },
 "r6q12": {
  "id": "r6q12",
  "chapter": 6,
  "title": "The Final Patrol of Skybloom",
  "giver": "grukk",
  "turnIn": "grukk",
  "offer": [
   "Defeat 14 elite sentinel enemies outside the village, then return to report."
  ],
  "progress": "Defeat 14 elite sentinel enemies outside the village, then return to report.",
  "complete": [
   "The frontier is safer because of you. Our next adventure is waiting!"
  ],
  "summary": "Defeat 14 elite sentinel enemies outside the village, then return to report.",
  "readyHint": "Return to the marked villager for your reward.",
  "objectives": [
   {
    "id": "r6q12-kill",
    "kind": "kill-scavenger",
    "label": "Elite sentinel defeated",
    "count": 14,
    "poi": "wreck"
   }
  ],
  "xp": 375000
 }
} satisfies Record<FrontierQuestId,QuestDef>;
export const FRONTIER_KOREAN={
 "r5q1": {
  "title": "잿불 항구의 보급대",
  "offer": [
   "지도의 안내를 따라 보급 상자 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 보급 상자 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "보급 상자 1",
   "보급 상자 2",
   "보급 상자 3"
  ]
 },
 "r5q2": {
  "title": "재 속에 피는 불꽃풀",
  "offer": [
   "지도의 안내를 따라 희귀 약초 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 희귀 약초 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "희귀 약초 1",
   "희귀 약초 2",
   "희귀 약초 3"
  ]
 },
 "r5q3": {
  "title": "식지 않는 귀갓길",
  "offer": [
   "북쪽 길의 등불 세 곳에서 F를 길게 눌러 불을 밝혀 주세요."
  ],
  "progress": "북쪽 길의 등불 세 곳에서 F를 길게 눌러 불을 밝혀 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "길잡이 등불 1",
   "길잡이 등불 2",
   "길잡이 등불 3"
  ]
 },
 "r5q4": {
  "title": "용암 군도 탐사",
  "offer": [
   "서쪽 숲 쉼터, 동쪽 전망대, 북쪽 성역을 방문해 주세요."
  ],
  "progress": "서쪽 숲 쉼터, 동쪽 전망대, 북쪽 성역을 방문해 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "탐험 지점 1",
   "탐험 지점 2",
   "탐험 지점 3"
  ]
 },
 "r5q5": {
  "title": "검은 대장간의 심장",
  "offer": [
   "지도의 안내를 따라 강화 광석 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 강화 광석 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "강화 광석 1",
   "강화 광석 2",
   "강화 광석 3"
  ]
 },
 "r5q6": {
  "title": "불꽃 열매 만찬",
  "offer": [
   "지도의 안내를 따라 빛나는 열매 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 빛나는 열매 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "빛나는 열매 1",
   "빛나는 열매 2",
   "빛나는 열매 3"
  ]
 },
 "r5q7": {
  "title": "연기 너머의 소식",
  "offer": [
   "마을의 브라인비어드 선장에게 정찰 보고서를 전해 주세요."
  ],
  "progress": "마을의 브라인비어드 선장에게 정찰 보고서를 전해 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "선장에게 보고서 전달"
  ]
 },
 "r5q8": {
  "title": "항구를 지켜라",
  "offer": [
   "마을 바깥의 약탈자 8마리를 처치하고 돌아와 주세요."
  ],
  "progress": "마을 바깥의 약탈자 8마리를 처치하고 돌아와 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "약탈자 처치"
  ]
 },
 "r5q9": {
  "title": "불의 봉인 복구",
  "offer": [
   "지도의 안내를 따라 고대 봉인 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 고대 봉인 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "고대 봉인 1",
   "고대 봉인 2",
   "고대 봉인 3"
  ]
 },
 "r5q10": {
  "title": "흑요석 유적 정화",
  "offer": [
   "마을 바깥의 유적 수호자 10마리를 처치하고 돌아와 주세요."
  ],
  "progress": "마을 바깥의 유적 수호자 10마리를 처치하고 돌아와 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "유적 수호자 처치"
  ]
 },
 "r5q11": {
  "title": "잿바람 길의 호위",
  "offer": [
   "마을 바깥의 약탈자 12마리를 처치하고 돌아와 주세요."
  ],
  "progress": "마을 바깥의 약탈자 12마리를 처치하고 돌아와 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "약탈자 처치"
  ]
 },
 "r5q12": {
  "title": "화산 원정의 마지막 순찰",
  "offer": [
   "마을 바깥의 정예 파수병 14마리를 처치하고 돌아와 주세요."
  ],
  "progress": "마을 바깥의 정예 파수병 14마리를 처치하고 돌아와 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "정예 파수병 처치"
  ]
 },
 "r6q1": {
  "title": "하늘 항구의 선물",
  "offer": [
   "지도의 안내를 따라 보급 상자 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 보급 상자 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "보급 상자 1",
   "보급 상자 2",
   "보급 상자 3"
  ]
 },
 "r6q2": {
  "title": "생명의 잎사귀",
  "offer": [
   "지도의 안내를 따라 희귀 약초 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 희귀 약초 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "희귀 약초 1",
   "희귀 약초 2",
   "희귀 약초 3"
  ]
 },
 "r6q3": {
  "title": "별을 잇는 등불",
  "offer": [
   "북쪽 길의 등불 세 곳에서 F를 길게 눌러 불을 밝혀 주세요."
  ],
  "progress": "북쪽 길의 등불 세 곳에서 F를 길게 눌러 불을 밝혀 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "길잡이 등불 1",
   "길잡이 등불 2",
   "길잡이 등불 3"
  ]
 },
 "r6q4": {
  "title": "구름 위의 탐험가",
  "offer": [
   "서쪽 숲 쉼터, 동쪽 전망대, 북쪽 성역을 방문해 주세요."
  ],
  "progress": "서쪽 숲 쉼터, 동쪽 전망대, 북쪽 성역을 방문해 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "탐험 지점 1",
   "탐험 지점 2",
   "탐험 지점 3"
  ]
 },
 "r6q5": {
  "title": "하늘빛 수정 대장간",
  "offer": [
   "지도의 안내를 따라 강화 광석 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 강화 광석 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "강화 광석 1",
   "강화 광석 2",
   "강화 광석 3"
  ]
 },
 "r6q6": {
  "title": "숲의 만찬",
  "offer": [
   "지도의 안내를 따라 빛나는 열매 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 빛나는 열매 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "빛나는 열매 1",
   "빛나는 열매 2",
   "빛나는 열매 3"
  ]
 },
 "r6q7": {
  "title": "바람에 실린 편지",
  "offer": [
   "마을의 브라인비어드 선장에게 정찰 보고서를 전해 주세요."
  ],
  "progress": "마을의 브라인비어드 선장에게 정찰 보고서를 전해 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "선장에게 보고서 전달"
  ]
 },
 "r6q8": {
  "title": "뿌리 마을 방위전",
  "offer": [
   "마을 바깥의 약탈자 8마리를 처치하고 돌아와 주세요."
  ],
  "progress": "마을 바깥의 약탈자 8마리를 처치하고 돌아와 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "약탈자 처치"
  ]
 },
 "r6q9": {
  "title": "세계수의 기억",
  "offer": [
   "지도의 안내를 따라 고대 봉인 세 개를 모아 주세요."
  ],
  "progress": "지도의 안내를 따라 고대 봉인 세 개를 모아 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "고대 봉인 1",
   "고대 봉인 2",
   "고대 봉인 3"
  ]
 },
 "r6q10": {
  "title": "빛의 유적 되찾기",
  "offer": [
   "마을 바깥의 유적 수호자 10마리를 처치하고 돌아와 주세요."
  ],
  "progress": "마을 바깥의 유적 수호자 10마리를 처치하고 돌아와 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "유적 수호자 처치"
  ]
 },
 "r6q11": {
  "title": "숲길의 평화",
  "offer": [
   "마을 바깥의 약탈자 12마리를 처치하고 돌아와 주세요."
  ],
  "progress": "마을 바깥의 약탈자 12마리를 처치하고 돌아와 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "약탈자 처치"
  ]
 },
 "r6q12": {
  "title": "하늘숲 원정대",
  "offer": [
   "마을 바깥의 정예 파수병 14마리를 처치하고 돌아와 주세요."
  ],
  "progress": "마을 바깥의 정예 파수병 14마리를 처치하고 돌아와 주세요.",
  "complete": [
   "덕분에 새로운 보금자리가 더 안전해졌어요. 다음 모험도 함께해요!"
  ],
  "readyHint": "지도의 표시를 따라 주민에게 돌아가 보상을 받으세요.",
  "labels": [
   "정예 파수병 처치"
  ]
 }
};
export const FRONTIER_POINTS={"5": {"ember-crate-a": [-12, 78], "ember-crate-b": [12, 72], "ember-crate-c": [-12, 56], "ember-herb-a": [-47, 40], "ember-herb-b": [-52, 28], "ember-herb-c": [-44, 14], "ember-lamp-a": [-7, 26], "ember-lamp-b": [7, 4], "ember-lamp-c": [-7, -22], "ember-visit-a": [-50, 26], "ember-visit-b": [61, 22], "ember-visit-c": [0, -34], "ember-ore-a": [36, 8], "ember-ore-b": [44, -6], "ember-ore-c": [34, -22], "ember-pearl-a": [62, 34], "ember-pearl-b": [68, 20], "ember-pearl-c": [60, 4], "ember-seal-a": [-17, -34], "ember-seal-b": [17, -42], "ember-seal-c": [-16, -54]}, "6": {"sky-crate-a": [-12, 78], "sky-crate-b": [12, 72], "sky-crate-c": [-12, 56], "sky-herb-a": [-47, 40], "sky-herb-b": [-52, 28], "sky-herb-c": [-44, 14], "sky-lamp-a": [-7, 26], "sky-lamp-b": [7, 4], "sky-lamp-c": [-7, -22], "sky-visit-a": [-50, 26], "sky-visit-b": [61, 22], "sky-visit-c": [0, -34], "sky-ore-a": [36, 8], "sky-ore-b": [44, -6], "sky-ore-c": [34, -22], "sky-pearl-a": [62, 34], "sky-pearl-b": [68, 20], "sky-pearl-c": [60, 4], "sky-seal-a": [-17, -34], "sky-seal-b": [17, -42], "sky-seal-c": [-16, -54]}} as const;
