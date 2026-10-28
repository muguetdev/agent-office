// What the elevator's "add a project" list does with a repository (see elevator.ts), as plain logic:
// every repository is listed, the ones already on a floor too (a project's floor, or a server's floor
// that has it linked), and picking one of those offers to go to that floor instead of adding a second.
import type { FloorInfo, RepoChoice } from '../../shared/protocol';
import { normalizeRepo, sameRepo } from '../../shared/floors';

/** The floor a repository is on already, if it's on one. */
export const floorOfRepo = <F extends Pick<FloorInfo, 'repo'>>(floors: readonly F[], repo: string | undefined): F | undefined =>
  repo ? floors.find((f) => sameRepo(f.repo, repo)) : undefined;

/** The repositories whose name or description has what's typed in it, none left out. */
export function matchRepos(list: readonly RepoChoice[], filter: string): RepoChoice[] {
  const q = filter.trim().toLowerCase();
  return list.filter((x) => !q || x.name.toLowerCase().includes(q) || (x.description ?? '').toLowerCase().includes(q));
}

/** What Enter picks: the row picked, else owner/name typed, else the only repository that matches. */
export function enterPick(list: readonly RepoChoice[], filter: string, selected: string | null): string | undefined {
  const picked = selected ?? normalizeRepo(filter);
  if (picked) return picked;
  const matches = filter.trim() ? matchRepos(list, filter) : [];
  return matches.length === 1 ? matches[0].name : undefined;
}

/** What the button does with the repository picked: add it as a floor, go to the floor it's on, or nothing. */
export type RepoAction<F> = { kind: 'none' } | { kind: 'add'; repo: string } | { kind: 'go'; repo: string; floor: F; can: boolean };

/**
 * `here` is the floor you're on (null in the garage or with none): going there is nothing to do. A
 * floor still cloning or locked to you can't be gone to yet, but it's still not added twice.
 */
export function repoAction<F extends Pick<FloorInfo, 'id' | 'repo' | 'cloning' | 'locked'>>(floors: readonly F[], pick: string | undefined, here: string | null): RepoAction<F> {
  if (!pick) return { kind: 'none' };
  const floor = floorOfRepo(floors, pick);
  if (!floor) return { kind: 'add', repo: pick };
  return { kind: 'go', repo: pick, floor, can: !floor.cloning && !floor.locked && floor.id !== here };
}
