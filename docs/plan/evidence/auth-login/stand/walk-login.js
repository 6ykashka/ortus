async (page) => {
  const path = (s) => s.replace(/^https?:\/\/[^/]+/, '');
  const ev = 'D:/work/test26042026_Kirill_3.0/.claude/worktrees/wf_dde809bf-d31-2/docs/plan/evidence/auth-login/stand/';
  const out = {};
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  for (const [w, h] of [[768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('http://127.0.0.1:5210/auth/login?error=session_expired&next=%2Ft%2Fx%2Fusers');
    await page.getByRole('status').waitFor();
    await page.screenshot({ path: ev + w + '.png' });
    out[w] = {
      overflowX: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      buttonHeight: (await page.getByRole('button', { name: 'Войти', exact: true }).boundingBox()).height,
      status: await page.getByRole('status').innerText(),
    };
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = [];
  page.on('request', (r) => {
    const p = path(r.url());
    if (p.startsWith('/api/')) api.push(r.method() + ' ' + p);
  });
  await page.goto('http://127.0.0.1:5210/auth/login?next=%2Fauth%2Finvitation');
  await page.getByRole('button', { name: 'Войти', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  out.apiOnLoad = [...api];
  const nav = page.waitForResponse((r) => path(r.url()).split('?')[0] === '/api/v1/auth/login');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const r = await nav;
  out.startLogin = { url: path(r.url()), status: r.status(), body: (await r.text()).slice(0, 300) };
  out.consoleErrorsAndWarnings = errors;
  return out;
}
