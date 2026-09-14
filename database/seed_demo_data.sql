-- Demo data: households, residents, health checks, immunizations, and supplies for every barangay.
-- Keeps barangays, puroks, accounts, and assignments; wipes and regenerates everything else. Rerunnable.

begin;

-- The stamping triggers read auth.uid(), which a script has none of. This also skips FK checks.
set local session_replication_role = replica;

select setseed(0.20260915);

delete from public.supply_disbursements;
delete from public.immunizations;
delete from public.health_assessments;
delete from public.individuals;
delete from public.households;
delete from public.inventory_allocations;
delete from public.inventory_items;
delete from public.audit_events where entity_table in ('inventory_items', 'inventory_allocations');

create function pg_temp.pick(anyarray) returns anyelement language sql volatile
  as $$ select $1[1 + floor(random() * array_length($1, 1))::int] $$;

create function pg_temp.rint(lo int, hi int) returns int language sql volatile
  as $$ select lo + floor(random() * (hi - lo + 1))::int $$;

create function pg_temp.rnum(lo numeric, hi numeric) returns numeric language sql volatile
  as $$ select lo + random()::numeric * (hi - lo) $$;

create function pg_temp.born(years int) returns date language sql volatile
  as $$ select (current_date - make_interval(years => years, days => pg_temp.rint(0, 364)))::date $$;

-- Rough Filipino growth curve; `offset_cm` is the resident's lifelong deviation from it.
create function pg_temp.height_cm(sex text, born date, on_day date, offset_cm numeric) returns numeric language sql immutable as $$
  select round(case
    when m < 12 then 50 + m * 2.1 + offset_cm * 0.2
    when m < 24 then 75 + (m - 12) * 1.0 + offset_cm * 0.3
    when m < 144 then 87 + (m - 24) / 12.0 * 6.3 + offset_cm * 0.6
    when sex = 'female' then least(150 + (m - 144) / 12.0 * 1.5, 152) + offset_cm
    else least(150 + (m - 144) / 12.0 * 3.5, 164) + offset_cm
  end, 1)
  from (select (extract(year from age(on_day, born)) * 12 + extract(month from age(on_day, born)))::numeric as m) as months
$$;

create function pg_temp.add_member(
  p_household uuid, p_first text, p_middle text, p_last text, p_sex text, p_born date,
  p_head boolean, p_relationship text, p_writer uuid, p_recorded_on timestamptz
) returns void language plpgsql as $$
declare
  resident uuid := gen_random_uuid();
  years int := extract(year from age(current_date, p_born));
  osy boolean := years between 15 and 24 and random() < 0.15;
  expecting boolean := p_sex = 'female' and years between 15 and 49 and random() < case when years between 19 and 38 then 0.3 else 0.08 end;
  giver uuid := coalesce(p_writer, (select user_id from public.profiles where role = 'admin' and is_active order by created_at limit 1));
  height_offset numeric := pg_temp.rnum(-6, 6);
  disabled boolean := random() < 0.015;
  roll float := random();
  member_status text := 'active';
  status_on date;
  education text;
  occupation text;
  target_bmi numeric;
  chronic text := 'none';
  vaccination text;
  first_seen date;
  last_seen date;
  visits int;
  visit_on date;
  h numeric;
  w numeric;
  b numeric;
  illness text;
  complications text[];
  covid_on date;
begin
  if not p_head then
    member_status := case
      when years >= 70 and roll < 0.1 then 'deceased'
      when roll < 0.03 then 'moved_out'
      when roll < 0.045 then 'transferred'
      else 'active'
    end;
  end if;

  if member_status <> 'active' then
    status_on := p_recorded_on::date + pg_temp.rint(20, greatest(20, current_date - p_recorded_on::date - 5));
  end if;

  education := case
    when years < 5 then 'none'
    when years < 12 then 'elementary'
    when years < 16 then 'high_school'
    when years < 18 then 'senior_high'
    when osy then pg_temp.pick(array['elementary', 'high_school', 'high_school'])
    when years < 25 then pg_temp.pick(array['senior_high', 'senior_high', 'college', 'vocational'])
    else pg_temp.pick(array['elementary', 'high_school', 'high_school', 'senior_high', 'vocational', 'college', 'college', 'post_graduate'])
  end;

  occupation := case
    when years < 5 then null
    when osy then pg_temp.pick(array['None', 'Laborer', 'Vendor', 'Farm Helper'])
    when years < 18 then 'Student'
    when years < 23 and education in ('senior_high', 'college', 'vocational') and random() < 0.6 then 'Student'
    when years >= 65 then pg_temp.pick(array['Retired', 'Retired', 'Farmer', 'None'])
    when p_sex = 'male' then pg_temp.pick(array['Farmer', 'Farmer', 'Tricycle Driver', 'Construction Worker', 'Carpenter', 'Fisherfolk', 'Laborer', 'Driver', 'Security Guard', 'Government Employee', 'OFW'])
    else pg_temp.pick(array['Housekeeper', 'Housekeeper', 'Vendor', 'Sari-sari Store Owner', 'Teacher', 'Farmer', 'Nurse', 'Seamstress', 'Office Clerk', 'OFW'])
  end;

  insert into public.individuals (
    resident_id, household_id, first_name, middle_name, last_name, sex, birthday, is_household_head, relationship_to_head,
    occupation, educational_attainment, is_out_of_school_youth, is_pregnant_nursing_fp, philhealth_number,
    status, status_changed_on, updated_by, created_at, updated_at
  ) values (
    resident, p_household, p_first, p_middle, p_last, p_sex, p_born, p_head, p_relationship,
    occupation, education, osy, expecting,
    case when random() < 0.88 then lpad(floor(random() * 1e12)::bigint::text, 12, '0') end,
    member_status, status_on, p_writer, greatest(p_recorded_on, p_born::timestamptz), coalesce(status_on::timestamptz, greatest(p_recorded_on, p_born::timestamptz))
  );

  roll := random();
  target_bmi := case
    when years < 20 then pg_temp.rnum(14.5, 18.5) - case when random() < 0.12 then 1.5 else 0 end
    when roll < 0.12 then pg_temp.rnum(16.6, 18.4)
    when roll < 0.66 then pg_temp.rnum(18.6, 24.8)
    when roll < 0.89 then pg_temp.rnum(25.1, 29.8)
    else pg_temp.rnum(30.2, 35)
  end;

  if years >= 40 and random() < (0.2 + case when target_bmi >= 30 then 0.15 else 0 end) then chronic := 'hypertension';
  elsif years >= 40 and random() < 0.09 then chronic := 'diabetes';
  elsif random() < 0.04 then chronic := 'asthma';
  elsif years >= 18 and random() < 0.012 then chronic := 'tuberculosis';
  end if;

  vaccination := case
    when years < 6 then pg_temp.pick(array['complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'partial', 'partial', 'partial', 'none'])
    when years < 18 then pg_temp.pick(array['complete', 'complete', 'complete', 'partial', 'unknown'])
    else pg_temp.pick(array['complete', 'complete', 'partial', 'partial', 'unknown', 'none'])
  end;

  first_seen := greatest(p_recorded_on::date, p_born);
  last_seen := coalesce(status_on, current_date);
  visits := least(case when years < 5 then pg_temp.rint(3, 5) else pg_temp.rint(1, 3) end, greatest(1, (last_seen - first_seen) / 30));

  if last_seen >= first_seen then
    for i in 1..visits loop
      visit_on := first_seen + (last_seen - first_seen) * i / visits - pg_temp.rint(0, least(14, (last_seen - first_seen) / visits));
      h := pg_temp.height_cm(p_sex, p_born, visit_on, height_offset);
      b := greatest(11, target_bmi + pg_temp.rnum(-0.8, 0.8));
      w := round(b * (h / 100) ^ 2, 1);
      b := round(w / (h / 100) ^ 2, 2);

      illness := case
        when random() < 0.03 then 'dengue'
        when random() < case when years < 5 then 0.06 else 0.02 end then 'diarrhea'
        when (years < 5 or years >= 65) and random() < 0.04 then 'pneumonia'
        when random() < 0.03 then 'skin_infection'
        when random() < 0.03 then 'other'
        else chronic
      end;

      complications := array_remove(array[
        case when years < 5 and b < 14 then 'wasting' end,
        case when years < 5 and height_offset < -4 then 'stunting' end,
        case when (expecting and random() < 0.25) or random() < 0.04 then 'anemia' end,
        case when chronic = 'hypertension' and random() < 0.06 then 'edema' end,
        case when disabled then 'disability' end,
        case when years >= 45 and random() < 0.15 then 'vision_problem' end,
        case when years >= 65 and random() < 0.1 then 'hearing_problem' end,
        case when years >= 5 and random() < 0.07 then 'dental_problem' end,
        case when chronic = 'tuberculosis' or random() < 0.015 then 'chronic_cough' end,
        case when expecting and random() < 0.15 then 'pregnancy_risk' end
      ]::text[], null);

      insert into public.health_assessments (
        resident_id, assessment_date, weight, height, bmi, nutrition_status, vaccination_status, health_complications,
        primary_illness, illness_other, systolic_bp, diastolic_bp, temperature_c, pulse_rate, created_at, updated_at
      ) values (
        resident, visit_on, w, h, b,
        case when b < 18.5 then 'underweight' when b < 25 then 'normal' when b < 30 then 'overweight' else 'obese' end,
        vaccination, complications, illness,
        case when illness = 'other' then pg_temp.pick(array['Arthritis', 'Gout', 'Urinary tract infection', 'Influenza', 'Allergic rhinitis', 'Peptic ulcer']) end,
        case when years >= 3 then case when chronic = 'hypertension' then pg_temp.rint(138, 168) when years < 10 then pg_temp.rint(85, 110) when years < 18 then pg_temp.rint(95, 118) else pg_temp.rint(102, 130) end end,
        case when years >= 3 then case when chronic = 'hypertension' then pg_temp.rint(88, 104) when years < 10 then pg_temp.rint(50, 70) when years < 18 then pg_temp.rint(58, 76) else pg_temp.rint(66, 86) end end,
        round(case when illness in ('dengue', 'pneumonia') then pg_temp.rnum(37.8, 39.4) else pg_temp.rnum(36.2, 37.3) end, 1),
        case when years < 5 then pg_temp.rint(90, 140) when years < 12 then pg_temp.rint(75, 115) else pg_temp.rint(60, 98) end,
        visit_on + make_interval(hours => pg_temp.rint(8, 15)), visit_on + make_interval(hours => 16)
      );
    end loop;
  end if;

  -- DOH EPI schedule by days after birth; a partial record stops somewhere along it.
  if years < 13 and vaccination in ('complete', 'partial') then
    insert into public.immunizations (resident_id, vaccine_name, dose_number, date_given, given_by, created_at, updated_at)
    select resident, s.vaccine, s.dose, given.day, giver, given.day + time '10:00', given.day + time '10:00'
    from (values
      (1, 'BCG', 1, 0), (2, 'Hepatitis B', 1, 0),
      (3, 'Penta (DPT-HepB-Hib)', 1, 42), (4, 'OPV', 1, 42), (5, 'PCV', 1, 42),
      (6, 'Penta (DPT-HepB-Hib)', 2, 70), (7, 'OPV', 2, 70), (8, 'PCV', 2, 70),
      (9, 'Penta (DPT-HepB-Hib)', 3, 98), (10, 'OPV', 3, 98), (11, 'PCV', 3, 98), (12, 'IPV', 1, 98),
      (13, 'MMR', 1, 270), (14, 'MMR', 2, 365),
      (15, 'Td/Tdap', 1, 2557), (16, 'Td/Tdap', 2, 4383)
    ) as s(seq, vaccine, dose, due_day)
    cross join lateral (select p_born + s.due_day + pg_temp.rint(0, 10) as day) as given
    where s.seq <= case when vaccination = 'complete' then 99 else pg_temp.rint(2, 11) end
      and given.day <= current_date;
  end if;

  if years >= 23 and vaccination in ('complete', 'partial') then
    covid_on := date '2021-06-01' + pg_temp.rint(0, 180);
    insert into public.immunizations (resident_id, vaccine_name, dose_number, date_given, given_by, created_at, updated_at)
    values (resident, 'COVID-19', 1, covid_on, giver, p_recorded_on, p_recorded_on);

    if vaccination = 'complete' then
      insert into public.immunizations (resident_id, vaccine_name, dose_number, date_given, given_by, created_at, updated_at)
      values (resident, 'COVID-19', 2, covid_on + pg_temp.rint(28, 56), giver, p_recorded_on, p_recorded_on);
    end if;
  end if;

  if expecting and member_status = 'active' then
    covid_on := current_date - pg_temp.rint(40, 200);
    insert into public.immunizations (resident_id, vaccine_name, dose_number, date_given, given_by, created_at, updated_at)
    values (resident, 'Td/Tdap', 1, covid_on, giver, covid_on + time '10:00', covid_on + time '10:00'),
           (resident, 'Td/Tdap', 2, covid_on + 28, giver, (covid_on + 28) + time '10:00', (covid_on + 28) + time '10:00');
  end if;
end;
$$;

do $$
declare
  male_names text[] := array['Juan', 'Jose', 'Pedro', 'Rolando', 'Ernesto', 'Danilo', 'Ricardo', 'Eduardo', 'Romeo', 'Antonio',
    'Manuel', 'Roberto', 'Rogelio', 'Fernando', 'Arnel', 'Jericho', 'Mark Anthony', 'John Paul', 'Christian', 'Jomar', 'Renato',
    'Nestor', 'Alfredo', 'Carlito', 'Wilfredo', 'Joel', 'Rodel', 'Jayson', 'Kenneth', 'Angelo', 'Miguel', 'Gabriel', 'Nathaniel',
    'Joshua', 'Paolo', 'Rafael', 'Benjie', 'Efren', 'Dominador', 'Leonardo'];
  female_names text[] := array['Maria', 'Elena', 'Josefina', 'Rosario', 'Teresita', 'Lorna', 'Marites', 'Marilou', 'Erlinda',
    'Corazon', 'Remedios', 'Gloria', 'Luzviminda', 'Analyn', 'Jennifer', 'Rowena', 'Maricel', 'Divina', 'Cristina', 'Angelica',
    'Kristine', 'Mary Grace', 'Jocelyn', 'Rhea', 'Princess', 'Althea', 'Andrea', 'Sofia', 'Nicole', 'Janine', 'Liza',
    'Evangeline', 'Imelda', 'Nenita', 'Felicidad', 'Precious', 'Hazel', 'Jasmine', 'Camille', 'Leonora'];
  surnames text[] := array['Agustin', 'Addun', 'Ancheta', 'Aquino', 'Balubal', 'Bangayan', 'Baquiran', 'Bautista', 'Cabildo',
    'Cabral', 'Calimag', 'Carag', 'Castillo', 'Cortez', 'Cruz', 'Dayag', 'Dela Cruz', 'Domingo', 'Furigay', 'Galang', 'Garcia',
    'Guzman', 'Lasam', 'Liban', 'Macanas', 'Mallillin', 'Mamauag', 'Mendoza', 'Pagulayan', 'Pascual', 'Ramos', 'Reyes',
    'Santos', 'Soriano', 'Taguba', 'Taguinod', 'Tolentino', 'Tuliao', 'Tumaliuan', 'Ubina', 'Urbano', 'Villanueva', 'Zipagan'];
  purok record;
  writer uuid;
  household uuid;
  recorded_on timestamptz;
  surname text;
  head_sex text;
  head_age int;
  head_maiden text;
  spouse_age int;
  spouse_maiden text;
  mother_maiden text;
  mother_age int;
  child_sex text;
  parent_sex text;
  household_count int;
  child_count int;
begin
  for purok in
    select p.purok_id, p.barangay_id, b.code,
      coalesce(nullif(regexp_replace(p.name, '\D', '', 'g'), ''), '1') as number,
      exists (select 1 from public.profiles pr where pr.barangay_id = b.barangay_id and pr.role = 'barangay_admin') as staffed
    from public.puroks p
    join public.barangays b on b.barangay_id = p.barangay_id
    where p.is_active and b.is_active
    order by b.name, p.name
  loop
    writer := (select a.bhw_id from public.bhw_purok_assignments a where a.purok_id = purok.purok_id
      order by a.ended_at is null desc, a.started_at desc limit 1);

    household_count := case when purok.staffed then pg_temp.rint(18, 26) else pg_temp.rint(6, 12) end;
    for n in 1..household_count loop
      household := gen_random_uuid();
      recorded_on := now() - make_interval(days => pg_temp.rint(45, 365), hours => pg_temp.rint(0, 9));

      insert into public.households (
        household_id, household_number, toilet_type, water_source, food_production,
        purok_id, barangay_id, recorded_by, updated_by, created_at, updated_at
      ) values (
        household,
        format('%s-P%s-%s', purok.code, purok.number, lpad(n::text, 3, '0')),
        array[pg_temp.pick(array['water_sealed', 'water_sealed', 'water_sealed', 'water_sealed', 'water_sealed', 'pit_latrine', 'pit_latrine', 'shared', 'shared', 'none'])],
        (select array_agg(distinct source) from unnest(array[
          pg_temp.pick(array['water_district', 'water_district', 'deep_well', 'artesian_well', 'bottled', 'spring_river']),
          pg_temp.pick(array['water_district', 'deep_well', 'artesian_well', 'bottled', 'bottled', 'spring_river'])]) as source),
        case when random() < 0.15 then array['none'] else (select array_agg(distinct kind) from unnest(array[
          pg_temp.pick(array['garden', 'livestock', 'farming']),
          pg_temp.pick(array['garden', 'livestock', 'farming'])]) as kind) end,
        purok.purok_id, purok.barangay_id, writer, writer, recorded_on, recorded_on
      );

      surname := pg_temp.pick(surnames);
      head_sex := case when random() < 0.8 then 'male' else 'female' end;
      head_age := pg_temp.rint(24, 72);
      head_maiden := pg_temp.pick(surnames);
      perform pg_temp.add_member(household,
        pg_temp.pick(case when head_sex = 'male' then male_names else female_names end),
        head_maiden, surname, head_sex, pg_temp.born(head_age), true, null, writer, recorded_on);

      mother_maiden := case when head_sex = 'female' then head_maiden else pg_temp.pick(surnames) end;
      mother_age := case when head_sex = 'female' then head_age end;

      if random() < (case when head_sex = 'male' then 0.9 else 0.35 end) then
        spouse_age := greatest(20, head_age + pg_temp.rint(-7, 3));
        spouse_maiden := pg_temp.pick(surnames);
        perform pg_temp.add_member(household,
          pg_temp.pick(case when head_sex = 'male' then female_names else male_names end),
          spouse_maiden, surname, case when head_sex = 'male' then 'female' else 'male' end,
          pg_temp.born(spouse_age), false, 'spouse', writer, recorded_on);
        if head_sex = 'male' then
          mother_maiden := spouse_maiden;
          mother_age := spouse_age;
        end if;
      end if;

      mother_age := coalesce(mother_age, head_age - 2);
      child_count := case when mother_age >= 19 then pg_temp.rint(0, 5) else 0 end;
      for c in 1..child_count loop
        child_sex := pg_temp.pick(array['male', 'female']);
        perform pg_temp.add_member(household,
          pg_temp.pick(case when child_sex = 'male' then male_names else female_names end),
          mother_maiden, surname, child_sex, pg_temp.born(pg_temp.rint(0, least(mother_age - 19, 28))),
          false, 'child', writer, recorded_on);
      end loop;

      if head_age < 50 and random() < 0.15 then
        parent_sex := case when random() < 0.65 then 'female' else 'male' end;
        perform pg_temp.add_member(household,
          pg_temp.pick(case when parent_sex = 'male' then male_names else female_names end),
          case when parent_sex = 'female' then head_maiden else pg_temp.pick(surnames) end,
          surname, parent_sex, pg_temp.born(head_age + pg_temp.rint(22, 34)), false, 'parent', writer, recorded_on);
      end if;

      if random() < 0.06 then
        child_sex := pg_temp.pick(array['male', 'female']);
        perform pg_temp.add_member(household,
          pg_temp.pick(case when child_sex = 'male' then male_names else female_names end),
          pg_temp.pick(surnames), surname, child_sex, pg_temp.born(greatest(18, head_age + pg_temp.rint(-10, 6))),
          false, 'sibling', writer, recorded_on);
      end if;

      if random() < 0.08 then
        child_sex := pg_temp.pick(array['male', 'female']);
        perform pg_temp.add_member(household,
          pg_temp.pick(case when child_sex = 'male' then male_names else female_names end),
          pg_temp.pick(surnames), pg_temp.pick(surnames), child_sex, pg_temp.born(pg_temp.rint(4, 22)),
          false, 'other_relative', writer, recorded_on);
      end if;

      if random() < 0.03 then
        perform pg_temp.add_member(household, pg_temp.pick(female_names), pg_temp.pick(surnames), pg_temp.pick(surnames),
          'female', pg_temp.born(pg_temp.rint(18, 45)), false, 'unrelated', writer, recorded_on);
      end if;
    end loop;
  end loop;
end;
$$;

-- Household notes summarise what each active member's latest check found.
with latest as (
  select distinct on (a.resident_id) i.household_id, a.primary_illness, a.illness_other, a.health_complications
  from public.health_assessments a
  join public.individuals i on i.resident_id = a.resident_id
  where i.status = 'active'
  order by a.resident_id, a.assessment_date desc
), findings as (
  select household_id, replace(finding, '_', ' ') as finding, count(*) as members
  from latest
  cross join lateral unnest(array_remove(array[case
    when primary_illness = 'other' then lower(illness_other)
    when primary_illness <> 'none' then primary_illness
  end], null) || health_complications) as finding
  group by 1, 2
)
update public.households h
set health_status_notes = coalesce(
  (select 'Noted at last visit: ' || string_agg(format('%s (%s)', f.finding, f.members), ', ' order by f.members desc, f.finding) || '.'
   from findings f where f.household_id = h.household_id),
  'No health concerns noted at the last visit.');

do $$
declare
  item record;
  bhw record;
  allocation uuid;
  allocated_on timestamptz;
  quantity int;
  left_to_give int;
  given int;
  resident uuid;
begin
  insert into public.inventory_items (barangay_id, item_name, type, reorder_level, current_stock, created_at, updated_at)
  select b.barangay_id, t.name, t.type, t.reorder,
    case when random() < 0.2 then pg_temp.rint(0, t.reorder) else t.reorder * pg_temp.rint(2, 5) end,
    now() - interval '180 days', now() - make_interval(days => pg_temp.rint(1, 30))
  from public.barangays b
  cross join (values
    ('Paracetamol 500mg', 'medicine', 50), ('Amoxicillin 500mg', 'medicine', 40),
    ('Ferrous Sulfate + Folic Acid', 'medicine', 40), ('Vitamin A Capsule', 'medicine', 30),
    ('Oral Rehydration Salts', 'medicine', 30), ('Zinc Sulfate Syrup', 'medicine', 15),
    ('Losartan 50mg', 'medicine', 90), ('Metformin 500mg', 'medicine', 90),
    ('Micronutrient Powder', 'food', 30), ('Rice Pack 5kg', 'food', 20),
    ('Hygiene Kit', 'hygiene', 15), ('Face Masks (box)', 'hygiene', 10),
    ('Digital BP Monitor', 'equipment', 1), ('Weighing Scale', 'equipment', 1),
    ('Condoms (box)', 'other', 10)
  ) as t(name, type, reorder)
  where b.is_active;

  for bhw in
    select a.bhw_id, a.purok_id, p.barangay_id,
      (select pr.user_id from public.profiles pr
       where pr.role = 'barangay_admin' and pr.barangay_id = p.barangay_id and pr.is_active
       order by pr.created_at limit 1) as admin_id
    from public.bhw_purok_assignments a
    join public.puroks p on p.purok_id = a.purok_id
    join public.profiles me on me.user_id = a.bhw_id and me.role = 'bhw' and me.is_active
    where a.ended_at is null
  loop
    continue when bhw.admin_id is null;

    for month_back in 0..2 loop
      allocated_on := least(now() - interval '1 day', date_trunc('month', now()) - make_interval(months => month_back) + interval '2 days 9 hours');

      for item in
        select i.item_id, i.item_name, i.type,
          case i.item_name when 'Losartan 50mg' then 30 when 'Metformin 500mg' then 60 when 'Paracetamol 500mg' then 10
            when 'Amoxicillin 500mg' then 21 when 'Ferrous Sulfate + Folic Acid' then 30 when 'Oral Rehydration Salts' then 4
            when 'Zinc Sulfate Syrup' then 1 when 'Vitamin A Capsule' then 1 when 'Micronutrient Powder' then 15 else 1 end as per_release
        from public.inventory_items i
        where i.barangay_id = bhw.barangay_id and i.type in ('medicine', 'food', 'hygiene') and random() < 0.7
      loop
        quantity := item.per_release * pg_temp.rint(4, 10);

        insert into public.inventory_allocations (item_id, bhw_id, quantity, reason, allocated_by, allocated_at)
        values (item.item_id, bhw.bhw_id, quantity, 'Monthly field allocation', bhw.admin_id, allocated_on)
        returning allocation_id into allocation;

        insert into public.audit_events (occurred_at, actor_user_id, actor_role, action, entity_table, entity_id, reason, metadata)
        values (allocated_on, bhw.admin_id, 'barangay_admin', 'inventory.allocated', 'inventory_allocations', allocation,
          'Monthly field allocation', jsonb_build_object('item_id', item.item_id, 'bhw_id', bhw.bhw_id, 'quantity', quantity));

        left_to_give := floor(quantity * pg_temp.rnum(0.4, 0.85));

        while left_to_give > 0 loop
          given := least(left_to_give, item.per_release);

          select i.resident_id into resident
          from public.individuals i
          join public.households h on h.household_id = i.household_id
          where h.purok_id = bhw.purok_id and i.status = 'active'
            and case item.item_name
              when 'Vitamin A Capsule' then i.birthday > current_date - interval '5 years'
              when 'Zinc Sulfate Syrup' then i.birthday > current_date - interval '5 years'
              when 'Micronutrient Powder' then i.birthday > current_date - interval '2 years'
              when 'Ferrous Sulfate + Folic Acid' then i.is_pregnant_nursing_fp
              when 'Losartan 50mg' then exists (select 1 from public.health_assessments a where a.resident_id = i.resident_id and a.primary_illness = 'hypertension')
              when 'Metformin 500mg' then exists (select 1 from public.health_assessments a where a.resident_id = i.resident_id and a.primary_illness = 'diabetes')
              when 'Rice Pack 5kg' then i.is_household_head
              when 'Hygiene Kit' then i.is_household_head
              else true
            end
          order by random()
          limit 1;

          exit when resident is null;

          insert into public.supply_disbursements (item_id, resident_id, disbursement_date, quantity, bhw_id, created_at, updated_at)
          values (item.item_id, resident, allocated_on::date + pg_temp.rint(0, least(27, current_date - allocated_on::date)),
            given, bhw.bhw_id, allocated_on, allocated_on);

          left_to_give := left_to_give - given;
        end loop;
      end loop;
    end loop;
  end loop;
end;
$$;

commit;
