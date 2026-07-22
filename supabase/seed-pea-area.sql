-- Run after uploading "PEA Area.kmz" to the root of the
-- Supabase Storage bucket named "reference-layers".

insert into public.reference_layers (
  name,
  description,
  storage_bucket,
  storage_path,
  file_type,
  style,
  is_active,
  display_order
)
values (
  'เขตพื้นที่การไฟฟ้าส่วนภูมิภาค (PEA)',
  'ชั้นข้อมูลขอบเขตพื้นที่อ้างอิงจากไฟล์ PEA Area.kmz',
  'reference-layers',
  'PEA Area.kmz',
  'kmz',
  '{"color":"#7c3aed","fillColor":"#8b5cf6","fillOpacity":0.12,"opacity":0.9,"weight":2}'::jsonb,
  true,
  10
)
on conflict (storage_path) do update set
  name = excluded.name,
  description = excluded.description,
  storage_bucket = excluded.storage_bucket,
  file_type = excluded.file_type,
  style = excluded.style,
  is_active = excluded.is_active,
  display_order = excluded.display_order,
  updated_at = now();
