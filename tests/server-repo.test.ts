// A server's floor's linked repository (server/server-repo.ts): its code cloned into a folder of the
// floor's own, the note that tells the floor's agents where it is, and the elevator's list, which
// shows a repository that's on a floor already and goes there instead of adding it twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareServer, repoFolder, writeAgentNote } from '../src/server/servers.js';
import { ensureServerRepo, repoDir, serverCheckout } from '../src/server/server-repo.js';
import { enterPick, matchRepos, repoAction } from '../src/client/ui/repo-pick.js';
import type { FloorInfo, RepoChoice } from '../src/shared/protocol.js';

// A stand-in for gh: `repo view` and `repo clone` from bare repositories in $FAKE_GH_REPOS, counting
// its clones in $FAKE_GH_CLONES, or failing every call with $FAKE_GH_FAIL.
const FAKE_GH = `#!/bin/sh
[ -n "$FAKE_GH_FAIL" ] && { echo "$FAKE_GH_FAIL" >&2; exit 1; }
case "$1 $2" in
  "repo view")
    [ -d "$FAKE_GH_REPOS/$3.git" ] || { echo "GraphQL: Could not resolve to a Repository with the name '$3'." >&2; exit 1; }
    echo "{\\"nameWithOwner\\":\\"$3\\",\\"isEmpty\\":false}"
    ;;
  "repo clone")
    echo clone >> "$FAKE_GH_CLONES"
    printf "Cloning into '%s'...\\n" "$4" >&2
    git clone -q "$FAKE_GH_REPOS/$3.git" "$4" || exit 1
    git -C "$4" remote set-url origin "https://github.com/$3.git"
    ;;
esac
`;

const TARGET = { host: '203.0.113.7', user: 'deploy', port: 22 };
const fast = { fetch: false, clone: { tickMs: 50, stallMs: 5000 } };

function office(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-server-repo-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'gh'), FAKE_GH);
  chmodSync(path.join(bin, 'gh'), 0o755);
  // muguetdev/crivo on "GitHub", with a commit and docs/briefing.md.
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  mkdirSync(path.join(work, 'docs'));
  writeFileSync(path.join(work, 'docs', 'briefing.md'), '# Briefing\n');
  execFileSync('git', ['-C', work, 'add', '.']);
  execFileSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first']);
  const repos = path.join(root, 'github');
  execFileSync('git', ['clone', '-q', '--bare', work, path.join(repos, 'muguetdev', 'crivo.git')]);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  process.env.FAKE_GH_REPOS = repos;
  process.env.FAKE_GH_CLONES = path.join(root, 'clones.log');
  delete process.env.FAKE_GH_FAIL;
  // The server's floor, as the office makes it: its folder, its note, its .agent-office.
  const dir = path.join(root, 'projects', 'servers', 'prod');
  prepareServer(path.join(root, 'data'), 'prod', TARGET, dir, path.join(dir, '.agent-office', 'bin'), 'muguetdev/crivo');
  const clones = () => (existsSync(process.env.FAKE_GH_CLONES!) ? readFileSync(process.env.FAKE_GH_CLONES!, 'utf8').split('\n').filter(Boolean).length : 0);
  return { root, dir, def: { dir, repo: 'muguetdev/crivo', ssh: TARGET }, clones };
}

test("the floor's note says where the project's code is when it has a repository, and is as it was without one", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-server-note-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'prod');
  prepareServer(path.join(root, 'data'), 'prod', TARGET, folder, path.join(folder, '.agent-office', 'bin'));
  const plain = readFileSync(path.join(folder, 'AGENTS.md'), 'utf8');
  assert.match(plain, /`ssh prod`/);
  assert.doesNotMatch(plain, /project's code|cloned/);
  assert.match(plain, /don't restart services or reboot it without being asked\./);
  // Builds go on the server, never on the office's shared machine.
  assert.match(plain, /don't compile,\ninstall toolchains or packages/);
  assert.match(plain, /rsync -az --exclude \.git \.\/<dir>\/ prod:build\/<dir>\//);
  assert.ok(plain.endsWith('Read, edit, commit and push here; build and test there.\n'));

  writeAgentNote(folder, 'prod', TARGET, 'muguetdev/crivo');
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const note = readFileSync(path.join(folder, file), 'utf8');
    assert.ok(note.startsWith(plain), 'the server part stays the same');
    assert.match(note, /The code of muguetdev\/crivo, the project this server runs, is cloned at `\.\/crivo` in this folder/);
    assert.match(note, /commit and push there: git and gh work as usual/);
    assert.match(note, /reached with `ssh prod`/);
    assert.match(note, /deploy docs/);
    assert.match(note, /Never edit the code directly on the server unless you're asked to/);
  }
  // Unlinked: back to the server alone.
  writeAgentNote(folder, 'prod', TARGET, undefined);
  assert.equal(readFileSync(path.join(folder, 'CLAUDE.md'), 'utf8'), plain);
});

test("the repository goes in a folder named after it, never over the office's own files", () => {
  assert.equal(repoFolder('muguetdev/crivo'), 'crivo');
  assert.equal(repoFolder('acme/.agent-office'), '.agent-office-code');
  assert.equal(repoFolder('acme/AGENTS.md'), 'AGENTS.md-code');
  assert.equal(repoDir({ dir: '/p/servers/prod', repo: 'muguetdev/crivo', ssh: TARGET }), path.join('/p/servers/prod', 'crivo'));
  // Only a server's floor with a repository has one.
  assert.equal(repoDir({ dir: '/p/servers/prod', ssh: TARGET }), undefined);
  assert.equal(repoDir({ dir: '/p/acme/web', repo: 'acme/web' }), undefined);
});

test("linking a repository clones it into the floor's folder; a clone that's there already isn't cloned again", async (t) => {
  const { dir, def, clones } = office(t);
  assert.equal(serverCheckout(def), undefined, 'nothing to diff before the clone');

  let started = 0;
  // Asked twice at once (linked twice), it's one clone.
  const a = ensureServerRepo(def, { ...fast, started: () => started++ });
  const b = ensureServerRepo(def, fast);
  assert.equal(a, b);
  const r = await a;
  assert.deepEqual(r, { ok: true, cloned: true, dir: path.join(dir, 'crivo') });
  assert.equal(started, 1);
  assert.equal(clones(), 1);
  assert.equal(readFileSync(path.join(dir, 'crivo', 'docs', 'briefing.md'), 'utf8'), '# Briefing\n');
  // The floor's own files stay where they were, outside the clone.
  assert.match(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /`\.\/crivo`/);
  assert.ok(existsSync(path.join(dir, '.agent-office')));
  assert.ok(!existsSync(path.join(dir, '.agent-office', 'repo-clone.json')), 'nothing left to pick up after a restart');
  assert.ok(!existsSync(path.join(dir, '.agent-office', 'repo-clone.log')));
  // The Changes window and the Code tab work on the clone, against its default branch.
  assert.deepEqual(serverCheckout(def), { cwd: path.join(dir, 'crivo'), rel: 'crivo', baseBranch: 'main' });

  // The office starting again: it's there, so nothing's cloned (and GitHub isn't even asked).
  process.env.FAKE_GH_FAIL = 'gh should not run';
  let again = 0;
  assert.deepEqual(await ensureServerRepo(def, { ...fast, started: () => again++ }), { ok: true, cloned: false, dir: path.join(dir, 'crivo') });
  assert.equal(again, 0);
  assert.equal(clones(), 1);
});

test('something else in the way, or a repository GitHub says nothing about, is said and left alone', async (t) => {
  const { dir, def, clones } = office(t);
  mkdirSync(path.join(dir, 'crivo'));
  writeFileSync(path.join(dir, 'crivo', 'notes.txt'), 'mine');
  const r = await ensureServerRepo(def, fast);
  assert.equal(r?.ok, false);
  assert.match((r as { error: string }).error, /isn't a checkout of muguetdev\/crivo/);
  assert.equal(readFileSync(path.join(dir, 'crivo', 'notes.txt'), 'utf8'), 'mine');
  assert.equal(clones(), 0);

  const gone = await ensureServerRepo({ ...def, repo: 'muguetdev/nope' }, fast);
  assert.equal(gone?.ok, false);
  assert.ok(!existsSync(path.join(dir, 'nope')));
  // A project's floor (not a server's) has nothing to clone here.
  assert.equal(ensureServerRepo({ dir, repo: 'muguetdev/crivo' }, fast), undefined);
});

test("the elevator's list keeps a repository that's on a floor already, and picking it goes there", () => {
  const floor = (id: string, extra: Partial<FloorInfo> = {}) => ({ id, name: id, waiting: 0, people: 0, palette: 0, ...extra }) as FloorInfo;
  const floors = [floor('web', { repo: 'acme/web' }), floor('prod', { repo: 'muguetdev/crivo', ssh: TARGET }), floor('new', { repo: 'acme/new', cloning: true })];
  const list: RepoChoice[] = [
    { name: 'muguetdev/crivo', private: true, description: 'the shop' },
    { name: 'acme/web', private: false },
    { name: 'acme/api', private: false },
  ];
  // Nothing is hidden for being on a floor.
  assert.deepEqual(matchRepos(list, 'crivo').map((r) => r.name), ['muguetdev/crivo']);
  assert.deepEqual(matchRepos(list, '').map((r) => r.name), ['muguetdev/crivo', 'acme/web', 'acme/api']);
  assert.deepEqual(matchRepos(list, 'shop').map((r) => r.name), ['muguetdev/crivo']);

  // The server's floor's repository: go to that floor, never a second floor for it.
  const go = repoAction(floors, 'MuguetDev/Crivo', 'web');
  assert.equal(go.kind, 'go');
  assert.equal(go.kind === 'go' && go.floor.id, 'prod');
  assert.equal(go.kind === 'go' && go.can, true);
  // Already there, or a floor still cloning: nowhere to go, and still nothing to add.
  assert.deepEqual(repoAction(floors, 'muguetdev/crivo', 'prod'), { kind: 'go', repo: 'muguetdev/crivo', floor: floors[1], can: false });
  assert.equal((repoAction(floors, 'acme/new', 'web') as { can: boolean }).can, false);
  // In the garage (no floor you're "on" for this), your own floor's repository takes you up there.
  assert.equal((repoAction(floors, 'acme/web', null) as { can: boolean }).can, true);
  assert.deepEqual(repoAction(floors, 'acme/api', 'web'), { kind: 'add', repo: 'acme/api' });
  assert.deepEqual(repoAction(floors, undefined, 'web'), { kind: 'none' });

  // Enter: the row picked, else owner/name typed, else the only match, linked ones included.
  assert.equal(enterPick(list, 'crivo', null), 'muguetdev/crivo');
  assert.equal(enterPick(list, 'acme', null), undefined);
  assert.equal(enterPick(list, 'acme/api', null), 'acme/api');
  assert.equal(enterPick(list, 'whatever', 'acme/web'), 'acme/web');
  assert.equal(enterPick(list, '', null), undefined);
});
