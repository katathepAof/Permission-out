begin;

update public.billing_formula_versions set is_active = false, effective_to = coalesce(effective_to, now()) where code = 'permission_fee' and is_active;
insert into public.billing_formula_versions (code, version, name, description, is_active, effective_from, parameters, formula_expression)
values ('permission_fee', 2, 'Permission fee formula v2', 'ใช้จำนวนเสาจากข้อมูลต้นทางเมื่อมีค่า มิฉะนั้นคำนวณจากระยะทาง', true, now(), jsonb_build_object('poles_per_km', 29, 'rate_baht_per_line_mm_pole', 2.8, 'surcharge_percent', 5, 'pole_count_precedence', 'provided_then_distance'), 'poles=coalesce(existing_poles,ceil((length_m/1000)*poles_per_km)); item_cost=diameter_mm*poles*rate')
on conflict (code, version) do update set name = excluded.name, description = excluded.description, is_active = excluded.is_active, effective_from = excluded.effective_from, effective_to = null, parameters = excluded.parameters, formula_expression = excluded.formula_expression;

drop function if exists public.calculate_permission_fee_v1(numeric, numeric, numeric, numeric, numeric);
create function public.calculate_permission_fee_v1(p_length_m numeric, p_diameter_mm numeric, p_rate numeric default 2.8, p_poles_per_km numeric default 29, p_surcharge_percent numeric default 5, p_existing_poles integer default null)
returns table (formula_code text, formula_version integer, length_km numeric, poles integer, pole_source text, diameter_mm numeric, rate numeric, subtotal_baht numeric, surcharge_baht numeric, total_baht numeric)
language plpgsql immutable security invoker set search_path = public as $$
declare v_length_km numeric; v_poles integer; v_subtotal numeric;
begin
  if p_length_m < 0 or p_diameter_mm < 0 or p_rate < 0 or p_poles_per_km < 0 or p_surcharge_percent < 0 or p_existing_poles < 0 then raise exception 'Billing inputs must be non-negative'; end if;
  v_length_km := p_length_m / 1000;
  v_poles := coalesce(p_existing_poles, ceil(v_length_km * p_poles_per_km)::integer);
  v_subtotal := p_diameter_mm * v_poles * p_rate;
  return query select 'permission_fee'::text, 2, v_length_km, v_poles, case when p_existing_poles is null then 'distance' else 'provided' end, p_diameter_mm, p_rate, round(v_subtotal, 2), round(v_subtotal * p_surcharge_percent / 100, 2), round(v_subtotal + (v_subtotal * p_surcharge_percent / 100), 2);
end;
$$;

create or replace function public.calculate_permission_fee_batch_v1(p_items jsonb, p_rate numeric default 2.8, p_poles_per_km numeric default 29, p_surcharge_percent numeric default 5)
returns jsonb language plpgsql immutable security invoker set search_path = public as $$
declare v_item_count integer; v_total_length_m numeric; v_total_poles bigint; v_provided_pole_items integer; v_subtotal numeric; v_surcharge numeric;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a JSON array'; end if;
  if p_rate < 0 or p_poles_per_km < 0 or p_surcharge_percent < 0 then raise exception 'Billing inputs must be non-negative'; end if;
  select count(*)::integer, coalesce(sum(coalesce((item->>'length_m')::numeric, 0)), 0), coalesce(sum(coalesce(nullif(item->>'poles', '')::integer, ceil((coalesce((item->>'length_m')::numeric, 0) / 1000) * p_poles_per_km))), 0)::bigint, count(*) filter (where nullif(item->>'poles', '') is not null), coalesce(sum(coalesce((item->>'diameter_mm')::numeric, 0) * coalesce(nullif(item->>'poles', '')::integer, ceil((coalesce((item->>'length_m')::numeric, 0) / 1000) * p_poles_per_km)) * p_rate), 0) into v_item_count, v_total_length_m, v_total_poles, v_provided_pole_items, v_subtotal from jsonb_array_elements(p_items) item;
  v_surcharge := v_subtotal * p_surcharge_percent / 100;
  return jsonb_build_object('formula_code', 'permission_fee', 'formula_version', 2, 'item_count', v_item_count, 'total_length_m', v_total_length_m, 'total_poles', v_total_poles, 'provided_pole_items', v_provided_pole_items, 'distance_calculated_pole_items', v_item_count - v_provided_pole_items, 'rate', p_rate, 'poles_per_km', p_poles_per_km, 'subtotal_baht', round(v_subtotal, 2), 'surcharge_percent', p_surcharge_percent, 'surcharge_baht', round(v_surcharge, 2), 'total_baht', round(v_subtotal + v_surcharge, 2));
end;
$$;

revoke all on function public.calculate_permission_fee_v1(numeric, numeric, numeric, numeric, numeric, integer) from public;
grant execute on function public.calculate_permission_fee_v1(numeric, numeric, numeric, numeric, numeric, integer) to anon, authenticated, service_role;
commit;
