import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import tty from 'node:tty';
import { normalizeRepo, sameRepo } from '../shared/floors.js';
import type { RepoChoice } from '../shared/protocol.js';
import { Building, tildify } from './building.js';
import { officeHome, type Config } from './config.js';
import { L } from './i18n.js';

// Setting up an office from its terminal: where projects are cloned, signing the GitHub CLI in, and
// picking the first repositories to clone as floors. A new office walks you through it the first time
// it starts in a terminal, so it opens on projects of your own instead of an empty building (or
// whatever folder it happened to be started in). `agent-office setup` runs it again, or does it
// without asking when given --projects / --project (deploy/provision.sh does).

/** How many repositories a list shows; typing a word narrows it down. */
const SHOWN = 12;

/** Folders people keep their code in, in the home folder: the first one that's there is the suggestion. */
const CODE_FOLDERS = ['Workspace', 'workspace', 'Developer', 'code', 'Code', 'projects', 'Projects', 'repos', 'src', 'dev', 'git', 'GitHub', 'github'];

/** The setup's words, in the language the terminal asks for (see ./i18n.ts). */
const m = L.setup;

/**
 * Someone's at a terminal to answer questions. Asks about the file descriptors, not process.stdin:
 * on Windows, opening stdin when it's a pipe another process is reading (`npm run dev`, where tsx
 * watch waits on it for Enter) blocks forever, and the office never opens. stdout goes first, so
 * anything run with its output piped (concurrently, a service, CI) doesn't look at stdin at all.
 */
export function interactive(): boolean {
  return tty.isatty(1) && tty.isatty(0) && !process.env.CI;
}

/**
 * The office starting in a terminal with no floors yet: walk through the workspace folder, GitHub
 * sign-in and the first projects before it opens. Enter skips any of it; the elevator does the same.
 */
export async function welcome(cfg: Config): Promise<void> {
  const building = new Building(cfg.dataDir, cfg.projectsDir, { terminal: true });
  if (building.list().length) return;
  // --projects is the answer to the first question (the office applies it again as it starts).
  const folderGiven = !!cfg.projects && !building.setProjectsDir(cfg.projects, L.srv.commandLine);
  console.log(`
  👋 Welcome to Command Express!

  Every project is a floor of the building, and this one doesn't have any yet.
  Let's add your first: pick one of your GitHub repositories and the office
  clones it. Press Enter to skip any question and do it from the office's
  elevator instead.`);
  await walkthrough(building, cfg.dataDir, !folderGiven && !building.projectsDirState().custom);
  console.log(building.list().length ? m.allSet : m.openingEmpty);
}

/** `agent-office setup …`: returns the exit code. */
export async function setupCommand(argv: string[]): Promise<number> {
  let home = '';
  let projects = '';
  const repos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) {
        console.error(m.needsValue(a));
        process.exit(2);
      }
      return v;
    };
    if (a === '-h' || a === '--help') {
      process.stdout.write(m.help);
      return 0;
    } else if (a === '--home') home = path.resolve(value());
    else if (a === '--projects') projects = value();
    else if (a === '--project') repos.push(value());
    else {
      console.error(`${m.unknownOption(a)}\n`);
      process.stderr.write(m.help);
      return 2;
    }
  }

  // The same office `agent-office` would start from here (see loadConfig).
  const cwd = process.cwd();
  let dir = home || officeHome();
  let inProject = false;
  if (!home && !process.env.AGENT_OFFICE_HOME && cwd !== dir && existsSync(path.join(cwd, '.agent-office', 'config.json'))) {
    dir = cwd;
    inProject = true;
  }
  const dataDir = path.join(dir, '.agent-office');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (await officeRunning(dataDir)) {
    console.error(`agent-office setup: the office in ${tildify(dir)} is running. Add projects from its elevator, and pick the workspace folder in ⚙️ Settings.`);
    return 1;
  }
  const building = new Building(dataDir, inProject ? path.join(os.homedir(), 'agent-office') : dir, { terminal: true });

  if (projects || repos.length || !interactive()) {
    if (!projects && !repos.length) {
      console.error('agent-office setup: nothing to do without a terminal to ask in. Pass --projects <dir> and/or --project <owner/repo>.');
      return 2;
    }
    let code = 0;
    if (projects) {
      const err = building.setProjectsDir(projects, 'agent-office setup');
      if (err) {
        console.error(m.badProjects(err));
        return 1;
      }
      console.log(m.clonedInto(building.projectsDirState().dir));
    }
    for (const repo of repos) if (!(await addFloor(building, repo, 'agent-office setup'))) code = 1;
    return code;
  }

  const floors = building.list();
  console.log(
    floors.length
      ? `\n  🏢 ${L.setup.hasFloors(tildify(dir), floors.map((f) => f.name))}`
      : `\n  🏢 ${L.setup.noFloorsIn(tildify(dir))}`,
  );
  await walkthrough(building, dataDir, true);
  return 0;
}

/** The questions: the workspace folder (when `askFolder`), GitHub, then repositories to add. */
async function walkthrough(building: Building, dataDir: string, askFolder: boolean) {
  if (askFolder) await pickFolder(building);
  const login = await githubLogin(dataDir);
  if (!login) {
    console.log(m.addLater);
    return;
  }
  await pickProjects(building, login);
}

async function pickFolder(building: Building) {
  const now = building.projectsDirState();
  const suggestion = now.custom ? now.dir : tildify(suggestedFolder(building.projectsDir));
  console.log(m.folderQuestion);
  for (;;) {
    const answer = (await ask(m.folderPrompt(suggestion))) || suggestion;
    const err = building.setProjectsDir(answer, whoAmI());
    if (!err) break;
    console.log(`     ✗ ${err}`);
  }
  console.log(m.folderSet(building.projectsDirState().dir));
}

/** Where to suggest cloning projects: a code folder that's already in the home folder, else `fallback`. */
export function suggestedFolder(fallback: string, home = os.homedir()): string {
  let names: string[] = [];
  try {
    names = readdirSync(home);
  } catch {
    return fallback;
  }
  for (const name of CODE_FOLDERS) {
    const dir = path.join(home, name);
    try {
      if (names.includes(name) && statSync(dir).isDirectory()) return dir;
    } catch {
      // a broken link
    }
  }
  return fallback;
}

/** Who `gh` is signed in to GitHub as, after offering to sign it in. Undefined when there's no GitHub to use. */
async function githubLogin(cwd: string): Promise<string | undefined> {
  for (let tried = false; ; tried = true) {
    const me = await ghUser(cwd);
    if (me.login) {
      console.log(m.signedIn(me.login));
      return me.login;
    }
    if (me.missing) {
      const how = process.platform === 'darwin' ? 'brew install gh' : process.platform === 'win32' ? 'winget install GitHub.cli' : 'sudo apt install gh';
      console.log(m.ghMissing(how));
      return undefined;
    }
    if (!me.signedOut || tried) {
      console.log(m.ghUnreachable(me.error ?? ''));
      return undefined;
    }
    console.log(m.ghSignedOut);
    if (m.no.test(await ask(m.signInNow))) return undefined;
    spawnSync('gh', ['auth', 'login'], { stdio: 'inherit' });
  }
}

function ghUser(cwd: string): Promise<{ login?: string; missing?: boolean; signedOut?: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile('gh', ['api', 'user', '--jq', '.login'], { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      if (!err && stdout.trim()) return resolve({ login: stdout.trim() });
      if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve({ missing: true });
      const why = String(stderr || err?.message || '').trim();
      resolve({ signedOut: /auth login|not logged in|authentication|bad credentials|HTTP 401/i.test(why), error: why.split('\n').filter(Boolean).slice(-1)[0] ?? 'gh failed' });
    });
  });
}

async function pickProjects(building: Building, login: string) {
  process.stdout.write(m.askingRepos);
  let repos: RepoChoice[] = [];
  try {
    repos = await building.repos();
    clearLine();
  } catch (err) {
    clearLine();
    console.log(m.reposFailed((err as Error).message));
  }
  let shown = repos.slice(0, SHOWN);
  if (shown.length) {
    console.log(m.reposHeader(SHOWN, repos.length));
    printRepos(shown, building);
  } else if (!repos.length) console.log(m.noRepos);
  let added = 0;
  for (;;) {
    const answer = await ask(added ? m.pickAnother : m.pickFirst);
    if (!answer) return;
    let pick: string | undefined;
    if (/^\d+$/.test(answer)) {
      pick = shown[Number(answer) - 1]?.name;
      if (!pick) {
        console.log(m.notInList(answer));
        continue;
      }
    } else pick = normalizeRepo(answer);
    if (!pick) {
      const q = answer.toLowerCase();
      const matches = repos.filter((r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q));
      if (!matches.length) {
        console.log(m.noMatch(answer));
        continue;
      }
      shown = matches.slice(0, SHOWN);
      console.log(m.matches(matches.length, answer, SHOWN));
      printRepos(shown, building);
      continue;
    }
    if (await addFloor(building, pick, login)) added++;
  }
}

/** Clones `repo` as a new floor, saying how it went. */
async function addFloor(building: Building, repo: string, by: string): Promise<boolean> {
  const r = await building.add(repo, by, (def) => {
    console.log(`     ⏳ Cloning ${def.repo ?? repo} into ${tildify(def.dir)}…`);
  });
  if (typeof r === 'string') {
    console.log(`     ✗ ${r}`);
    return false;
  }
  console.log(m.added(r.repo ?? r.name, building.list().indexOf(r) + 1));
  return true;
}

function printRepos(list: RepoChoice[], building: Building) {
  const width = Math.max(40, (process.stdout.columns || 100) - 1);
  const nameWidth = Math.min(40, Math.max(...list.map((r) => r.name.length)));
  const floors = building.list();
  list.forEach((r, i) => {
    const note = floors.some((f) => sameRepo(f.repo, r.name)) ? m.alreadyFloor : [r.private ? m.private : '', r.description ?? ''].filter(Boolean).join(' · ');
    const line = `    ${String(i + 1).padStart(2)}. ${r.name.padEnd(nameWidth)}  ${note}`.trimEnd();
    console.log(line.length > width ? `${line.slice(0, width - 1)}…` : line);
  });
}

/** One question, answered with a line: '' when skipped with Enter or Ctrl+D. Ctrl+C quits. */
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => {
    process.stdout.write('\n');
    process.exit(130);
  });
  try {
    return await new Promise<string>((resolve) => {
      rl.once('close', () => resolve(''));
      rl.question(question).then(
        (a) => resolve(a.trim()),
        () => resolve(''),
      );
    });
  } finally {
    rl.close();
  }
}

function clearLine() {
  process.stdout.write('\r\x1b[2K');
}

function whoAmI(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'agent-office setup';
  }
}

/** An office is running from this data folder: its hook server is listening where it said it would. */
function officeRunning(dataDir: string): Promise<boolean> {
  let port = 0;
  try {
    port = Number(readFileSync(path.join(dataDir, 'hook-port'), 'utf8')) || 0;
  } catch {
    // never started
  }
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (up: boolean) => {
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(800, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
