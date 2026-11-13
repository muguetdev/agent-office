// ⚙️ Settings' Graphics, under You: what the 3D office spends on each frame (see core/quality.ts).
// Yours alone, kept in this browser.
import { chooseGraphics, chosenGraphics, GRAPHICS, qualityFor, type Graphics } from '../core/quality';
import { h } from './dom';
import { choiceRow } from './settings-rows';
import { L } from '../i18n';

/** The setting's buttons and note. */
export function graphicsSetting(): Node[] {
  const label: Record<Graphics, string> = { auto: L.graphics.auto, high: L.graphics.high, low: L.graphics.low };
  const picked = chosenGraphics();
  const note = picked === 'auto' ? L.graphics.autoNote(qualityFor('auto').level === 'low') : picked === 'high' ? L.graphics.highNote : L.graphics.lowNote;
  return [choiceRow(L.graphics.title, GRAPHICS.map((g) => [g, label[g]] as const), chosenGraphics, chooseGraphics), h('p.setting-note', {}, note)];
}
