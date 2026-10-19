# Allowlist `logistics-defects` (W2.21)

Экрана «Очередь блокирующих дефектов» нет в прототипе (B-6 №7, `docs/plan/v2/design-requests.md` «defect-queue»; S2-17,
14-stage2-dor.md §4). Пиксельной и структурной сверки нет; e2e (`e2e/logistics-defects.spec.ts`) и проходка Playwright
MCP обязательны. Карточка и команды — как карточка дефекта «Приёмки смен» эталона (:592–602), тосты — эталона.

- kind: no-reference · target: h1:Очередь блокирующих дефектов · mode: both · reason: страница вне меню /t/:tenantId/defects — вкладки «На проверке» / «Решённые» (listInspectionDefects), карточка (зона и описание, рейс и водитель, машина, время осмотра), вход со «Приёмки смен»; дорисовать в прототипе — design-requests «defect-queue» · decision: B-6, Q-W2.21-1 · owner: W2.21
- kind: no-reference · target: button:Подтвердить неисправность · mode: both · reason: решение decideInspectionDefect (allow_departure / confirm_out_of_service) с необязательным «Комментарием к решению» (DefectDecision.comment); решённый дефект — чип «Выезд разрешён» / «Неисправность подтверждена», время и комментарий; 409 — тост и перечитывание · decision: B-6, Q-W2.21-2 · owner: W2.21
- kind: no-reference · target: button:Повторить · mode: both · reason: ошибка listInspectionDefects — alert «Не удалось загрузить дефекты: …» и «Повторить»; загрузка — скелетон; пусто — «Блокирующих дефектов нет», «Решённых дефектов пока нет» · decision: B-6, Q-W2.21-2 · owner: W2.21
- kind: no-reference · target: button:Назначить · mode: both · reason: W2.46 (D-29 комплекта) — поля задачи у дефекта на проверке: строка «Исполнитель: {имя} · срок {дата} в {время}» / «Исполнитель не назначен», поля «Исполнитель» (listMembers в области members.read) и «Срок решения» (московское время), «Назначить» (assignInspectionDefect, If-Match); 409 и 422 — текст сервера · decision: D-29, Q-W2.52-9 · owner: W2.46
