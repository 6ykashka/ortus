// W4.32 · Пространство (М:61–292): шапка с вкладками «Страницы», «Участники и доступ», «Автоматизация» (руководитель),
// «Архив» (редактор или руководитель), уровень и область; тело вкладки и диалоги пространства. Дерево —
// getKnowledgeSpaceTree: невидимое пространство — 404, баннер текстом сервера и список пространств.
import { format, knowledge as K } from '@ortus/texts';
import { type ReactElement, useEffect, useRef } from 'react';

import { problemCode } from '../../../shell/run.tsx';
import { LoadFailed } from '../../company/modules/ui.tsx';
import { AccessDialog } from './access.tsx';
import { useTree } from './api.ts';
import { ArchiveTab, AutoTab } from './auto.tsx';
import { errorText, useKb } from './ctx.tsx';
import { MoveDialog, NodeDialog } from './dialogs.tsx';
import { indexTree, LEVEL_ICON, lowerFirst, tabOf, tabsOf, type TabKey } from './model.ts';
import { PagesTab } from './pages.tsx';
import { Glyph, Skeleton } from './parts.tsx';
import { PeopleTab } from './people.tsx';

export function SpaceView({ spaceId }: { spaceId: string }): ReactElement {
  const { tenantId, search, go, setErr, dialog, setDraft } = useKb();
  const tree = useTree(tenantId, spaceId);
  const missing = tree.isError && problemCode(tree.error) === 'not_found';

  useEffect(() => {
    if (!missing) return;
    setErr(errorText(tree.error));
    go({}, true);
    // Только по ответу дерева.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  // Недоступная или неизвестная вкладка в адресе (не руководитель по `&tab=auto`) — «Страницы», адрес без tab.
  const shown = tree.data ? tabOf(tree.data.space, search.tab) : undefined;
  const fix = !!shown && !!search.tab && shown !== search.tab;
  useEffect(() => {
    if (!fix || !shown) return;
    go(
      {
        space: spaceId,
        ...(search.page ? { page: search.page } : {}),
        ...(shown === 'pages' ? {} : { tab: shown }),
      },
      true,
    );
    // Только по расхождению вкладки адреса и показанной.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, shown]);

  // Прямая ссылка на вкладку (`&tab=arch` на телефоне): при появлении полосы вкладок активная прокручивается в её
  // видимую часть (только по горизонтали, только один раз — дальше полосу двигает сам участник).
  const tabsRef = useRef<HTMLElement | null>(null);
  const shownTabs = useRef(false);
  const ready = !!tree.data;
  useEffect(() => {
    const nav = tabsRef.current;
    if (!ready || !nav || shownTabs.current) return;
    shownTabs.current = true;
    const cur = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!cur) return;
    const n = nav.getBoundingClientRect();
    const c = cur.getBoundingClientRect();
    if (c.right > n.right) nav.scrollLeft += c.right - n.right;
    else if (c.left < n.left) nav.scrollLeft -= n.left - c.left;
  }, [ready]);

  if (tree.isPending || missing) return <Skeleton />;
  if (tree.isError) return <LoadFailed error={tree.error} onRetry={() => void tree.refetch()} />;

  const sp = tree.data.space;
  const t = indexTree(tree.data.nodes);
  const tab = tabOf(sp, search.tab);
  const lv = LEVEL_ICON[sp.access];
  const pick = (key: TabKey): void => {
    setDraft(null);
    go({
      space: sp.id,
      ...(search.page ? { page: search.page } : {}),
      ...(key === 'pages' ? {} : { tab: key }),
    });
  };

  return (
    <>
      <section aria-label={sp.name} className="ox-kb-space">
        <div className="ox-kb-space-head">
          <div className="ox-kb-space-id">
            <button
              type="button"
              className="ox-kb-back"
              aria-label={K.space.back}
              onClick={() => go({})}
            >
              <Glyph name="arrow_back" size={18} />
            </button>
            <span className="ox-kb-space-icon" style={{ background: sp.color }}>
              <Glyph name={sp.icon} size={20} />
            </span>
            <span className="ox-kb-space-names">
              <span>{format(K.space.role, { role: sp.my.role || K.space.roleBranch })}</span>
              <strong>{sp.name}</strong>
            </span>
          </div>
          <nav ref={tabsRef} aria-label={K.space.tabsAria} className="ox-kb-tabs">
            {tabsOf(sp).map((x) => (
              <button
                key={x.key}
                type="button"
                className="ox-kb-tab"
                aria-current={x.key === tab ? 'page' : 'false'}
                onClick={() => pick(x.key)}
              >
                {K.space.tabs[x.key]}
                {x.badge > 0 ? <span className="ox-kb-badge">{x.badge}</span> : null}
              </button>
            ))}
          </nav>
          <span className="ox-kb-fill" />
          <span className="ox-kb-space-level" data-tone={lv.tone}>
            <Glyph name={lv.icon} size={17} />
            {format(K.space.level, {
              label: K.levels[sp.access].label,
              area: lowerFirst(sp.areaLabel),
            })}
          </span>
        </div>
        {tab === 'pages' ? <PagesTab space={sp} tree={t} /> : null}
        {tab === 'people' ? <PeopleTab space={sp} tree={t} /> : null}
        {tab === 'auto' ? <AutoTab space={sp} /> : null}
        {tab === 'arch' ? <ArchiveTab space={sp} /> : null}
      </section>
      {dialog?.kind === 'node' ? <NodeDialog space={sp} tree={t} parent={dialog.parent} /> : null}
      {dialog?.kind === 'move' ? <MoveDialog space={sp} tree={t} nodeId={dialog.nodeId} /> : null}
      {dialog?.kind === 'access' ? (
        <AccessDialog space={sp} tree={t} nodeId={dialog.nodeId} />
      ) : null}
    </>
  );
}
