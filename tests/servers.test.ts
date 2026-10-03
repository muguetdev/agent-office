// Floors that are servers (server/servers.ts): what counts as a server to reach, and what the office
// gets ready for one: its key, its config, the floor's own ssh, and the note its agents read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { forgetServer, isSshTarget, prepareServer, publicKey, sshTarget } from '../src/server/servers.js';

test('a server is an address, a user and a port, nothing that could be an ssh option', () => {
  assert.deepEqual(sshTarget(' 203.0.113.7 ', 'root', undefined), { host: '203.0.113.7', user: 'root', port: 22 });
  assert.deepEqual(sshTarget('srv.example.com', 'deploy_1', 2222), { host: 'srv.example.com', user: 'deploy_1', port: 2222 });
  for (const [host, user, port] of [['-oProxyCommand=x', 'root', 22], ['a b', 'root', 22], ['srv', '-root', 22], ['srv', 'ro ot', 22], ['srv', 'root', 0], ['srv', 'root', 70000], ['', 'root', 22]] as const) {
    assert.equal(typeof sshTarget(host, user, port), 'string', `${host} ${user} ${port}`);
  }
  assert.equal(isSshTarget({ host: 'srv', user: 'root', port: 22 }), true);
  assert.equal(isSshTarget({ host: 'srv; rm -rf /', user: 'root', port: 22 }), false);
});

test("a server's floor gets its own key, a config and an ssh that know the way in, and a note for its agents", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-servers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'data');
  const folder = path.join(root, 'servers', 'prod');
  const bin = path.join(folder, '.agent-office', 'bin');
  const shell = prepareServer(data, 'prod', { host: '203.0.113.7', user: 'deploy', port: 2222 }, folder, bin);

  const key = publicKey(data, 'prod')!;
  assert.match(key, /^ssh-ed25519 \S+ agent-office-prod$/);
  assert.equal(statSync(path.join(data, 'ssh', 'prod')).mode & 0o777, 0o600, 'the private key is only the office’s');
  // Getting it ready again keeps the same key.
  prepareServer(data, 'prod', { host: '203.0.113.7', user: 'deploy', port: 2222 }, folder, bin);
  assert.equal(publicKey(data, 'prod'), key);

  const config = readFileSync(path.join(data, 'ssh', 'prod.config'), 'utf8');
  for (const line of ['Host prod', 'HostName 203.0.113.7', 'User deploy', 'Port 2222', `IdentityFile ${path.join(data, 'ssh', 'prod')}`, 'IdentitiesOnly yes', 'StrictHostKeyChecking accept-new']) assert.ok(config.includes(line), line);
  // ssh itself reads it as the floor's server.
  const seen = execFileSync(path.join(bin, 'ssh'), ['-G', 'prod'], { encoding: 'utf8' });
  assert.match(seen, /^hostname 203\.0\.113\.7$/m);
  assert.match(seen, /^user deploy$/m);
  assert.match(seen, /^port 2222$/m);

  for (const file of ['AGENTS.md', 'CLAUDE.md']) assert.match(readFileSync(path.join(folder, file), 'utf8'), /`ssh prod`/);
  assert.deepEqual(shell.slice(0, 2), ['-l', '-c']);
  assert.match(shell[2], /\/bin\/ssh' prod; exec /);

  forgetServer(data, 'prod');
  assert.equal(existsSync(path.join(data, 'ssh', 'prod')), false);
  assert.equal(publicKey(data, 'prod'), undefined);
});
