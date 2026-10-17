// W2.20 · Форма «Планирование рейса» (`logistics-plan`, S2-13; no-reference — design-requests `logistics-plan`,
// 14-stage2-dor §4): состояние страницы «Рабочее место логиста» `?plan=new` (ADR-0001). Собрана на @ortus/ui, как
// no-reference экраны этапа 1: рейс (название, подразделение, дата и окно, расстояние, водитель), груз (описание,
// масса, объём, длина кузова, температурный режим), точки погрузки и выгрузки, «Загрузка по участкам» при вводе
// (`legs` домена). Ошибки полей — после «Запланировать»; выгрузка больше, чем в кузове, — сразу (как проверит
// сервер); 422 сервера — под полями. Успех — тост «Рейс {номер} запланирован» и рабочее место с этим рейсом.
import { type components, ProblemError } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Banner, Button, Checkbox, DateInput, Field, Select, TextInput } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, type ReactElement, useCallback, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan, useShell } from '../../../../shell/context.tsx';
import { problemCode, useBusy, useRun } from '../../../../shell/run.tsx';
import { unitLabel, useOrgUnits } from '../../../../shell/scope.ts';
import { useToast } from '../../../../shell/toast.tsx';
import { afterChange, createPlan, idemKeys, useMembers, useTripPlans } from '../fleet/api.ts';
import { may, visibleTrips } from '../fleet/model.ts';
import {
  addStop,
  draftLegs,
  driverOptions,
  emptyDraft,
  type PlanDraft,
  type PlanErrors,
  removeStop,
  serverErrors,
  type StopDraft,
  todayIn,
  toCreate,
  validate,
} from './model.ts';
import { PLAN_TEXT as T } from './texts.ts';
import './plan.css';

type S = components['schemas'];

const TZ = 'Europe/Moscow';
const KEY = 'plan';

export function PlanForm({ tripParam }: { tripParam: string | undefined }): ReactElement {
  const { tenantId: id, audience, readOnly, nav } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const owner = audience === 'owner';
  const allowed = owner || can('fleet.routes.manage');
  const navigate = useNavigate();

  const back = useCallback(
    (search: Record<string, string> = {}) =>
      void navigate({
        to: '/t/$tenantId/$page',
        params: { tenantId, page: 'fleet' },
        search: search as never,
      }),
    [navigate, tenantId],
  );

  let body: ReactElement;
  if (readOnly) body = <Banner tone="neutral" title={T.readOnly} />;
  else if (!allowed) body = <Banner tone="info" title={T.noRight} />;
  else
    body = (
      <Form
        tenantId={tenantId}
        owner={owner}
        caps={nav.capabilities}
        tripParam={tripParam}
        onDone={(tripId) => back({ trip: tripId })}
        onCancel={() => back()}
      />
    );

  return (
    <section aria-labelledby="h-plan" className="ox-pl">
      <div className="ox-pl-head">
        <div className="ox-pl-crumb">{shell.nav.items.fleet}</div>
        <h1 id="h-plan" className="ox-pl-title" tabIndex={-1}>
          {T.title}
        </h1>
        <p className="ox-pl-intro">{T.intro}</p>
      </div>
      {body}
      {readOnly || !allowed ? (
        <div className="ox-pl-actions">
          <Button variant="secondary" onPress={() => back()}>
            {T.cancel}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Form(p: {
  tenantId: string;
  owner: boolean;
  caps: ReturnType<typeof useShell>['nav']['capabilities'];
  tripParam: string | undefined;
  onDone: (tripId: string) => void;
  onCancel: () => void;
}): ReactElement {
  const { tenantId, owner } = p;
  const can = useCan();
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const busy = useBusy(KEY);
  const units = useOrgUnits(tenantId, owner || can('org_units.read')).data ?? [];
  const trips = useTripPlans(tenantId).data ?? [];
  const members = useMembers(tenantId, owner || can('members.read')).data ?? [];
  const [keyOf] = useState(idemKeys);
  const [draft, setDraft] = useState<PlanDraft>(() =>
    emptyDraft({ unitId: '', date: todayIn(new Date(), TZ) }),
  );
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<PlanErrors>({});

  const access = { owner, caps: p.caps, units };
  const unitOptions = units
    .filter((u) => u.status === 'active' && u.kind !== 'region')
    .filter((u) => may(access, 'fleet.routes.manage', u.id))
    .map((u) => ({ value: u.id, label: unitLabel(units, u.id) ?? u.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  // Без названий подразделений (нет org_units.read) — подразделение права на маршруты.
  const capUnit = p.caps.find(
    (c) => c.permission === 'fleet.routes.manage' && c.scope.kind === 'org_unit',
  )?.scope.resourceIds[0];
  const visible = visibleTrips(trips);
  const tripUnit = (visible.find((t) => t.id === p.tripParam) ?? visible[0])?.orgUnitId;
  const defaultUnit =
    unitOptions.find((o) => o.value === tripUnit)?.value ?? unitOptions[0]?.value ?? capUnit ?? '';
  const d: PlanDraft = { ...draft, unitId: draft.unitId || defaultUnit };

  const all = validate(d);
  const live = Object.fromEntries(
    Object.entries(all).filter(([, v]) => v === T.errors.overload),
  ) as PlanErrors;
  const shown: PlanErrors = { ...(submitted ? all : live), ...server };
  const err = (k: string): string | undefined => shown[k];

  const change = (patch: Partial<PlanDraft>): void => {
    setDraft((x) => ({ ...x, ...patch }));
    setServer({});
  };
  const changeStop = (i: number, patch: Partial<StopDraft>): void => {
    setDraft((x) => ({ ...x, stops: x.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
    setServer({});
  };

  const drivers = driverOptions(members);
  const legs = draftLegs(d);

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    setSubmitted(true);
    if (Object.keys(all).length > 0 || busy) return;
    const body: S['TripPlanCreate'] = toCreate(d, TZ);
    try {
      const r = await run(KEY, () => createPlan(api, tenantId, body, keyOf(body)), null, {
        quiet: ['validation_failed'],
      });
      toast(format(T.created, { number: r.number }), 'ok');
      await afterChange(qc, tenantId);
      p.onDone(r.id);
    } catch (x) {
      if (problemCode(x) === 'validation_failed' && x instanceof ProblemError) {
        const mapped = serverErrors(x.problem?.violations ?? []);
        setServer(mapped);
        if (mapped.form || !Object.keys(mapped).length) {
          toast(format(T.failed, { error: x.problem?.detail ?? x.problem?.title ?? '' }), 'error');
        }
      }
    }
  };

  const F = T.fields;
  return (
    <form
      className="ox-pl-form"
      aria-label={T.formLabel}
      noValidate
      onSubmit={(e) => void submit(e)}
    >
      <div className="ox-pl-card">
        <fieldset className="ox-pl-fs">
          <legend className="ox-pl-legend">{T.sections.trip}</legend>
          <div className="ox-pl-grid">
            <div className="ox-pl-wide">
              <Field label={F.title} error={err('title')} required>
                <TextInput
                  value={d.title}
                  onChange={(v) => change({ title: v })}
                  placeholder={T.hints.titlePlaceholder}
                />
              </Field>
            </div>
            {unitOptions.length > 1 ? (
              <div className="ox-pl-wide">
                <Field label={F.unit} error={err('unit')} required>
                  <Select
                    value={d.unitId}
                    onChange={(v) => change({ unitId: v })}
                    options={unitOptions}
                  />
                </Field>
              </div>
            ) : null}
            <Field label={F.date} error={err('date')} required>
              <DateInput value={d.date} onChange={(v) => change({ date: v })} />
            </Field>
            <Field label={F.from} error={err('from')} hint={T.hints.time} required>
              <TextInput
                value={d.from}
                onChange={(v) => change({ from: v })}
                inputMode="numeric"
                placeholder="09:00"
              />
            </Field>
            <Field label={F.to} error={err('to')} hint={T.hints.time} required>
              <TextInput
                value={d.to}
                onChange={(v) => change({ to: v })}
                inputMode="numeric"
                placeholder="13:00"
              />
            </Field>
            <Field label={F.distance} error={err('distance')} unit={T.units.km}>
              <TextInput
                value={d.distance}
                onChange={(v) => change({ distance: v })}
                inputMode="decimal"
              />
            </Field>
            <div className="ox-pl-wide">
              <Field label={F.driver} error={err('driverId')}>
                <Select
                  value={d.driverId}
                  onChange={(v) => change({ driverId: v })}
                  placeholder={T.noDriver}
                  options={drivers}
                />
              </Field>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="ox-pl-card">
        <fieldset className="ox-pl-fs">
          <legend className="ox-pl-legend">{T.sections.cargo}</legend>
          <div className="ox-pl-grid">
            <div className="ox-pl-wide">
              <Field label={F.cargo} error={err('cargo')} required>
                <TextInput
                  value={d.cargo}
                  onChange={(v) => change({ cargo: v })}
                  placeholder={T.hints.cargoPlaceholder}
                />
              </Field>
            </div>
            <Field label={F.mass} error={err('mass')} unit={T.units.t} required>
              <TextInput value={d.mass} onChange={(v) => change({ mass: v })} inputMode="decimal" />
            </Field>
            <Field label={F.volume} error={err('volume')} unit={T.units.m3} required>
              <TextInput
                value={d.volume}
                onChange={(v) => change({ volume: v })}
                inputMode="decimal"
              />
            </Field>
            <Field label={F.length} error={err('length')} unit={T.units.m} required>
              <TextInput
                value={d.length}
                onChange={(v) => change({ length: v })}
                inputMode="decimal"
              />
            </Field>
            <div className="ox-pl-wide">
              <Checkbox checked={d.temp} onChange={(v) => change({ temp: v })} label={F.temp} />
            </div>
            {d.temp ? (
              <>
                <Field label={F.tempMin} error={err('tempMin')} unit={T.units.c} required>
                  <TextInput
                    value={d.tempMin}
                    onChange={(v) => change({ tempMin: v })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label={F.tempMax} error={err('tempMax')} unit={T.units.c} required>
                  <TextInput
                    value={d.tempMax}
                    onChange={(v) => change({ tempMax: v })}
                    inputMode="decimal"
                  />
                </Field>
              </>
            ) : null}
          </div>
        </fieldset>
      </div>

      <div className="ox-pl-card">
        <h2 className="ox-pl-h2">{T.sections.stops}</h2>
        {d.stops.map((s, i) => {
          const at = (f: string) => err(`stops[${i}].${f}`);
          const n = i + 1;
          return (
            <div key={i} className="ox-pl-stop">
              <fieldset className="ox-pl-fs">
                <legend className="ox-pl-stop-legend">{format(T.stop, { n })}</legend>
                <div className="ox-pl-stop-grid">
                  <Field label={F.op}>
                    <Select
                      value={s.op}
                      onChange={(v) => changeStop(i, { op: v as StopDraft['op'] })}
                      options={[
                        { value: 'load', label: T.ops.load },
                        { value: 'unload', label: T.ops.unload },
                      ]}
                    />
                  </Field>
                  <div className="ox-pl-stop-address">
                    <Field label={F.address} error={at('address')} required>
                      <TextInput
                        value={s.address}
                        onChange={(v) => changeStop(i, { address: v })}
                      />
                    </Field>
                  </div>
                  <Field label={F.time} error={at('time')} hint={T.hints.time}>
                    <TextInput
                      value={s.time}
                      onChange={(v) => changeStop(i, { time: v })}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label={F.stopMass} error={at('mass')} unit={T.units.t} required>
                    <TextInput
                      value={s.mass}
                      onChange={(v) => changeStop(i, { mass: v })}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label={F.stopVolume} error={at('volume')} unit={T.units.m3} required>
                    <TextInput
                      value={s.volume}
                      onChange={(v) => changeStop(i, { volume: v })}
                      inputMode="decimal"
                    />
                  </Field>
                </div>
                {d.stops.length > 1 ? (
                  <div className="ox-pl-stop-remove">
                    <Button
                      variant="ghost"
                      icon="delete"
                      aria-label={format(T.removeStop, { n })}
                      onPress={() => {
                        setDraft((x) => removeStop(x, i));
                        setServer({});
                      }}
                    >
                      {T.remove}
                    </Button>
                  </div>
                ) : null}
              </fieldset>
            </div>
          );
        })}
        <div>
          <Button
            variant="secondary"
            icon="add_location_alt"
            onPress={() => {
              setDraft(addStop);
              setServer({});
            }}
          >
            {T.addStop}
          </Button>
        </div>
      </div>

      <div className="ox-pl-card">
        <h2 className="ox-pl-h2">{T.sections.legs}</h2>
        <ol className="ox-pl-legs" aria-label={T.sections.legs}>
          {legs.map((l) => (
            <li key={l.n}>
              <span className="ox-pl-leg-name">
                {l.n}. {l.name || format(T.stop, { n: l.n })}
              </span>
              <span className="ox-pl-leg-op">{l.op}</span>
              <span className="ox-pl-leg-after">{l.after}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="ox-pl-actions">
        <Button variant="secondary" onPress={p.onCancel}>
          {T.cancel}
        </Button>
        <Button type="submit" icon="add_road" loading={busy} loadingLabel={T.submitting}>
          {T.submit}
        </Button>
      </div>
    </form>
  );
}
