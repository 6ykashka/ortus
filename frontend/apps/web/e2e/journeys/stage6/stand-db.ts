// W6.90 · Два шва стенда для пути «Объект от замера до сдачи», которых нет в API (Q-W6.90-1):
//  1. вставка строк в базу организации стенда — акты, акт сдачи и подрядчик объекта (операций создания в контракте нет,
//     Q-W6.15-4, Q-W6.15-7; сида ремонта на стенде нет). Команда идёт в контейнер PostgreSQL слота (`docker exec psql`)
//     под учёткой стенда из его env-файла, который e2e-stand кладёт во временный каталог на время прогона;
//  2. код подписи из SMS: заглушка порта кода (`repairs.LogCodes`) пишет его в журнал `cmd/api` слота — «почту
//     разработчика»; тест читает последнюю запись журнала.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const slot = (): number => {
  const raw = process.env.ORTUS_SLOT;
  if (raw === undefined || !/^\d+$/.test(raw))
    throw new Error('ORTUS_SLOT не задан: шов стенда нужен только в e2e-stand');
  return Number(raw);
};

/** env-файл стенда слота (tools/ci/e2e-stand.mjs: `ortus-e2e-stand-s<N>.env` во временном каталоге). */
function standEnv(): Record<string, string> {
  const file = join(tmpdir(), `ortus-e2e-stand-s${slot()}.env`);
  if (!existsSync(file)) throw new Error(`нет env-файла стенда ${file}`);
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1]) out[m[1]] = (m[2] ?? '').replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  }
  return out;
}

function docker(args: string[], input?: string): string {
  const r = spawnSync('docker', args, { encoding: 'utf8', input, timeout: 60_000 });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(`docker ${args.slice(0, 3).join(' ')}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Выполнить SQL в базе `db` контейнера PostgreSQL слота; вернуть строки вывода (без заголовков и тегов команд). */
function psql(db: string, sql: string): string[] {
  const env = standEnv();
  const project = env.COMPOSE_PROJECT_NAME || `ortus-s${slot()}`;
  const id = docker([
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--filter',
    'label=com.docker.compose.service=postgres',
  ])
    .trim()
    .split(/\s+/)[0];
  if (!id) throw new Error(`нет контейнера postgres проекта ${project}`);
  const user = env.PG_SUPERUSER ?? '';
  const pass = env.PG_SUPERPASS ?? '';
  if (!user) throw new Error('в env-файле стенда нет PG_SUPERUSER');
  const out = docker(
    [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${pass}`,
      id,
      'psql',
      '-U',
      user,
      '-d',
      db,
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '-',
    ],
    sql,
  );
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Выполнить SQL в базе организации `tenant` (id из /me/context); вернуть строки вывода. */
export function tenantSql(tenant: string, sql: string): string[] {
  if (!/^[0-9a-f-]{36}$/.test(tenant)) throw new Error(`не id организации: ${tenant}`);
  const [db] = psql(
    'ortus_control',
    `select database_name from tenant_routing where tenant_id = '${tenant}';`,
  );
  if (!db || !/^[a-z0-9_]+$/.test(db)) throw new Error(`нет базы организации ${tenant}`);
  return psql(db, sql);
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** Акт или акт сдачи объекта: документ в состоянии «ждёт подписи» (создают сид и следующие шаги, Q-W6.15-7). */
export function insertDocument(
  tenant: string,
  o: {
    project: string;
    kind: 'act' | 'handover_act';
    title: string;
    actNo?: number;
    amountMinor?: number;
  },
): string {
  const [id] = tenantSql(
    tenant,
    `insert into repairs.documents (project_id, kind, title, state, act_no, amount_minor, sent_at)
     values (${q(o.project)}, ${q(o.kind)}, ${q(o.title)}, 'wait', ${o.actNo ?? 'null'}, ${o.amountMinor ?? 'null'}, now())
     returning id;`,
  );
  if (!id) throw new Error('документ не вставлен');
  return id;
}

/** Подрядчик объекта без доступа (создают сид и следующие шаги, Q-W6.15-4). */
export function insertSubcontractor(
  tenant: string,
  o: { project: string; name: string; scope: string; contractMinor: number },
): string {
  const [id] = tenantSql(
    tenant,
    `insert into repairs.subcontractors (project_id, name, scope, active, contract_minor)
     values (${q(o.project)}, ${q(o.name)}, ${q(o.scope)}, false, ${o.contractMinor}) returning id;`,
  );
  if (!id) throw new Error('подрядчик не вставлен');
  return id;
}

/**
 * Последний код подписи из журнала cmd/api слота (`repairs: code of the signature`, поле `code`): текстовый и JSON-формат
 * slog. Читается после запроса кода (`requestDocumentSignature`); строки идут последовательно, берётся последняя.
 */
export function lastSignCode(): string {
  const file = join(tmpdir(), `ortus-e2e-api-s${slot()}.log`);
  if (!existsSync(file)) throw new Error(`нет журнала cmd/api ${file}`);
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('code of the signature'));
  const last = lines.at(-1);
  const m = last && (/"code":"(\d{4,8})"/.exec(last) ?? /\bcode=(\d{4,8})\b/.exec(last));
  if (!m?.[1]) throw new Error('в журнале cmd/api нет кода подписи');
  return m[1];
}
