import type { Page, Route } from '@playwright/test';

/** A PostgREST stand-in over a large generated dataset, enough of the query language for the portal's reads. */

type Row = Record<string, unknown>;

export type ScaleSize = { barangays: number; puroksPer: number; households: number; residentsPer: number; assessments: number; releases: number };

export const LARGE: ScaleSize = { barangays: 64, puroksPer: 5, households: 8000, residentsPer: 4, assessments: 30000, releases: 12000 };

const DAY = 86_400_000;
const NUTRITION = ['underweight', 'normal', 'overweight', 'obese'];
const ILLNESS = ['none', 'none', 'none', 'tuberculosis', 'hypertension', 'diabetes', 'asthma', 'dengue', 'pneumonia', 'diarrhea', 'skin_infection', 'other'];
const COMPLICATIONS = ['anemia', 'edema', 'stunting', 'wasting', 'disability', 'vision_problem'];
const VACCINATION = ['unknown', 'complete', 'partial', 'none'];
const FIRST = ['Maria', 'Jose', 'Ana', 'Juan', 'Rosa', 'Pedro', 'Luz', 'Carlo', 'Liza', 'Mark'];
const LAST = ['Dela Cruz', 'Santos', 'Reyes', 'Garcia', 'Mendoza', 'Bautista', 'Aquino', 'Ramos', 'Castro', 'Rivera'];

function uuid(prefix: number, n: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

export function generate(size: ScaleSize): Record<string, Row[]> {
  const random = rng(42);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const day = (ms: number) => iso(ms).slice(0, 10);

  const barangays = Array.from({ length: size.barangays }, (_, i) => ({
    barangay_id: uuid(1, i),
    name: `Barangay ${String(i + 1).padStart(2, '0')}`,
    code: null,
    is_active: true,
    created_at: iso(now),
    updated_at: iso(now),
    created_by: null,
  }));
  const puroks = barangays.flatMap((barangay, b) =>
    Array.from({ length: size.puroksPer }, (_, i) => ({
      purok_id: uuid(2, b * size.puroksPer + i),
      barangay_id: barangay.barangay_id,
      name: `Purok ${i + 1}`,
      code: null,
      is_active: true,
      created_at: iso(now),
      updated_at: iso(now),
      created_by: 'seed',
    })),
  );
  const households = Array.from({ length: size.households }, (_, i) => {
    const purok = puroks[i % puroks.length];

    return {
      household_id: uuid(3, i),
      household_number: `HH-${String(i + 1).padStart(5, '0')}`,
      purok_id: purok.purok_id,
      barangay_id: purok.barangay_id,
      toilet_type: [],
      water_source: [],
      food_production: [],
      health_status_notes: null,
      created_at: iso(now - 200 * DAY),
      updated_at: iso(now - Math.floor(random() * 200) * DAY),
    };
  });
  const individuals = households.flatMap((household, h) =>
    Array.from({ length: size.residentsPer }, (_, i) => ({
      resident_id: uuid(4, h * size.residentsPer + i),
      household_id: household.household_id,
      first_name: pick(FIRST),
      last_name: pick(LAST),
      sex: random() < 0.5 ? 'female' : 'male',
      birthday: day(now - Math.floor(random() * 80 * 365) * DAY),
      is_household_head: i === 0,
      status: random() < 0.95 ? 'active' : 'moved_out',
      occupation: null,
      educational_attainment: null,
      is_out_of_school_youth: false,
      is_pregnant_nursing_fp: false,
      philhealth_number: null,
      created_at: iso(now - 200 * DAY),
      updated_at: iso(now - Math.floor(random() * 200) * DAY),
    })),
  );
  const health_assessments = Array.from({ length: size.assessments }, (_, i) => {
    const illness = pick(ILLNESS);

    return {
      assessment_id: uuid(5, i),
      resident_id: individuals[Math.floor(random() * individuals.length)].resident_id,
      assessment_date: day(now - Math.floor(random() * 360) * DAY),
      weight: 50,
      height: 160,
      bmi: 19.5,
      nutrition_status: pick(NUTRITION),
      systolic_bp: 110 + Math.floor(random() * 40),
      diastolic_bp: 70 + Math.floor(random() * 20),
      temperature_c: 36.5,
      pulse_rate: 72,
      vaccination_status: pick(VACCINATION),
      health_complications: random() < 0.3 ? [pick(COMPLICATIONS)] : [],
      primary_illness: illness,
      illness_other: illness === 'other' ? pick(['Measles', 'Chickenpox', '']) : null,
      created_at: iso(now),
      updated_at: iso(now),
    };
  });
  const inventory_items = barangays.flatMap((barangay, b) =>
    Array.from({ length: 15 }, (_, i) => ({
      item_id: uuid(6, b * 15 + i),
      item_name: `Supply item ${String(i + 1).padStart(2, '0')}`,
      type: i % 2 ? 'medicine' : 'supply',
      current_stock: Math.floor(random() * 200),
      reorder_level: 20,
      barangay_id: barangay.barangay_id,
      created_at: iso(now),
      updated_at: iso(now),
    })),
  );
  const profiles = barangays.flatMap((barangay, b) => [
    { user_id: uuid(7, b * 10), role: 'barangay_admin', barangay_id: barangay.barangay_id, full_name: `Admin ${b + 1}`, is_active: true },
    ...Array.from({ length: 6 }, (_, i) => ({
      user_id: uuid(7, b * 10 + i + 1),
      role: 'bhw',
      barangay_id: null,
      full_name: `Health Worker ${b + 1}-${i + 1}`,
      is_active: true,
    })),
  ]).map((profile) => ({ ...profile, created_at: iso(now), updated_at: iso(now), created_by: null, disabled_at: null, disabled_by: null }));
  const bhws = profiles.filter((profile) => profile.role === 'bhw');
  const inventory_allocations = Array.from({ length: 4000 }, (_, i) => ({
    allocation_id: uuid(8, i),
    item_id: inventory_items[Math.floor(random() * inventory_items.length)].item_id,
    bhw_id: pick(bhws).user_id,
    quantity: 5,
    reason: 'seed',
    allocated_by: 'seed',
    allocated_at: iso(now - Math.floor(random() * 300) * DAY),
  }));
  const supply_disbursements = Array.from({ length: size.releases }, (_, i) => ({
    log_id: uuid(9, i),
    item_id: inventory_items[Math.floor(random() * inventory_items.length)].item_id,
    resident_id: individuals[Math.floor(random() * individuals.length)].resident_id,
    disbursement_date: day(now - Math.floor(random() * 360) * DAY),
    quantity: 1 + Math.floor(random() * 3),
    bhw_id: pick(bhws).user_id,
    created_at: iso(now),
    updated_at: iso(now),
  }));
  const barangayName = new Map(barangays.map((barangay) => [barangay.barangay_id, barangay.name]));
  const purokOf = new Map(puroks.map((purok) => [purok.purok_id, purok]));
  const account_rows = profiles.map((profile, i) => {
    const purok = profile.role === 'bhw' ? puroks[i % puroks.length] : null;

    return {
      ...profile,
      purok_id: purok?.purok_id ?? null,
      purok_name: purok?.name ?? null,
      assigned_since: purok ? iso(now) : null,
      scope_barangay_id: purok ? purokOf.get(purok.purok_id)!.barangay_id : profile.barangay_id,
    };
  });
  const inventory_item_rows = inventory_items.map((item) => ({
    ...item,
    barangay_name: barangayName.get(item.barangay_id) ?? null,
    is_low: item.reorder_level > 0 && item.current_stock <= item.reorder_level,
  }));
  const bhw_item_stock = inventory_allocations.slice(0, 1500).map((allocation) => {
    const item = inventory_items.find((candidate) => candidate.item_id === allocation.item_id)!;

    return { bhw_id: allocation.bhw_id, item_id: item.item_id, item_name: item.item_name, type: item.type, barangay_id: item.barangay_id, current_stock: 5, updated_at: iso(now) };
  });

  const householdOf = new Map(households.map((household) => [household.household_id, household]));
  const resident_rows = individuals.map((person) => {
    const household = householdOf.get(person.household_id)!;

    return {
      ...person,
      household_number: household.household_number,
      barangay_id: household.barangay_id,
      purok_id: household.purok_id,
      barangay_name: barangayName.get(household.barangay_id) ?? null,
    };
  });

  return {
    barangays,
    puroks,
    resident_rows,
    households,
    individuals,
    health_assessments,
    inventory_items,
    inventory_allocations,
    supply_disbursements,
    profiles,
    account_rows,
    inventory_item_rows,
    bhw_item_stock,
  };
}

/** Splits on commas outside parentheses. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') depth--;
    if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function test(value: unknown, op: string, raw: string): boolean {
  const text = value === null || value === undefined ? null : String(value);

  switch (op) {
    case 'eq':
      return text === raw;
    case 'neq':
      return text !== raw;
    case 'gt':
      return text !== null && text > raw;
    case 'gte':
      return text !== null && text >= raw;
    case 'lt':
      return text !== null && text < raw;
    case 'lte':
      return text !== null && text <= raw;
    case 'is':
      return raw === 'null' ? text === null : text === raw;
    case 'in':
      return raw.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).includes(text ?? '');
    case 'ilike':
    case 'like': {
      const pattern = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*')}$`, 'i');
      return text !== null && pattern.test(text);
    }
    default:
      return true;
  }
}

/** `col.op.value` inside an `or=(...)`. */
function orClause(row: Row, clause: string): boolean {
  const [col, op, ...rest] = clause.split('.');
  return test(row[col], op, rest.join('.'));
}

export type Traffic = { requests: number; bytes: number; urls: string[] };

export async function serveScaleBackend(page: Page, data: Record<string, Row[]>, signedIn: { userId: string; role: string; barangayId: string | null }): Promise<Traffic> {
  const traffic: Traffic = { requests: 0, bytes: 0, urls: [] };
  const households = new Map(data.households.map((row) => [row.household_id as string, row]));

  const reply = async (route: Route, body: unknown, headers: Record<string, string> = {}) => {
    const text = JSON.stringify(body);
    traffic.requests++;
    traffic.bytes += text.length;
    traffic.urls.push(route.request().url().replace(/^.*\/rest\/v1\//, '').slice(0, 120));
    await route.fulfill({ status: 200, contentType: 'application/json', headers, body: text });
  };

  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/rest\/v1\//, '');

    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      const args = route.request().postDataJSON() ?? {};

      if (name === 'current_barangay_id') return reply(route, signedIn.barangayId);
      if (name === 'resident_health_page') return reply(route, residentHealthPage(data, households, args));
      return reply(route, null);
    }

    let rows = data[path] ?? [];

    if (path === 'profiles' && url.searchParams.get('user_id') === `eq.${signedIn.userId}`) {
      rows = [{ user_id: signedIn.userId, role: signedIn.role, is_active: true, full_name: 'Test Account', barangay_id: signedIn.barangayId }];
    }

    const select = url.searchParams.get('select') ?? '*';
    const embedsHousehold = select.includes('households!inner');

    if (embedsHousehold) {
      rows = rows.map((row) => ({ ...row, households: households.get(row.household_id as string) }));
    }

    for (const [key, value] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;

      if (key === 'or') {
        const clauses = splitTop(value.replace(/^\(|\)$/g, ''));
        rows = rows.filter((row) => clauses.some((clause) => orClause(row, clause)));
        continue;
      }

      const [op, ...rest] = value.split('.');
      const raw = rest.join('.');

      if (key.startsWith('health_assessments.')) continue;

      if (key.startsWith('households.')) {
        const column = key.slice('households.'.length);
        rows = rows.filter((row) => test((row.households as Row | undefined)?.[column], op, raw));
        continue;
      }

      rows = rows.filter((row) => test(row[key], op, raw));
    }

    const order = url.searchParams.get('order');

    if (order) {
      const keys = order.split(',').map((part) => {
        const [col, dir] = part.split('.');
        return { col, desc: dir === 'desc' };
      });

      rows = [...rows].sort((a, b) => {
        for (const { col, desc } of keys) {
          const x = String(a[col] ?? '');
          const y = String(b[col] ?? '');
          if (x !== y) return (x < y ? -1 : 1) * (desc ? -1 : 1);
        }
        return 0;
      });
    }

    const columns = splitTop(select).filter((column) => !column.includes('('));

    if (!columns.includes('*')) {
      const embeds = splitTop(select).filter((column) => column.includes('(')).map((column) => column.split('!')[0]);
      rows = rows.map((row) => Object.fromEntries([...columns, ...embeds].map((column) => [column, row[column]])));
    }

    const total = rows.length;
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    const pageRows = rows.slice(offset, offset + Math.min(limit, 1000));
    // Cross-origin, so the count header is only readable when exposed, as Supabase does.
    const headers: Record<string, string> = { 'access-control-expose-headers': 'content-range' };

    if ((route.request().headers()['prefer'] ?? '').includes('count=exact')) {
      headers['content-range'] = `${offset}-${offset + pageRows.length - 1}/${total}`;
    }

    return reply(route, pageRows, headers);
  });

  return traffic;
}

function residentHealthPage(data: Record<string, Row[]>, households: Map<string, Row>, args: Row) {
  const latest = new Map<string, { row: Row; checks: number }>();

  for (const row of data.health_assessments) {
    const date = row.assessment_date as string;
    if (date < (args.period_from as string) || date > (args.period_to as string)) continue;
    const held = latest.get(row.resident_id as string);
    if (!held) latest.set(row.resident_id as string, { row, checks: 1 });
    else {
      held.checks++;
      if (date > (held.row.assessment_date as string)) held.row = row;
    }
  }

  const people = new Map(data.individuals.map((row) => [row.resident_id as string, row]));
  const names = new Map(data.barangays.map((row) => [row.barangay_id as string, row.name as string]));
  const rows = [...latest.entries()]
    .map(([id, held]) => {
      const person = people.get(id)!;
      const household = households.get(person.household_id as string)!;
      return { person, household, held };
    })
    .filter(({ household }) => !args.scope_barangay_id || household.barangay_id === args.scope_barangay_id)
    .sort((a, b) => String(a.person.last_name).localeCompare(String(b.person.last_name)));
  const offset = Number(args.page_offset ?? 0);

  return rows.slice(offset, offset + Number(args.page_limit ?? 10)).map(({ person, household, held }) => ({
    resident_id: person.resident_id,
    household_id: person.household_id,
    first_name: person.first_name,
    last_name: person.last_name,
    sex: person.sex,
    birthday: person.birthday,
    household_number: household.household_number,
    barangay_name: names.get(household.barangay_id as string) ?? 'Unassigned',
    checks: held.checks,
    latest: held.row,
    total_count: rows.length,
  }));
}
