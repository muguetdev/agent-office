// Who works on each floor, in brief, for everyone in the building (FloorInfo.crew): enough to see from
// another floor how its workers are getting on, and who's waiting on someone, without the floor itself.

import type { WorkerInfo, WorkerKind, WorkerStatus } from './protocol.js';

/** A worker on another floor, as the building panel and the needs-you strip show it. */
export interface CrewMember {
  id: string;
  name: string;
  color: string;
  kind: WorkerKind;
  status: WorkerStatus;
  /** What it's on, or what it's asking (clipped). */
  activity?: string;
  /** When it stopped to ask, if it's waiting on an answer. */
  waitingSince?: number;
  /** Done, and somebody's looked. */
  acked?: boolean;
}

/** The longest an activity line goes out as. */
const ACTIVITY_MAX = 140;

/** A floor's workers in brief, the agents only (a shell has nothing to say about how it's getting on). */
export function crewOf(workers: readonly WorkerInfo[]): CrewMember[] {
  return workers
    .filter((w) => w.kind === 'agent')
    .map((w) => {
      const said = w.activity ?? w.task?.summary;
      return {
        id: w.id,
        name: w.name,
        color: w.color,
        kind: w.kind,
        status: w.status,
        ...(said ? { activity: said.length > ACTIVITY_MAX ? `${said.slice(0, ACTIVITY_MAX - 1)}…` : said } : {}),
        ...(w.waitingSince ? { waitingSince: w.waitingSince } : {}),
        ...(w.acked ? { acked: true } : {}),
      };
    });
}
