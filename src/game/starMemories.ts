import {t} from '../i18n';
import type {ObjectiveKind} from './quests';

const memories:Partial<Record<ObjectiveKind,[string,string,string,string]>>={
  'explore-west':['수정에 남은 노래','A Song in the Crystals','수정 속 작은 빛들이 바다 건너 등불처럼 반짝입니다. 이 섬도 돌아올 친구를 기다리고 있었어요.','Tiny lights glitter inside the crystals like lanterns across the sea. This island was waiting for a friend to return.'],
  'explore-east':['별을 잇던 관측소','The Observatory Between Worlds','낡은 천체 관측기가 다시 움직입니다. 한때 이곳의 별들은 서로 다른 세계를 잇는 길을 알려 주었습니다.','The ancient instrument turns again. These stars once guided travellers along paths between worlds.'],
  'explore-north':['돌에 새긴 약속','A Promise Carved in Stone','성소에 남은 문양이 빛납니다. “어둠이 찾아와도, 세 왕관의 빛과 친구들의 마음은 길을 잊지 않으리라.”','The sanctuary inscription glows: “When darkness falls, the three crowns and the hearts of friends will remember the way.”'],
};

export function starMemory(kind:ObjectiveKind){
  const memory=memories[kind];
  return memory?{title:t(memory[0],memory[1]),body:t(memory[2],memory[3])}:null;
}
