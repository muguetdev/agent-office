// The desktop of a worker's own machine, not only its Chrome: a screenshot of the whole screen, and the
// mouse and keyboard on any window (a terminal, VS Code, a native app, a dialog), as MCP tools served
// by bin/office-workers.js mcp next to machine_run (see office-machine.js). Each runs in the machine
// with machine_run's own way in: xdotool for the input, xwd for the screen, and a little Python (it's
// already there) that turns xwd's dump into a PNG, scaled down to fit 1280×800 so it costs few tokens.
// Coordinates are the screenshot's pixels; the tools scale them back to the screen's.

import { call } from './office-machine.js';

/** xwd's dump (stdin) as a PNG, base64, after a line "screenW screenH scale shotW shotH". */
const SHOT_PY = String.raw`import sys, struct, zlib, base64
d = sys.stdin.buffer.read()
f = struct.unpack('>25I', d[:100])
hs, w, h, order, bpp, bpl, rmask, gmask, bmask, ncolors = f[0], f[4], f[5], f[7], f[11], f[12], f[14], f[15], f[16], f[19]
if bpp not in (24, 32):
    sys.exit('screenshot: %d bits per pixel is not supported' % bpp)
B = bpp // 8
off = hs + ncolors * 12
def at(mask):
    s = (mask.bit_length() - 8) // 8
    return s if order == 0 else B - 1 - s
ri, gi, bi = at(rmask), at(gmask), at(bmask)
def chunk(t, b):
    return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
k = max(-(-w // 1280), -(-h // 800), 1)
while True:
    ow, oh = len(range(0, w, k)), len(range(0, h, k))
    raw = bytearray()
    for y in range(0, h, k):
        row = d[off + y * bpl: off + y * bpl + w * B]
        line = bytearray(ow * 3)
        line[0::3] = row[ri::B * k][:ow]
        line[1::3] = row[gi::B * k][:ow]
        line[2::3] = row[bi::B * k][:ow]
        raw += b'\0' + line
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', ow, oh, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b'')
    out = base64.b64encode(png).decode()
    if len(out) <= 900000 or k >= 8:
        break
    k += 1
print('%d %d %d %d %d' % (w, h, k, ow, oh))
print(out)
`;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
/** The display, and K, how many screen pixels one screenshot pixel is (what the screenshot shrinks by, unless told). */
const PRELUDE = 'export DISPLAY="${DISPLAY:-:1}"; read W H <<< "$(xdotool getdisplaygeometry)"; K=$(( (W + 1279) / 1280 )); K2=$(( (H + 799) / 800 )); [ "$K2" -gt "$K" ] && K=$K2; [ "$K" -lt 1 ] && K=1;';
const SHOT = `xwd -root -silent | python3 -c "$(printf %s '${b64(SHOT_PY)}' | base64 -d)"`;

const int = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 20000) throw new Error(`${name} is a whole number of pixels in the screenshot`);
  return n;
};
const BUTTONS = { left: 1, middle: 2, right: 3 };
const KEYS_RE = /^[A-Za-z0-9_+ .-]{1,120}$/;

const point = {
  x: { type: 'integer', minimum: 0, description: "Pixels from the screenshot's left edge." },
  y: { type: 'integer', minimum: 0, description: "Pixels from the screenshot's top edge." },
};
const scale = { type: 'integer', minimum: 1, maximum: 8, description: 'The scale the screenshot said (screen pixels per screenshot pixel), when it said one other than the usual.' };
const shotAfter = { type: 'boolean', description: 'A screenshot after it (default true), to see what it did.' };

export const DESKTOP_TOOLS = [
  {
    name: 'desktop_screenshot',
    title: 'See your machine’s screen',
    description:
      "A screenshot of your machine's whole desktop (not only Chrome): every window, dialog and the panel. Coordinates for the other desktop_ tools are this picture's pixels. " +
      'For web pages, the computer (Chrome DevTools) tools are quicker and more exact; use these for everything else on the screen.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'desktop_click',
    title: 'Click on your machine’s screen',
    description: 'Moves the mouse to a point of the last desktop_screenshot and clicks there (left by default; right for a menu; clicks: 2 to double-click). Returns a screenshot after it.',
    inputSchema: {
      type: 'object',
      properties: { ...point, button: { type: 'string', enum: ['left', 'middle', 'right'] }, clicks: { type: 'integer', minimum: 1, maximum: 3 }, scale, screenshot: shotAfter },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'desktop_type',
    title: 'Type on your machine',
    description: 'Types text into whatever has the focus on your machine’s desktop (click into it first). Returns a screenshot after it.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, screenshot: shotAfter }, required: ['text'], additionalProperties: false },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'desktop_key',
    title: 'Press keys on your machine',
    description: 'Presses keys on your machine’s desktop, xdotool names, several separated by spaces: Return, Escape, Tab, ctrl+s, ctrl+shift+t, alt+F4, super, Page_Down. Returns a screenshot after it.',
    inputSchema: { type: 'object', properties: { keys: { type: 'string' }, screenshot: shotAfter }, required: ['keys'], additionalProperties: false },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'desktop_scroll',
    title: 'Scroll on your machine’s screen',
    description: 'Scrolls the window under a point of the screenshot (down by default), a few notches. Returns a screenshot after it.',
    inputSchema: {
      type: 'object',
      properties: { ...point, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer', minimum: 1, maximum: 30 }, scale, screenshot: shotAfter },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'desktop_drag',
    title: 'Drag on your machine’s screen',
    description: 'Drags with the left button from one point of the screenshot to another (moving a window, a file, a slider, selecting text). Returns a screenshot after it.',
    inputSchema: {
      type: 'object',
      properties: { from_x: point.x, from_y: point.y, to_x: point.x, to_y: point.y, scale, screenshot: shotAfter },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

/** The command line for a desktop tool's action (before the screenshot), or what's wrong with what was asked. */
export function desktopAction(name, a) {
  const k = a.scale === undefined ? '$K' : String(Math.min(8, Math.max(1, int(a.scale, 'scale'))));
  const at = (x, y) => `$(( ${int(x, 'x')} * ${k} )) $(( ${int(y, 'y')} * ${k} ))`;
  if (name === 'desktop_screenshot') return '';
  if (name === 'desktop_click') {
    const button = BUTTONS[a.button ?? 'left'];
    if (!button) throw new Error('button is left, middle or right');
    const clicks = Math.min(3, Math.max(1, Number(a.clicks) || 1));
    return `xdotool mousemove --sync ${at(a.x, a.y)} click --repeat ${clicks} --delay 120 ${button}`;
  }
  if (name === 'desktop_type') {
    if (typeof a.text !== 'string' || !a.text) throw new Error('Say what to type: text');
    return `printf %s '${b64(a.text)}' | base64 -d | xdotool type --delay 15 --file -`;
  }
  if (name === 'desktop_key') {
    if (typeof a.keys !== 'string' || !KEYS_RE.test(a.keys.trim())) throw new Error('keys are xdotool key names, like Return, ctrl+s or alt+F4, separated by spaces');
    return `xdotool key --delay 80 -- ${a.keys.trim()}`;
  }
  if (name === 'desktop_scroll') {
    const button = { up: 4, down: 5, left: 6, right: 7 }[a.direction ?? 'down'];
    if (!button) throw new Error('direction is up, down, left or right');
    const n = Math.min(30, Math.max(1, Number(a.amount) || 3));
    return `xdotool mousemove --sync ${at(a.x, a.y)} click --repeat ${n} --delay 40 ${button}`;
  }
  if (name === 'desktop_drag') {
    return `xdotool mousemove --sync ${at(a.from_x, a.from_y)} mousedown 1 sleep 0.2 mousemove --sync ${at(a.to_x, a.to_y)} sleep 0.2 mouseup 1`;
  }
  throw new Error(`Unknown tool: ${name}`);
}

/** Runs a desktop tool in the worker's machine; resolves to its text, and the screenshot as a PNG (base64) when there is one. */
export async function runDesktopTool(name, args, io) {
  const a = args && typeof args === 'object' ? args : {};
  const action = desktopAction(name, a);
  const shot = name === 'desktop_screenshot' || a.screenshot !== false;
  const command = [PRELUDE, action ? `${action} || exit 3;` : '', shot ? `${action ? 'sleep 0.7; ' : ''}${SHOT}` : 'echo done'].join(' ');
  const r = await call('run', { body: { command, timeout: 60 }, timeout: 60 }, io);
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || `exit code ${r.exitCode}`).trim().split('\n').slice(-3).join('\n'));
  if (!shot) return { text: 'Done.' };
  const [head, png] = String(r.stdout).trim().split('\n');
  const [sw, sh, k, w, h] = head.split(' ').map(Number);
  const note = `${action ? 'Done. ' : ''}Screenshot ${w}×${h} of a ${sw}×${sh} screen${k === 1 ? '' : ` (scale ${k}: give coordinates in this picture's pixels${k === Math.max(Math.ceil(sw / 1280), Math.ceil(sh / 800), 1) ? '' : `, and scale: ${k}`})`}.`;
  return { text: note, image: png };
}
