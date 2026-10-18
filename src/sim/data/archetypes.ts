import { motionData, type NumericArchetype } from './pose.ts';
import { canonicalRigId } from './rig-aliases.ts';
export function numericArchetype(id:string):NumericArchetype{const a=motionData.archetypes[canonicalRigId(id)];if(!a)throw new Error(`Unknown shipped archetype ${id}`);return a;}
