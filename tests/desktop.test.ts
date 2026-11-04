// The desktop tools (bin/office-desktop.js): what each one runs in the machine, its coordinates scaled
// from the screenshot's to the screen's, and nothing it's given read as more than it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKTOP_TOOLS, desktopAction, runDesktopTool } from '../bin/office-desktop.js';

test('six tools: a screenshot, and the mouse and keyboard', () => {
  assert.deepEqual(DESKTOP_TOOLS.map((t: { name: string }) => t.name), ['desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll', 'desktop_drag']);
});

test('clicks, scrolls and drags at screenshot pixels times the scale', () => {
  assert.equal(desktopAction('desktop_click', { x: 10, y: 20 }), 'xdotool mousemove --sync $(( 10 * $K )) $(( 20 * $K )) click --repeat 1 --delay 120 1');
  assert.match(desktopAction('desktop_click', { x: 1, y: 2, button: 'right', clicks: 2, scale: 3 }), /\$\(\( 1 \* 3 \)\) \$\(\( 2 \* 3 \)\) click --repeat 2 --delay 120 3$/);
  assert.match(desktopAction('desktop_scroll', { x: 5, y: 6, direction: 'up', amount: 4 }), /click --repeat 4 --delay 40 4$/);
  assert.match(desktopAction('desktop_drag', { from_x: 1, from_y: 2, to_x: 3, to_y: 4 }), /mousedown 1 .* mouseup 1$/);
  assert.throws(() => desktopAction('desktop_click', { x: -1, y: 2 }));
  assert.throws(() => desktopAction('desktop_click', { x: '1; rm -rf /', y: 2 }));
  assert.throws(() => desktopAction('desktop_click', { x: 1, y: 2, button: 'nose' }));
});

test('text is typed as base64, and keys are only key names', () => {
  const typed = desktopAction('desktop_type', { text: "it's $(rm -rf /)" });
  assert.match(typed, /^printf %s '[A-Za-z0-9+/=]+' \| base64 -d \| xdotool type --delay 15 --file -$/);
  assert.equal(Buffer.from(typed.split("'")[1], 'base64').toString(), "it's $(rm -rf /)");
  assert.equal(desktopAction('desktop_key', { keys: 'ctrl+s Return' }), 'xdotool key --delay 80 -- ctrl+s Return');
  for (const bad of ['ctrl+s; reboot', '$(id)', 'a`b`', '']) assert.throws(() => desktopAction('desktop_key', { keys: bad }), bad);
});

test("a tool's screenshot comes back as a picture, with the scale to use", async () => {
  const io = {
    env: { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 't' },
    send: async (req: { body?: Buffer }) => {
      const asked = JSON.parse(String(req.body)) as { command: string };
      assert.match(asked.command, /xdotool mousemove .* \|\| exit 3; sleep 0\.7; xwd -root -silent \| python3 -c/);
      return { status: 200, type: 'application/json', data: Buffer.from(JSON.stringify({ exitCode: 0, stdout: '2392 1316 2 1196 658\niVBORw0KGgo=\n', stderr: '' })) };
    },
  };
  const r = await runDesktopTool('desktop_click', { x: 100, y: 50 }, io);
  assert.equal(r.image, 'iVBORw0KGgo=');
  assert.match(r.text, /^Done\. Screenshot 1196×658 of a 2392×1316 screen \(scale 2/);
});
