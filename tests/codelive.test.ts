// The live Code tab's office side (server/codelive/): watching a worker's folder only for people who
// may see it, what's left out, bursts gathered into one event, the file an agent is editing, the
// review's accept and reject (checked against what the person saw, and only inside the folder), and
// the prompt Ctrl+K sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FolderWatcher, ignoredPath } from '../src/server/codelive/watch.js';
import { CodeLive, MAX_WATCHED, type Viewer } from '../src/server/codelive/hub.js';
import { editedPath } from '../src/server/codelive/edits.js';
import { CodeReview, hashOf } from '../src/server/codelive/review.js';
import { askPrompt } from '../src/server/codelive/ask.js';
import { codeLive, gitIgnored } from '../src/server/codelive/index.js';
import { CodeFiles } from '../src/server/code.js';
import { acceptHunk, diffTexts, rejectHunk } from '../src/shared/linediff.js';
import type { CodeChange, CodeServerMsg } from '../src/shared/protocol.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until `fn` is true, or fails after a few seconds. */
async function until(fn: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await wait(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

function folder() {
  const dir = mkdtempSync(path.join(tmpdir(), 'codelive-'));
  mkdirSync(path.join(dir, 'src'));
  mkdirSync(path.join(dir, 'node_modules/pkg'), { recursive: true });
  mkdirSync(path.join(dir, '.agent-office'));
  writeFileSync(path.join(dir, 'src/app.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(dir, '.gitignore'), 'secret.env\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'start'], { cwd: dir });
  return dir;
}

test('the ignore list: dependencies, build output, git’s and the office’s folders, editor droppings', () => {
  for (const p of ['node_modules/x/index.js', '.git/HEAD', '.agent-office/workers.json', 'dist/app.js', 'pkg/build/out.o', 'src/.app.ts.swp', 'src/app.ts~', 'src/.upload-ab12'])
    assert.equal(ignoredPath(p), true, p);
  for (const p of ['src/app.ts', 'README.md', 'docs/build.md', '.gitignore']) assert.equal(ignoredPath(p), false, p);
});

for (const perDir of [false, true]) {
  test(`a folder's changes come as one event per burst, with added, changed and removed, ignored folders left out (${perDir ? 'folder by folder' : 'recursive'})`, async () => {
    const dir = folder();
    const events: CodeChange[][] = [];
    const w = new FolderWatcher(dir, ['src/app.ts', '.gitignore'], (c) => events.push(c), { debounceMs: 120, perDir, gitIgnored: (p) => gitIgnored(dir, p) });
    await w.start();
    await wait(100);
    // A burst: three writes to one file and a new file, then noise in the ignored folders.
    for (let i = 0; i < 3; i++) writeFileSync(path.join(dir, 'src/app.ts'), `export const a = ${i};\n`);
    writeFileSync(path.join(dir, 'src/new.ts'), 'new\n');
    writeFileSync(path.join(dir, 'node_modules/pkg/index.js'), 'x');
    writeFileSync(path.join(dir, '.agent-office/state.json'), '{}');
    writeFileSync(path.join(dir, 'secret.env'), 'TOKEN=1');
    await until(() => events.length > 0, 'the first event');
    await wait(300);
    assert.equal(events.length, 1, JSON.stringify(events));
    const got = Object.fromEntries(events[0].map((c) => [c.path, c.kind]));
    assert.deepEqual(got, { 'src/app.ts': 'changed', 'src/new.ts': 'added' });
    // A new folder with a file in it, then a file taken away.
    mkdirSync(path.join(dir, 'lib'));
    writeFileSync(path.join(dir, 'lib/util.ts'), 'u\n');
    await until(() => events.length > 1, 'the new folder');
    await wait(250);
    assert.ok(events.slice(1).flat().some((c) => c.path === 'lib/util.ts' && c.kind === 'added'), JSON.stringify(events));
    const before = events.length;
    rmSync(path.join(dir, 'src/new.ts'));
    await until(() => events.length > before, 'the removal');
    assert.deepEqual(events[events.length - 1], [{ path: 'src/new.ts', kind: 'removed' }]);
    // Renamed: the old name goes, the new one comes.
    const n = events.length;
    renameSync(path.join(dir, 'src/app.ts'), path.join(dir, 'src/main.ts'));
    await until(() => events.slice(n).flat().length >= 2, 'the rename');
    const kinds = Object.fromEntries(events.slice(n).flat().map((c) => [c.path, c.kind]));
    assert.deepEqual(kinds, { 'src/app.ts': 'removed', 'src/main.ts': 'added' });
    w.close();
  });
}

test('folder by folder, it watches no more folders than its cap, and none of the ignored ones', async () => {
  const dir = folder();
  for (let i = 0; i < 10; i++) mkdirSync(path.join(dir, `d${i}`));
  const w = new FolderWatcher(dir, [], () => undefined, { perDir: true, maxDirs: 5 });
  await w.start();
  assert.equal(w.size, 5);
  w.close();
  const all = new FolderWatcher(dir, [], () => undefined, { perDir: true });
  await all.start();
  // The top, src and d0–d9: not node_modules, node_modules/pkg, .git or .agent-office.
  assert.equal(all.size, 12);
  all.close();
});

interface V extends Viewer {
  inbox: CodeServerMsg[];
  ok: boolean;
}
const viewer = (id: string): V => ({ id, inbox: [], ok: true });

function hub(dir: string) {
  return new CodeLive<V>({
    dirOf: (id) => (id === 'w1' ? dir : id.startsWith('w') ? dir : undefined),
    files: async () => ['src/app.ts'],
    allowed: (v) => v.ok,
    send: (v, msg) => v.inbox.push(msg),
    watch: { debounceMs: 60 },
  });
}

test('only people allowed on the floor are told, and the folder is watched only while someone has its Code tab open', async () => {
  const dir = folder();
  const live = hub(dir);
  const ann = viewer('ann');
  const bob = viewer('bob');
  const eve = viewer('eve');
  eve.ok = false;
  assert.equal(await live.watch(ann, 'w1'), undefined);
  assert.equal(await live.watch(bob, 'w1'), undefined);
  assert.equal(await live.watch(eve, 'w1'), 'no such worker');
  assert.equal(await live.watch(ann, 'nobody'), 'no such worker');
  assert.deepEqual(live.viewers('w1').sort(), ['ann', 'bob']);
  await wait(80);
  writeFileSync(path.join(dir, 'src/app.ts'), 'changed\n');
  await until(() => ann.inbox.length > 0 && bob.inbox.length > 0, 'both told');
  assert.deepEqual(ann.inbox[0], { t: 'code.changed', workerId: 'w1', changes: [{ path: 'src/app.ts', kind: 'changed' }] });
  assert.equal(eve.inbox.length, 0);
  // Bob's taken off the floor: the next change doesn't reach him, and he's dropped.
  bob.ok = false;
  writeFileSync(path.join(dir, 'src/app.ts'), 'again\n');
  await until(() => ann.inbox.length > 1, 'the second change');
  assert.equal(bob.inbox.length, 1);
  assert.deepEqual(live.viewers('w1'), ['ann']);
  live.unwatchAll('ann');
  assert.equal(live.size, 0);
});

test('there is a cap on how many folders are watched at once', async () => {
  const dir = folder();
  const live = hub(dir);
  for (let i = 0; i < MAX_WATCHED; i++) assert.equal(await live.watch(viewer(`p${i}`), `w${i}`), undefined);
  assert.equal(await live.watch(viewer('late'), 'wlate'), 'too many');
  // Another person on a folder already watched is fine.
  assert.equal(await live.watch(viewer('more'), 'w0'), undefined);
  live.close();
  assert.equal(live.size, 0);
});

test('the file an agent is editing, from its hook, only inside its folder', async () => {
  const dir = folder();
  assert.deepEqual(editedPath({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/app.ts') } }, dir), { path: 'src/app.ts', tool: 'Edit' });
  assert.deepEqual(editedPath({ tool_name: 'Write', tool_input: { file_path: 'docs/a.md' } }, dir), { path: 'docs/a.md', tool: 'Write' });
  for (const bad of [
    { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'src/app.ts') } },
    { tool_name: 'Edit', tool_input: { file_path: '/etc/passwd' } },
    { tool_name: 'Edit', tool_input: { file_path: '../outside.ts' } },
    { tool_name: 'Edit', tool_input: { file_path: '.git/config' } },
    { tool_name: 'Edit', tool_input: {} },
    null,
  ])
    assert.equal(editedPath(bad, dir), undefined, JSON.stringify(bad));
  const live = hub(dir);
  const ann = viewer('ann');
  await live.watch(ann, 'w1');
  live.hook('w1', 'PreToolUse', { tool_name: 'MultiEdit', tool_input: { file_path: path.join(dir, 'src/app.ts') } });
  const sent = ann.inbox.find((m) => m.t === 'code.editing');
  assert.ok(sent && sent.t === 'code.editing' && sent.editing?.path === 'src/app.ts' && sent.editing.tool === 'MultiEdit');
  // Someone opening the tab later is told straight away.
  const bob = viewer('bob');
  await live.watch(bob, 'w1');
  assert.equal(bob.inbox[0]?.t, 'code.editing');
  live.hook('w1', 'Stop', {});
  assert.deepEqual(ann.inbox[ann.inbox.length - 1], { t: 'code.editing', workerId: 'w1' });
  live.close();
});

test('the office-wide hub only tells connections still in the office, not guests, and on floors they may go to', async () => {
  const dir = folder();
  const floor = { id: 'f1', code: new CodeFiles((id) => (id === 'w1' ? dir : undefined)) };
  const accounts = new Map([
    ['member', { role: 'member', floors: ['f1'] }],
    ['stranger', { role: 'member', floors: ['f2'] }],
  ]);
  const clients = new Map<string, Client>();
  const sent: [string, CodeServerMsg][] = [];
  const ctx = {
    workerFloor: (id: string) => (id === 'w1' ? floor : undefined),
    clients,
    accounts: { get: (id: string | undefined) => (id ? accounts.get(id) : undefined) },
    sendTo: (c: Client, msg: CodeServerMsg) => sent.push([c.id, msg]),
  } as unknown as Ctx;
  const mk = (id: string, extra: Partial<Client>) => {
    const c = { id, ...extra } as Client;
    clients.set(id, c);
    return c;
  };
  const live = codeLive(ctx);
  assert.equal(await live.watch(mk('m', { accountId: 'member' }), 'w1'), undefined);
  assert.equal(await live.watch(mk('s', { accountId: 'stranger' }), 'w1'), 'no such worker');
  assert.equal(await live.watch(mk('g', { guest: true }), 'w1'), 'no such worker');
  assert.equal(await live.watch(mk('o', {}), 'w1'), undefined); // the shared office password goes everywhere
  // One who left the office isn't sent anything.
  clients.delete('o');
  live.toViewers('w1', { t: 'code.reviewed', workerId: 'w1' });
  assert.deepEqual(sent.map(([id]) => id), ['m']);
  live.close();
});

function reviewed() {
  const dir = folder();
  writeFileSync(path.join(dir, 'src/app.ts'), 'one\ntwo\nthree\nfour\nfive\n');
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'five'], { cwd: dir });
  // Changed before the Code tab first opened: part of the baseline, not to review.
  writeFileSync(path.join(dir, 'notes.txt'), 'mine\n');
  const data = mkdtempSync(path.join(tmpdir(), 'codelive-data-'));
  const code = new CodeFiles((id) => (id === 'w1' ? dir : undefined));
  return { dir, data, code, review: new CodeReview(code, data) };
}

test('the review starts from a snapshot, then lists what the worker changed with its counts', async () => {
  const { dir, data, review } = reviewed();
  const empty = await review.files('w1');
  assert.ok(!('error' in empty));
  assert.deepEqual(empty.files, []);
  assert.ok(existsSync(path.join(data, 'code-review/w1.json')));
  writeFileSync(path.join(dir, 'src/app.ts'), 'one\nTWO\nthree\nfour\nfive\nsix\n');
  writeFileSync(path.join(dir, 'src/new.ts'), 'hello\n');
  rmSync(path.join(dir, 'notes.txt'));
  const r = await review.files('w1');
  assert.ok(!('error' in r));
  assert.deepEqual(
    r.files.map((f) => [f.path, f.status, f.added, f.removed]),
    [
      ['notes.txt', 'deleted', 0, 1],
      ['src/app.ts', 'modified', 2, 1],
      ['src/new.ts', 'added', 1, 0],
    ],
  );
  assert.equal(((await review.files('nobody')) as { status: number }).status, 404);
});

test('accepting a hunk moves the baseline, only from the baseline the person saw', async () => {
  const { dir, review } = reviewed();
  await review.files('w1');
  const now = 'one\nTWO\nthree\nfour\nFIVE\n';
  writeFileSync(path.join(dir, 'src/app.ts'), now);
  const b = await review.baseline('w1', 'src/app.ts');
  assert.ok(!('error' in b) && b.text !== null);
  const hunks = diffTexts(b.text, now);
  assert.equal(hunks.length, 2);
  const next = acceptHunk(b.text, now, hunks[0]);
  assert.equal(((await review.accept('w1', 'src/app.ts', 'stale', { text: next })) as { status: number }).status, 409);
  assert.deepEqual(await review.accept('w1', 'src/app.ts', b.base, { text: next }), { ok: true });
  const after = await review.files('w1');
  assert.ok(!('error' in after));
  assert.deepEqual(after.files.map((f) => [f.path, f.added, f.removed]), [['src/app.ts', 1, 1]]);
  // Accepting the whole file (only if it's still what they saw), then everything.
  const f = after.files[0];
  assert.equal(((await review.accept('w1', 'src/app.ts', f.base, { sig: 'other' })) as { status: number }).status, 409);
  assert.deepEqual(await review.accept('w1', 'src/app.ts', f.base, { sig: f.sig }), { ok: true });
  writeFileSync(path.join(dir, 'x.txt'), 'x\n');
  assert.deepEqual(await review.acceptAll('w1'), { ok: true });
  const none = await review.files('w1');
  assert.ok(!('error' in none) && none.files.length === 0);
});

test('rejecting puts the baseline back, only over the file the person saw, and only inside the folder', async () => {
  const { dir, review, code } = reviewed();
  await review.files('w1');
  writeFileSync(path.join(dir, 'src/app.ts'), 'one\nTWO\nthree\nfour\nfive\n');
  writeFileSync(path.join(dir, 'src/new.ts'), 'hello\n');
  rmSync(path.join(dir, 'notes.txt'));
  const r = await review.files('w1');
  assert.ok(!('error' in r));
  const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
  // The worker wrote again since: not rejected.
  writeFileSync(path.join(dir, 'src/app.ts'), 'one\nTWO!\nthree\nfour\nfive\n');
  assert.equal(((await review.reject('w1', 'src/app.ts', by['src/app.ts'].sig)) as { status: number }).status, 409);
  assert.equal(readFileSync(path.join(dir, 'src/app.ts'), 'utf8'), 'one\nTWO!\nthree\nfour\nfive\n');
  assert.deepEqual(await review.reject('w1', 'src/app.ts', hashOf('one\nTWO!\nthree\nfour\nfive\n')), { ok: true });
  assert.equal(readFileSync(path.join(dir, 'src/app.ts'), 'utf8'), 'one\ntwo\nthree\nfour\nfive\n');
  // A file it made is deleted; one it deleted comes back.
  assert.deepEqual(await review.reject('w1', 'src/new.ts', by['src/new.ts'].sig), { ok: true });
  assert.equal(existsSync(path.join(dir, 'src/new.ts')), false);
  assert.deepEqual(await review.reject('w1', 'notes.txt', by['notes.txt'].sig), { ok: true });
  assert.equal(readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'mine\n');
  // Nowhere outside the folder, in git's or the office's own.
  for (const bad of ['../x', '.git/config', '.agent-office/workers.json', '/etc/passwd', 'node_modules/a.js']) {
    assert.ok('error' in (await review.reject('w1', bad, 'none')), bad);
    assert.ok('error' in (await review.accept('w1', bad, 'none', { text: 'x' })), bad);
    assert.ok('error' in (await review.baseline('w1', bad)), bad);
  }
  // A per-hunk reject is a normal save of the reverted text, checked against the version.
  writeFileSync(path.join(dir, 'src/app.ts'), 'one\nTWO\nthree\nfour\nFIVE\n');
  const cur = await code.read('w1', 'src/app.ts');
  const base = await review.baseline('w1', 'src/app.ts');
  assert.ok(!('error' in cur) && !('error' in base) && base.text !== null);
  const [first] = diffTexts(base.text, cur.text);
  assert.ok(!('error' in (await code.write('w1', 'src/app.ts', rejectHunk(base.text, cur.text, first), cur.version))));
  assert.equal(readFileSync(path.join(dir, 'src/app.ts'), 'utf8'), 'one\ntwo\nthree\nfour\nFIVE\n');
});

test('the Ctrl+K prompt names the file, the lines, the picked text and the ask, in English', () => {
  const p = askPrompt({ path: 'src/app.ts', from: 3, to: 5, text: 'const a = 1;\n```\nx', instruction: '  rename a to count  ', by: 'Ann' });
  assert.ok(p);
  assert.match(p, /^Ann is looking at src\/app\.ts in the office's code editor and asks about lines 3-5:/);
  assert.match(p, /\nrename a to count\n/);
  // The fence is longer than any backticks in the text, so the text can't close it.
  assert.match(p, /````\nconst a = 1;\n```\nx\n````/);
  assert.match(p, /Make the change in src\/app\.ts directly/);
  assert.match(askPrompt({ path: 'a.md', from: 7, to: 7, text: '', instruction: 'fix', by: 'Ann' })!, /asks about line 7:/);
  assert.equal(askPrompt({ path: 'a.md', from: 1, to: 1, text: 'x', instruction: '   ', by: 'Ann' }), undefined);
});

test('Ctrl+K reaches only an idle or finished agent, through its prompt, and never for a guest or someone off its floor', async () => {
  const { codeHandlers } = await import('../src/server/ws/handlers/code.js');
  const prompts: string[] = [];
  const warned: (string | undefined)[] = [];
  const info = { id: 'w1', name: 'Ada', kind: 'agent', status: 'working' };
  const floor = { id: 'f1', workers: { get: () => info, prompt: (_id: string, text: string) => (prompts.push(text), undefined) } };
  const ctx = {
    workerFloor: (id: string) => (id === 'w1' ? floor : undefined),
    accounts: { get: (id: string | undefined) => (id === 'off' ? { role: 'member', floors: ['f2'] } : undefined) },
    warn: (_c: Client, e: string | undefined) => warned.push(e),
    sendTo: () => undefined,
  } as unknown as Ctx;
  const me = { id: 'c1', peer: { name: 'Ann' } } as unknown as Client;
  const ask = { t: 'code.ask' as const, workerId: 'w1', path: 'src/app.ts', from: 2, to: 3, text: 'x', instruction: 'make it y' };
  codeHandlers['code.ask'](ctx, me, ask);
  assert.equal(prompts.length, 0, 'busy: told, not typed into its turn');
  info.status = 'done';
  codeHandlers['code.ask'](ctx, { ...me, guest: true } as Client, ask);
  codeHandlers['code.ask'](ctx, { ...me, accountId: 'off' } as Client, ask);
  codeHandlers['code.ask'](ctx, me, { ...ask, path: '.git/config' });
  codeHandlers['code.ask'](ctx, me, { ...ask, path: '../x' });
  assert.equal(prompts.length, 0);
  codeHandlers['code.ask'](ctx, me, ask);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /^Ann is looking at src\/app\.ts .* lines 2-3:\n\nmake it y\n/);
  info.kind = 'shell';
  codeHandlers['code.ask'](ctx, me, ask);
  assert.equal(prompts.length, 1);
  assert.equal(warned.filter(Boolean).length, 6);
});
