import { chromium } from 'playwright-core';
const out = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:4711/login');
await page.fill('#password', 'dev');
await page.click('#submit');
await page.waitForURL((u) => !u.pathname.startsWith('/login'));
await page.evaluate(() => localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Teste', color: '#ef476f', look: {} })));
await page.goto('http://localhost:4711/');
await page.waitForFunction(() => window.__office && window.__office.store.floor && window.__office.store.dog, null, { timeout: 60000 });
await page.evaluate(() => { const n = window.__office.net; n.send({ t: 'dog.breed', breed: 'pomeranian' }); n.send({ t: 'dog.coat', coat: 6 }); });
await page.waitForTimeout(5000);
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    const o = window.__office;
    const d = (o.dog.body ?? o.dog.root).getWorldPosition(new o.camera.position.constructor());
    const p = o.player;
    p.pos.set(d.x - 1.1, 0, d.z - 1.1);
    const yaw = Math.atan2(d.x - p.pos.x, d.z - p.pos.z);
    p.facing = yaw; p.camYaw = yaw - Math.PI; p.lookPitch = -0.4;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: out.replace('.png', `-${i}.png`) });
  await page.waitForTimeout(2500);
}
await browser.close();
