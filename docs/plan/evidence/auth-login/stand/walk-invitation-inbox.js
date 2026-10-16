async (page) => {
  const APP = 'http://127.0.0.1:5210';
  const MAILPIT = 'http://127.0.0.1:9025';
  const EV = 'D:/work/test26042026_Kirill_3.0/.claude/worktrees/wf_dde809bf-d31-2/docs/plan/evidence/';
  const path = (s) => s.replace(/^https?:\/\/[^/]+/, '');
  const out = { invitation: {}, inbox: {} };
  const errors = [];
  const apiUrls = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()} @ ${path(m.location().url || '')}`); });
  page.on('request', (r) => { const p = path(r.url()); if (p.startsWith('/api/')) apiUrls.push(`${r.method()} ${p}`); });
  const call = (method, p, body, ifMatch) => page.evaluate(async ({ method, p, body, ifMatch }) => {
    const headers = {};
    if (method !== 'GET') {
      const csrf = /(?:^|;\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
      if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
      headers['Idempotency-Key'] = crypto.randomUUID();
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ifMatch) headers['If-Match'] = ifMatch;
    const r = await fetch(p, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    return { status: r.status, body: t ? JSON.parse(t) : null };
  }, { method, p, body, ifMatch });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const h1 = () => page.getByRole('heading', { level: 1 }).innerText();

  // --- auth-invitation на стенде: владелец «Лотоса» приглашает, письмо Mailpit, новичок принимает.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(APP + '/?persona=owner%40t-lotos');
  await page.waitForURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 20000 });
  const ctx = await call('GET', '/api/v1/me/context');
  const lotos = ctx.body.tenants.find((t) => t.name === 'SPA «Лотос»').tenantId;
  const units = await call('GET', `/api/v1/tenants/${lotos}/org-units`);
  const root = units.body.items.find((u) => u.parentId === null).id;
  const email = `walk.${Date.now().toString(36)}@lotos.example`;
  const inv = await call('POST', `/api/v1/tenants/${lotos}/invitations`, { email, displayName: 'Проходка Приглашения', orgUnitIds: [root], roleAssignments: [] });
  out.invitation.invite = inv.status;
  let id = '';
  for (let i = 0; i < 30 && !id; i++) {
    const list = await (await page.request.get(MAILPIT + '/api/v1/messages')).json();
    id = list.messages.find((m) => m.To.some((t) => t.Address === email))?.ID ?? '';
    if (!id) await page.waitForTimeout(500);
  }
  const letter = await (await page.request.get(MAILPIT + '/api/v1/message/' + id)).json();
  const link = /(https?:\/\/[^\s]+\/auth\/invitation)#token=([A-Za-z0-9_-]+)/.exec(letter.Text);
  out.invitation.letterSubject = letter.Subject;
  out.invitation.letterLinkOrigin = link[1];
  const token = link[2];
  // Без входа: «Войти и принять».
  await call('POST', '/api/v1/auth/logout');
  await page.context().clearCookies();
  await page.goto(APP + '/auth/login');
  for (const [w, hgt] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.goto(APP + '/auth/invitation#token=' + token);
    await page.getByRole('button', { name: 'Войти и принять' }).waitFor();
    await page.screenshot({ path: EV + 'auth-invitation/stand/' + w + '.png' });
    out.invitation['signedOut' + w] = { h1: await h1(), url: path(page.url()), overflowX: await overflow() };
  }
  out.invitation.tokenInApiUrls = apiUrls.some((u) => u.includes(token));
  // Вход новичка (dev-вход W1.50) и принятие.
  await page.setViewportSize({ width: 1440, height: 900 });
  const persona = 'new-' + email;
  const login = await call('POST', '/api/v1/dev/login', { persona, email, displayName: 'Проходка Приглашения' });
  out.invitation.devLogin = login.status;
  await page.goto(APP + '/auth/login');
  await page.goto(APP + '/auth/invitation#token=' + token);
  await page.getByRole('button', { name: 'Принять приглашение' }).waitFor();
  out.invitation.signedIn = { h1: await h1(), main: (await page.getByRole('main').innerText()).replace(/\s+/g, ' ') };
  await page.screenshot({ path: EV + 'auth-invitation/stand/impl-signed-in-1440.png' });
  await page.getByRole('button', { name: 'Принять приглашение' }).click();
  await page.waitForURL(new RegExp(`/t/${lotos}/`), { timeout: 20000 });
  await page.getByRole('banner').getByText('SPA «Лотос»').first().waitFor();
  out.invitation.accepted = { url: path(page.url()) };
  await page.screenshot({ path: EV + 'auth-invitation/stand/impl-accepted-1440.png' });
  await page.goto(APP + '/auth/invitation#token=' + token);
  await page.getByText('Приглашение уже принято').first().waitFor();
  out.invitation.again = await h1();
  await page.screenshot({ path: EV + 'auth-invitation/stand/impl-already-accepted-1440.png' });
  await page.goto(APP + '/auth/invitation#token=' + 'A'.repeat(43));
  await page.getByText('Приглашение не найдено').first().waitFor();
  out.invitation.unknown = await h1();
  // Уборка: владелец приостанавливает новичка — место тарифа освобождается.
  await page.goto(APP + '/?persona=owner%40t-lotos');
  await page.waitForURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 20000 });
  const members = await call('GET', `/api/v1/tenants/${lotos}/members`);
  const m = members.body.items.find((x) => x.email === email);
  out.invitation.cleanup = (await call('PATCH', `/api/v1/tenants/${lotos}/members/${m.id}`, { status: 'suspended' }, `"${m.revision}"`)).status;

  // --- inbox на стенде: владелец «Альты», ленты пусты (производителей уведомлений нет).
  for (const [w, hgt] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.goto(APP + '/?persona=owner');
    await page.waitForURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 20000 });
    const bell = page.getByRole('banner').getByRole('button', { name: /^Уведомления/ });
    await bell.waitFor();
    const feed = page.waitForResponse((r) => path(r.url()).startsWith('/api/v1/me/notifications?'));
    await bell.click();
    const resp = await feed;
    const panel = page.getByRole('dialog', { name: 'Уведомления' });
    await panel.getByText('Новых событий нет').waitFor();
    const box = await panel.boundingBox();
    await page.screenshot({ path: EV + 'inbox/stand/' + w + '.png' });
    out.inbox[w] = { bell: await bell.getAttribute('aria-label') ?? await bell.innerText(), feed: resp.status(), panel: [Math.round(box.x), Math.round(box.x + box.width)], overflowX: await overflow(), text: (await panel.innerText()).replace(/\s+/g, ' ') };
  }
  out.consoleErrorsAndWarnings = errors;
  out.api = apiUrls;
  return out;
}
