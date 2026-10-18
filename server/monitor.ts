import type { Spec, State } from './protocol.ts';

/** Read-only presence. Never includes account ids, sessions, chat, or saved progress. */
export type MonitorPlayer = {
  id: string;
  room: string;
  public: boolean;
  area: number | null;
  spec: Spec;
  state: State | null;
  updatedAt: number | null;
  action: { name: string; seq: number; at: number } | null;
};
export type MonitorSnapshot = { at: number; players: MonitorPlayer[] };
