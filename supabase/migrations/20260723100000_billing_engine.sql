begin;

create table if not exists public.billing_formula_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version integer not null check (version > 0),
  name text not null,
  description text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default false,
  parameters jsonb not null default '{}'::jsonb,
  formula_expression text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (code, version),
  check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists billing_formula_one_active_per_code
  on public.billing_formula_versions (code) where is_active;

insert into public.billing_formula_versions (
  code, version, name, description, is_active, parameters, formula_expression
)
values (
  'permission_fee',
  1,
  'Permission fee formula v1',
  'สูตรค่าบริการพาดสายกลางของระบบ Permission Out',
  true,
  jsonb_build_object(
    'poles_per_km', 29,
    'rate_baht_per_line_mm_pole', 2.8,
    'surcharge_percent', 5,
    'rounding', 'summary_2_decimals',
    'currency', 'THB'
  ),
  'km=length_m/1000; poles=ceil(km*poles_per_km); item_cost=diameter_mm*poles*rate; subtotal=sum(item_cost); surcharge=subtotal*surcharge_percent/100; total=subtotal+surcharge'
)
on conflict (code, version) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active,
  parameters = excluded.parameters,
  formula_expression = excluded.formula_expression;

create table if not exists public.billing_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  formula_version_id uuid not null references public.billing_formula_versions(id),
  source_system text not null default 'permission-out',
  input_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  input_sha256 text,
  created_at timestamptz not null default now()
);

create index if not exists billing_runs_project_created_idx
  on public.billing_calculation_runs (project_id, created_at desc);
create index if not exists billing_runs_owner_created_idx
  on public.billing_calculation_runs (owner_id, created_at desc);

create table if not exists public.billing_calculation_items (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.billing_calculation_runs(id) on delete cascade,
  item_key text,
  source_file text,
  placemark_name text,
  pea_area_id text,
  pea_area_name text,
  length_m numeric not null check (length_m >= 0),
  diameter_mm numeric not null check (diameter_mm >= 0),
  poles integer not null check (poles >= 0),
  rate numeric not null check (rate >= 0),
  cost_baht numeric not null check (cost_baht >= 0),
  created_at timestamptz not null default now()
);

create index if not exists billing_items_run_idx on public.billing_calculation_items (run_id);
create index if not exists billing_items_pea_area_idx on public.billing_calculation_items (pea_area_id);

alter table public.billing_formula_versions enable row level security;
alter table public.billing_calculation_runs enable row level security;
alter table public.billing_calculation_items enable row level security;

drop policy if exists "Billing formulas are readable" on public.billing_formula_versions;
create policy "Billing formulas are readable"
  on public.billing_formula_versions for select
  to anon, authenticated
  using (true);

drop policy if exists "Owners read billing runs" on public.billing_calculation_runs;
create policy "Owners read billing runs"
  on public.billing_calculation_runs for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Owners create billing runs" on public.billing_calculation_runs;
create policy "Owners create billing runs"
  on public.billing_calculation_runs for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Owners read billing items" on public.billing_calculation_items;
create policy "Owners read billing items"
  on public.billing_calculation_items for select
  to authenticated
  using (exists (
    select 1 from public.billing_calculation_runs r
    where r.id = run_id and r.owner_id = (select auth.uid())
  ));

drop policy if exists "Owners create billing items" on public.billing_calculation_items;
create policy "Owners create billing items"
  on public.billing_calculation_items for insert
  to authenticated
  with check (exists (
    select 1 from public.billing_calculation_runs r
    where r.id = run_id and r.owner_id = (select auth.uid())
  ));

create or replace function public.get_active_billing_formula(p_code text default 'permission_fee')
returns table (
  formula_id uuid,
  code text,
  version integer,
  name text,
  effective_from timestamptz,
  parameters jsonb,
  formula_expression text
)
language sql
stable
security invoker
set search_path = public
as $$
  select id, billing_formula_versions.code, billing_formula_versions.version,
         billing_formula_versions.name, billing_formula_versions.effective_from,
         billing_formula_versions.parameters, billing_formula_versions.formula_expression
  from public.billing_formula_versions
  where billing_formula_versions.code = p_code
    and billing_formula_versions.is_active
    and billing_formula_versions.effective_from <= now()
    and (billing_formula_versions.effective_to is null or billing_formula_versions.effective_to > now())
  order by billing_formula_versions.version desc
  limit 1;
$$;

create or replace function public.calculate_permission_fee_v1(
  p_length_m numeric,
  p_diameter_mm numeric,
  p_rate numeric default 2.8,
  p_poles_per_km numeric default 29,
  p_surcharge_percent numeric default 5
)
returns table (
  formula_code text,
  formula_version integer,
  length_km numeric,
  poles integer,
  diameter_mm numeric,
  rate numeric,
  subtotal_baht numeric,
  surcharge_baht numeric,
  total_baht numeric
)
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_length_km numeric;
  v_poles integer;
  v_subtotal numeric;
begin
  if p_length_m < 0 or p_diameter_mm < 0 or p_rate < 0 or p_poles_per_km < 0 or p_surcharge_percent < 0 then
    raise exception 'Billing inputs must be non-negative';
  end if;
  v_length_km := p_length_m / 1000;
  v_poles := ceil(v_length_km * p_poles_per_km)::integer;
  v_subtotal := p_diameter_mm * v_poles * p_rate;
  return query select
    'permission_fee'::text,
    1,
    v_length_km,
    v_poles,
    p_diameter_mm,
    p_rate,
    round(v_subtotal, 2),
    round(v_subtotal * p_surcharge_percent / 100, 2),
    round(v_subtotal + (v_subtotal * p_surcharge_percent / 100), 2);
end;
$$;

create or replace function public.calculate_permission_fee_batch_v1(
  p_items jsonb,
  p_rate numeric default 2.8,
  p_poles_per_km numeric default 29,
  p_surcharge_percent numeric default 5
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_item_count integer;
  v_total_length_m numeric;
  v_total_poles bigint;
  v_subtotal numeric;
  v_surcharge numeric;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;
  if p_rate < 0 or p_poles_per_km < 0 or p_surcharge_percent < 0 then
    raise exception 'Billing inputs must be non-negative';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where coalesce((item->>'length_m')::numeric, 0) < 0
       or coalesce((item->>'diameter_mm')::numeric, 0) < 0
  ) then
    raise exception 'Item length_m and diameter_mm must be non-negative';
  end if;

  select count(*)::integer,
         coalesce(sum(coalesce((item->>'length_m')::numeric, 0)), 0),
         coalesce(sum(ceil((coalesce((item->>'length_m')::numeric, 0) / 1000) * p_poles_per_km)), 0)::bigint,
         coalesce(sum(
           coalesce((item->>'diameter_mm')::numeric, 0) *
           ceil((coalesce((item->>'length_m')::numeric, 0) / 1000) * p_poles_per_km) *
           p_rate
         ), 0)
    into v_item_count, v_total_length_m, v_total_poles, v_subtotal
  from jsonb_array_elements(p_items) item;

  v_surcharge := v_subtotal * p_surcharge_percent / 100;
  return jsonb_build_object(
    'formula_code', 'permission_fee',
    'formula_version', 1,
    'item_count', v_item_count,
    'total_length_m', v_total_length_m,
    'total_poles', v_total_poles,
    'rate', p_rate,
    'poles_per_km', p_poles_per_km,
    'subtotal_baht', round(v_subtotal, 2),
    'surcharge_percent', p_surcharge_percent,
    'surcharge_baht', round(v_surcharge, 2),
    'total_baht', round(v_subtotal + v_surcharge, 2)
  );
end;
$$;

revoke all on public.billing_formula_versions from public;
revoke all on public.billing_calculation_runs from public;
revoke all on public.billing_calculation_items from public;
grant select on public.billing_formula_versions to anon, authenticated, service_role;
grant select, insert on public.billing_calculation_runs to authenticated, service_role;
grant select, insert on public.billing_calculation_items to authenticated, service_role;
grant usage, select on sequence public.billing_calculation_items_id_seq to authenticated, service_role;
revoke all on function public.get_active_billing_formula(text) from public;
revoke all on function public.calculate_permission_fee_v1(numeric, numeric, numeric, numeric, numeric) from public;
revoke all on function public.calculate_permission_fee_batch_v1(jsonb, numeric, numeric, numeric) from public;
grant execute on function public.get_active_billing_formula(text) to anon, authenticated, service_role;
grant execute on function public.calculate_permission_fee_v1(numeric, numeric, numeric, numeric, numeric) to anon, authenticated, service_role;
grant execute on function public.calculate_permission_fee_batch_v1(jsonb, numeric, numeric, numeric) to anon, authenticated, service_role;

comment on function public.calculate_permission_fee_v1 is
  'Canonical Permission Out fee calculation RPC. Clients must persist formula_code and formula_version with exported or audited results.';

comment on function public.calculate_permission_fee_batch_v1 is
  'Canonical batch RPC. It sums unrounded item costs and rounds only the summary, matching the Permission Out UI and exports.';

commit;
