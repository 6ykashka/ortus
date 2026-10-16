async (page) => {
  const AXE = 'node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js';
  const base = 'http://127.0.0.1:6102';
  const out = {};
  const axe = async (key) => {
    if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ path: AXE });
    out[key] = await page.evaluate(async () => {
      const res = await window.axe.run(document, { resultTypes: ['violations'] });
      return res.violations.map((v) => `${v.impact} ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    });
  };
  const scenario = (body) => page.evaluate(async (b) => {
    const csrf = /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const r = await fetch('/api/v1/dev/scenario', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf || ''), 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(b) });
    return r.status;
  }, body);
  const open = async (persona, path = '/') => {
    await page.goto(`${base}${path}?persona=${persona}`);
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
  };
  const header = () => page.getByRole('banner');
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const p of ['owner', 'operator', 'manager', 'driver', 'therapist', 'foreman']) { await open(p); await axe(`${w} ${p}`); }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await open('owner');
  await header().getByRole('button', { name: /^Уведомления/ }).click(); await axe('1440 owner notifications');
  await header().getByRole('button', { name: 'Профиль' }).click(); await axe('1440 owner profile');
  await open('therapist');
  await header().getByRole('button', { name: /сменить бизнес/ }).click(); await axe('1440 therapist switcher');
  await open('driver');
  await page.context().setOffline(true); await page.waitForTimeout(500); await axe('1440 driver offline');
  await page.context().setOffline(false); await page.waitForTimeout(500);
  await scenario({ preset: 'storage-full' });
  await open('owner'); await axe('1440 owner storage-full');
  await open('driver'); await axe('1440 driver storage-full');
  await scenario({ reset: true });
  await scenario({ preset: 'trial-ended' });
  await open('therapist'); await axe('1440 therapist trial-ended');
  await scenario({ reset: true });
  await page.goto(`${base}/t/00000000-0000-4000-8000-000000000000/home?persona=owner`);
  await page.getByRole('heading', { level: 1 }).waitFor(); await axe('1440 404 global');
  await open('owner');
  const alta = page.url().split('/')[4];
  await open('owner', `/t/${alta}/planned`); await axe('1440 404 in shell');
  await scenario({ scenario: 'getMyContext=loading' });
  await page.goto(`${base}/`); await page.getByRole('status', { name: 'Загрузка' }).waitFor(); await page.waitForTimeout(300); await axe('1440 loading');
  await scenario({ reset: true });
  await scenario({ scenario: 'getMyContext=offline' });
  await page.goto(`${base}/`); await page.getByRole('alert').waitFor(); await axe('1440 load error');
  await scenario({ reset: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await open('owner');
  await page.getByRole('navigation', { name: 'Навигация', exact: true }).getByRole('button', { name: 'Ещё' }).click(); await axe('390 owner sheet');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await open('owner');
  await header().getByRole('button', { name: 'Профиль' }).click();
  await page.getByRole('dialog', { name: 'Профиль' }).getByRole('button', { name: 'Выйти' }).click();
  await page.waitForURL('**/auth/login');
  await page.goto(`${base}/`); await page.getByText('Нужен вход').waitFor(); await axe('1440 need login');
  return JSON.stringify(out, null, 1);
}