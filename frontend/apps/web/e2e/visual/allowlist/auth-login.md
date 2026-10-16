# Allowlist `auth-login` (W1.22)

Экрана входа в эталоне нет: вход заменён демо-селектором «Персонаж» (`design-stage-1`, «Ортус CRM.dc.html» :29–66;
`docs/plan/v2/design-requests.md` B-6 №1). Пиксельной и структурной сверки нет — e2e `e2e/auth-login.spec.ts` и
проходка MCP (`docs/plan/evidence/auth-login/`). Запись снимается, когда DoR-сверщик положит макет в `design/`.

- kind: no-reference · target: h1:Вход · mode: both · reason: экран входа OIDC не нарисован — задача дизайну B-6 №1 (design-requests.md); состояния: начальное, вход оператора, переход к провайдеру, ошибка входа ?error=, сессия истекла, выход выполнен ?signedOut=1 («Вы вышли»), нет связи («Нет связи»); подписи — src/routes/auth/texts.ts, компоненты @ortus/ui · decision: PD-48, Q-W0.02-1 · owner: W1.22
