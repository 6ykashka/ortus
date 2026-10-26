// W5.21 · Диалоги «Салона и SPA» на @ortus/ui Dialog (no-reference, B-6, по образцу диалогов W1.54): «Записать клиента»
// и «Перенести визит» (createAppointment, rescheduleAppointment — конфликт ресурсов показывается в диалоге), «Отменить
// визит» (cancelAppointment, «Клиент не пришёл»), «Новая услуга» и правка услуги с техкартой (createSpaService,
// updateSpaService). Ошибки: 422 — под полем (нарушение поля, затем detail), 409 resources_unavailable — блок
// конфликта, 409/412/404 — тост оболочки и перечитывание, диалог открыт; успех — тост после ответа сервера.
import { type components, ProblemError } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Button, Checkbox, Dialog, Field, Icon, Select, Textarea, TextInput } from '@ortus/ui';
import { type ReactElement, type ReactNode, useEffect, useId, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { problemCode, problemText, useRun } from '../../shell/run.tsx';
import { addDays, clock, dateTitle, localDate } from '../core/calendar/time.ts';
import {
  cancelVisit,
  createService,
  createVisit,
  idemKeys,
  rescheduleVisit,
  updateService,
} from './api.ts';
import type { SpaCtx } from './ctx.ts';
import {
  clientsOf,
  draftOfService,
  emptyService,
  type ServiceDraft,
  serviceBody,
  serviceErrors,
  startsAtOf,
  timeOptions,
  unitLabel,
  visitErrors,
  type VisitDraft,
} from './model.ts';
import { SPA_TEXT as T } from './texts.ts';

type S = components['schemas'];

/** Отказы, после которых данные на экране устарели: перечитать (тост — у `run`). */
const STALE = new Set(['invalid_transition', 'revision_mismatch', 'not_found']);

/** Нарушения 422 по полям формы: `field → текст`; нарушения без своего поля — общий текст. */
function violationsOf(e: unknown): { byField: Record<string, string>; general?: string } {
  if (!(e instanceof ProblemError) || e.code !== 'validation_failed') return { byField: {} };
  const byField: Record<string, string> = {};
  let general: string | undefined;
  for (const v of e.problem?.violations ?? []) {
    const key = v.field.replace(/\[\d+\].*$/, '').replace(/\..*$/, '');
    if (key && !byField[key]) byField[key] = v.message;
    else general ??= v.message;
  }
  if (!Object.keys(byField).length) general ??= e.problem?.detail ?? problemText(e);
  return general === undefined ? { byField } : { byField, general };
}

/** Команда диалога: ошибки по полям без тоста, конфликт — блоком, остальное — тост `run`. */
function useCommand(ctx: SpaCtx) {
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | undefined>();
  const [conflict, setConflict] = useState<string | undefined>();
  const [failures, setFailures] = useState(0);
  const exec = async (key: string, fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setBusy(true);
    setFields({});
    setGeneral(undefined);
    setConflict(undefined);
    try {
      await run(key, fn, ok, { quiet: ['validation_failed', 'resources_unavailable'] });
      await ctx.refresh();
      return true;
    } catch (e) {
      const code = problemCode(e);
      if (code === 'resources_unavailable') {
        setConflict(e instanceof ProblemError ? (e.problem?.detail ?? problemText(e)) : '');
      } else {
        const v = violationsOf(e);
        setFields(v.byField);
        setGeneral(v.general);
      }
      if (STALE.has(code)) void ctx.refresh();
      setBusy(false);
      setFailures((n) => n + 1);
      return false;
    }
  };
  return { busy, fields, general, conflict, failures, exec };
}

function Footer(p: {
  busy: boolean;
  submit: string;
  variant?: 'primary' | 'danger';
  onClose: () => void;
  onSubmit: () => void;
  cancel?: string;
}): ReactElement {
  return (
    <>
      <Button variant="secondary" onPress={p.onClose} disabled={p.busy}>
        {p.cancel ?? shell.modal.cancel}
      </Button>
      <Button
        variant={p.variant ?? 'primary'}
        onPress={p.onSubmit}
        loading={p.busy}
        loadingLabel={shell.modal.busy}
      >
        {p.submit}
      </Button>
    </>
  );
}

function Alert({ children }: { children: ReactNode }): ReactElement {
  return (
    <div role="alert" className="ox-spa-conflict" aria-label={T.visitForm.conflictAria}>
      <Icon name="event_busy" size={20} />
      <span>{children}</span>
    </div>
  );
}

/** Фокус на первое поле при открытии и после отказа. */
function useFocus(id: string, failures: number): void {
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id, failures]);
}

// ───────────────────────────── запись и перенос ─────────────────────────────

export function VisitDialog(p: {
  ctx: SpaCtx;
  /** Перенос существующего визита; без него — новая запись. */
  visit?: S['Appointment'];
  /** День, выбранный на странице. */
  date: string;
  /** Визиты окна страницы — источник клиентов для записи (Q-W5.21-1). */
  visits: readonly S['Appointment'][];
  onClose: () => void;
}): ReactElement {
  const { ctx, visit } = p;
  const api = useApi();
  const id = useId();
  const [keys] = useState(idemKeys);
  const cmd = useCommand(ctx);
  const services = ctx.services ?? [];
  const members = ctx.resources.filter((r) => r.kind === 'member' && r.object);
  const rooms = ctx.resources.filter((r) => r.kind === 'room');
  const equipment = ctx.resources.filter((r) => r.kind === 'equipment');
  const serviceNames = new Map(services.map((s) => [s.id, s.name]));
  const clients = clientsOf(p.visits, ctx.titles, serviceNames);
  const start = visit ? new Date(visit.window.startsAt).getTime() : ctx.now;
  const [date, setDate] = useState(visit ? localDate(start, ctx.tz) : p.date);
  const [draft, setDraft] = useState<VisitDraft>(() => ({
    serviceId: visit?.serviceId ?? services[0]?.id ?? '',
    clientId: visit?.clientId ?? '',
    practitionerId:
      visit?.practitionerMemberId ??
      (members.length === 1 ? (members[0]?.object?.entityId ?? '') : ''),
    roomId: visit?.roomId ?? '',
    equipmentIds: visit ? [...visit.equipmentIds] : [],
    time: visit ? clock(start, ctx.tz) : timeOf(ctx),
  }));
  const [shown, setShown] = useState(false);
  useFocus(`${id}-first`, cmd.failures);
  const svc = services.find((s) => s.id === draft.serviceId);
  const required = svc?.requiredEquipmentIds ?? [];
  const local = shown
    ? visitErrors(
        visit ? { ...draft, serviceId: 'x', clientId: 'x' } : draft,
        visit ? [] : required,
      )
    : {};
  const err = (key: string, localKey?: keyof typeof local): string | undefined =>
    cmd.fields[key] ?? (localKey ? local[localKey] : undefined);
  const set = (patch: Partial<VisitDraft>): void => setDraft((d) => ({ ...d, ...patch }));

  const submit = async (): Promise<void> => {
    setShown(true);
    if (
      Object.keys(
        visitErrors(
          visit ? { ...draft, serviceId: 'x', clientId: 'x' } : draft,
          visit ? [] : required,
        ),
      ).length
    )
      return;
    const startsAt = startsAtOf(date, draft.time, ctx.tz);
    if (visit) {
      const body: S['AppointmentReschedule'] = {
        startsAt,
        timeZone: ctx.tz,
        practitionerMemberId: draft.practitionerId,
        roomId: draft.roomId,
        equipmentIds: draft.equipmentIds,
      };
      const done = await cmd.exec(
        'spa.reschedule',
        () =>
          rescheduleVisit({ api, tenantId: ctx.tenantId, seen: visit, body, key: keys.key(body) }),
        T.done.rescheduled,
      );
      if (done) p.onClose();
      return;
    }
    const body: S['AppointmentCreate'] = {
      orgUnitId: svc?.orgUnitId ?? '',
      serviceId: draft.serviceId,
      clientId: draft.clientId,
      practitionerMemberId: draft.practitionerId,
      roomId: draft.roomId,
      equipmentIds: draft.equipmentIds,
      startsAt,
      timeZone: ctx.tz,
    };
    const done = await cmd.exec(
      'spa.create',
      () => createVisit(api, ctx.tenantId, body, keys.key(body)),
      T.done.created,
    );
    if (done) p.onClose();
  };

  const toggle = (rid: string, on: boolean): void =>
    set({
      equipmentIds: on ? [...draft.equipmentIds, rid] : draft.equipmentIds.filter((x) => x !== rid),
    });
  const F = T.visitForm;
  const opts = (list: readonly S['CalendarResource'][], by: 'id' | 'member') =>
    list.map((r) => ({
      value: by === 'member' ? (r.object?.entityId ?? r.id) : r.id,
      label: r.name,
    }));
  const dayOptions = [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const d = addDays(p.date, n);
    return { value: d, label: dateTitle(d) };
  });
  if (!dayOptions.some((o) => o.value === date))
    dayOptions.unshift({ value: date, label: dateTitle(date) });

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={visit ? F.titleMove : F.titleNew}
      busy={cmd.busy}
      footer={
        <Footer
          busy={cmd.busy}
          submit={visit ? F.submitMove : F.submitNew}
          onClose={p.onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-spa-form">
        {cmd.conflict ? <Alert>{cmd.conflict}</Alert> : null}
        {cmd.general ? <Alert>{cmd.general}</Alert> : null}
        {visit ? null : (
          <Field label={F.service} error={err('serviceId', 'serviceId')} required>
            <Select
              id={`${id}-first`}
              value={draft.serviceId}
              placeholder={F.choose}
              options={services.map((s) => ({ value: s.id, label: s.name }))}
              onChange={(v) => set({ serviceId: v, equipmentIds: [] })}
            />
          </Field>
        )}
        {visit ? null : (
          <Field label={F.client} hint={F.clientHint} error={err('clientId', 'clientId')} required>
            <Select
              value={draft.clientId}
              placeholder={clients.length ? F.choose : F.noClients}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => set({ clientId: v })}
            />
          </Field>
        )}
        <Field
          label={F.practitioner}
          error={err('practitionerMemberId', 'practitionerId')}
          required
        >
          <Select
            id={visit ? `${id}-first` : undefined}
            value={draft.practitionerId}
            placeholder={F.choose}
            options={opts(members, 'member')}
            onChange={(v) => set({ practitionerId: v })}
          />
        </Field>
        <Field label={F.room} error={err('roomId', 'roomId')} required>
          <Select
            value={draft.roomId}
            placeholder={F.choose}
            options={opts(rooms, 'id')}
            onChange={(v) => set({ roomId: v })}
          />
        </Field>
        {equipment.length ? (
          <fieldset className="ox-spa-set">
            <legend>{F.equipment}</legend>
            {equipment.map((r) => (
              <Checkbox
                key={r.id}
                checked={draft.equipmentIds.includes(r.id)}
                onChange={(on) => toggle(r.id, on)}
                label={r.name}
                description={required.includes(r.id) ? F.equipmentHint : undefined}
              />
            ))}
            {err('equipmentIds', 'equipmentIds') ? (
              <span className="ox-spa-err" role="alert">
                {err('equipmentIds', 'equipmentIds')}
              </span>
            ) : null}
          </fieldset>
        ) : null}
        <div className="ox-spa-when">
          <Field label={F.date} error={cmd.fields.startsAt}>
            <Select value={date} options={dayOptions} onChange={setDate} />
          </Field>
          <Field label={F.time}>
            <Select value={draft.time} options={timeOptions()} onChange={(v) => set({ time: v })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** Ближайшее начало на сетке 15 минут от «сейчас» страницы (в поясе организации), в пределах рабочего дня. */
function timeOf(ctx: SpaCtx): string {
  const [h = 8, m = 0] = clock(ctx.now, ctx.tz).split(':').map(Number);
  const total = Math.ceil((h * 60 + m) / 15) * 15;
  const clamped = Math.min(Math.max(total, 8 * 60), 19 * 60 + 45);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

// ───────────────────────────── отмена ─────────────────────────────

export function CancelDialog(p: {
  ctx: SpaCtx;
  visit: S['Appointment'];
  onClose: () => void;
}): ReactElement {
  const { ctx, visit } = p;
  const api = useApi();
  const id = useId();
  const [keys] = useState(idemKeys);
  const cmd = useCommand(ctx);
  const [reason, setReason] = useState('');
  const [noShow, setNoShow] = useState(false);
  const [shown, setShown] = useState(false);
  useFocus(id, cmd.failures);
  const F = T.cancelForm;
  const error = cmd.fields.reason ?? (shown && !reason.trim() ? F.reasonRequired : undefined);

  const submit = async (): Promise<void> => {
    setShown(true);
    if (!reason.trim()) return;
    const body: S['AppointmentCancel'] = {
      reason: reason.trim(),
      ...(noShow ? { noShow: true } : {}),
    };
    const done = await cmd.exec(
      'spa.cancel',
      () => cancelVisit({ api, tenantId: ctx.tenantId, seen: visit, body, key: keys.key(body) }),
      noShow ? T.done.noShow : T.done.cancelled,
    );
    if (done) p.onClose();
  };

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={F.title}
      size="sm"
      busy={cmd.busy}
      footer={
        <Footer
          busy={cmd.busy}
          submit={F.submit}
          variant="danger"
          cancel={F.back}
          onClose={p.onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-spa-form">
        <p className="ox-spa-note">{F.text}</p>
        {cmd.general ? <Alert>{cmd.general}</Alert> : null}
        <Field label={F.reason} error={error} required>
          <Textarea id={id} value={reason} rows={3} onChange={setReason} />
        </Field>
        <Checkbox
          checked={noShow}
          onChange={(on) => {
            setNoShow(on);
            if (on && !reason.trim()) setReason(F.noShow);
          }}
          label={F.noShow}
        />
      </div>
    </Dialog>
  );
}

// ───────────────────────────── услуга ─────────────────────────────

export function ServiceDialog(p: {
  ctx: SpaCtx;
  /** Правка существующей услуги; без неё — новая. */
  service?: S['SpaService'];
  onClose: () => void;
}): ReactElement {
  const { ctx, service } = p;
  const api = useApi();
  const id = useId();
  const [keys] = useState(idemKeys);
  const cmd = useCommand(ctx);
  const items = ctx.items ?? [];
  const equipment = ctx.resources.filter((r) => r.kind === 'equipment');
  const [d, setD] = useState<ServiceDraft>(() =>
    service ? draftOfService(service) : emptyService(),
  );
  const [shown, setShown] = useState(false);
  useFocus(`${id}-name`, cmd.failures);
  const F = T.serviceForm;
  const local = shown ? serviceErrors(d) : {};
  const API_FIELD = {
    name: 'name',
    duration: 'durationMinutes',
    before: 'bufferBeforeMinutes',
    after: 'bufferAfterMinutes',
    price: 'price',
    recipe: 'recipe',
  } as const;
  const err = (k: keyof typeof API_FIELD): string | undefined =>
    local[k] ?? cmd.fields[API_FIELD[k]];
  const set = (patch: Partial<ServiceDraft>): void => setD((x) => ({ ...x, ...patch }));
  const orgUnitId =
    service?.orgUnitId ??
    ctx.services?.[0]?.orgUnitId ??
    ctx.resources.find((r) => r.kind === 'room')?.orgUnitId ??
    '';

  const submit = async (): Promise<void> => {
    setShown(true);
    if (Object.keys(serviceErrors(d)).length) return;
    const base = serviceBody(d, items);
    if (service) {
      const body: S['SpaServicePatch'] = base;
      const done = await cmd.exec(
        'spa.service',
        () => updateService(api, ctx.tenantId, service, body, keys.key(body)),
        format(T.done.serviceSaved, { name: base.name }),
      );
      if (done) p.onClose();
      return;
    }
    const body: S['SpaServiceCreate'] = { orgUnitId, ...base };
    const done = await cmd.exec(
      'spa.service',
      () => createService(api, ctx.tenantId, body, keys.key(body)),
      format(T.done.serviceCreated, { name: base.name }),
    );
    if (done) p.onClose();
  };

  const line = (i: number, patch: Partial<ServiceDraft['recipe'][number]>): void =>
    set({ recipe: d.recipe.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <Dialog
      open
      onClose={p.onClose}
      title={service ? format(F.titleEdit, { name: service.name }) : F.titleNew}
      busy={cmd.busy}
      footer={
        <Footer
          busy={cmd.busy}
          submit={service ? F.submitEdit : F.submitNew}
          onClose={p.onClose}
          onSubmit={() => void submit()}
        />
      }
    >
      <div className="ox-spa-form">
        {cmd.general ? <Alert>{cmd.general}</Alert> : null}
        <Field label={F.name} error={err('name')} required>
          <TextInput id={`${id}-name`} value={d.name} onChange={(v) => set({ name: v })} />
        </Field>
        <div className="ox-spa-when">
          <Field label={F.duration} unit={F.minUnit} error={err('duration')} required>
            <TextInput
              inputMode="numeric"
              value={d.duration}
              onChange={(v) => set({ duration: v })}
            />
          </Field>
          <Field label={F.price} unit={F.rubUnit} error={err('price')} required>
            <TextInput inputMode="decimal" value={d.price} onChange={(v) => set({ price: v })} />
          </Field>
        </div>
        <div className="ox-spa-when">
          <Field label={F.before} unit={F.minUnit} error={err('before')}>
            <TextInput inputMode="numeric" value={d.before} onChange={(v) => set({ before: v })} />
          </Field>
          <Field label={F.after} unit={F.minUnit} error={err('after')}>
            <TextInput inputMode="numeric" value={d.after} onChange={(v) => set({ after: v })} />
          </Field>
        </div>
        {equipment.length ? (
          <fieldset className="ox-spa-set">
            <legend>{F.equipment}</legend>
            {equipment.map((r) => (
              <Checkbox
                key={r.id}
                checked={d.equipmentIds.includes(r.id)}
                onChange={(on) =>
                  set({
                    equipmentIds: on
                      ? [...d.equipmentIds, r.id]
                      : d.equipmentIds.filter((x) => x !== r.id),
                  })
                }
                label={r.name}
              />
            ))}
          </fieldset>
        ) : null}
        <fieldset className="ox-spa-set">
          <legend>{F.recipe}</legend>
          {d.recipe.map((l, i) => {
            const item = items.find((x) => x.id === l.itemId);
            return (
              <div key={i} className="ox-spa-line">
                <Field label={`${F.item} ${i + 1}`}>
                  <Select
                    value={l.itemId}
                    placeholder={F.choose}
                    options={items.map((x) => ({ value: x.id, label: x.name }))}
                    onChange={(v) => line(i, { itemId: v })}
                  />
                </Field>
                <Field
                  label={`${F.quantity} ${i + 1}`}
                  unit={item ? unitLabel(item.baseUnit) : undefined}
                >
                  <TextInput
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(v) => line(i, { quantity: v })}
                  />
                </Field>
                <button
                  type="button"
                  className="ox-spa-x"
                  aria-label={`${F.removeLine} ${i + 1}`}
                  onClick={() => set({ recipe: d.recipe.filter((_, j) => j !== i) })}
                >
                  <Icon name="close" size={20} />
                </button>
              </div>
            );
          })}
          {err('recipe') ? (
            <span className="ox-spa-err" role="alert">
              {err('recipe')}
            </span>
          ) : null}
          {items.length ? (
            <Button
              variant="secondary"
              icon="add"
              onPress={() => set({ recipe: [...d.recipe, { itemId: '', quantity: '' }] })}
            >
              {F.addLine}
            </Button>
          ) : (
            <span className="ox-spa-note">{F.noItems}</span>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
