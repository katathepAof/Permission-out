# MOD 2 Supabase handoff

เอกสารนี้สำหรับผู้ดูแล Supabase ของหน่วยงานปลายทาง ผู้ดูแลต้องดำเนินการบนเครื่องและบัญชีของ
หน่วยงานเอง ไม่ต้องส่ง Database password, Personal Access Token หรือ service-role key กลับมา

## สิ่งที่ต้องมี

- Node.js 20 หรือใหม่กว่า
- Supabase project ที่เปิดใช้ Authentication และ PostGIS
- ตาราง `profiles` ที่มีคอลัมน์ `role` และ `is_active`
- ผู้ใช้อย่างน้อยหนึ่งรายที่ `role = 'admin'` และ `is_active = true`
- Project URL, Project Ref และ server-side Secret key/service-role key

## ไฟล์ที่ใช้

- `supabase/migrations/20260724120000_mod2_site_facility.sql`
- `scripts/import-mod2-sites.mjs`
- `UIH sites 2026 sync 5 - Copy.html`
- `package.json` และ `package-lock.json`

## 1. ติดตั้ง Migration

1. เปิด Supabase Dashboard ของหน่วยงาน
2. ไปที่ SQL Editor และสร้าง Query ใหม่
3. วางเนื้อหาทั้งหมดจาก `supabase/migrations/20260724120000_mod2_site_facility.sql`
4. ตรวจว่าเลือก Project และ Database role ถูกต้อง
5. กด Run

Migration จะสร้าง Private Storage bucket `permission-out-mod2-data`, ตาราง `mod2_*`, RLS,
spatial indexes และ RPC สำหรับ Import, Publish และ Query ข้อมูล

## 2. ตั้งค่า Credentials เฉพาะบนเครื่องหน่วยงาน

สร้าง `API_Key.txt` ที่ root ของ project ไฟล์นี้ถูก `.gitignore` และห้าม commit:

```dotenv
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=ใส่-server-side-secret-key-ของหน่วยงาน
SUPABASE_PROJECT_REF=PROJECT_REF
```

ใช้ Publishable/anon key แทน Secret keyไม่ได้ เพราะการ Import ต้องเขียน Private Storage และ
ตาราง staging ผ่านสิทธิ์ฝั่ง Server

ถ้าต้องการระบุ Admin ผู้ดำเนินการอย่างชัดเจน ให้ตั้ง environment variable:

```powershell
$env:MOD2_IMPORT_ACTOR_ID = "UUID-ของ-Admin"
```

## 3. ตรวจข้อมูลโดยไม่เชื่อมต่อ Supabase

```powershell
npm ci
npm run data:prepare-mod2-sites
```

ผลที่ถูกต้อง:

```text
sites: 2009
uniqueSiteCodes: 2009
invalidCoordinates: 0
```

ไฟล์มาตรฐานจะถูกสร้างที่ `data-out/mod2-sites/v1/sites.json`

## 4. Import และ Publish

```powershell
$env:MOD2_SUPABASE_PROJECT_REF = "PROJECT_REF"
npm run data:import-mod2-sites
```

คำสั่งจะ:

1. ตรวจว่า URL ตรงกับ Project Ref ที่กำหนด
2. ตรวจว่า Migration ถูกติดตั้งแล้ว
3. อัปโหลด JSON ต้นฉบับเข้า Private Storage
4. สร้าง staging version
5. Import ครั้งละ 250 sites
6. คำนวณ New, Updated, Removed และ Unchanged
7. Publish version เป็น `active`
8. ตรวจจำนวน Remote ว่าครบ 2,009 แถว

คำสั่งเป็น idempotent: หาก SHA-256 เดิมถูกนำเข้าแล้ว จะไม่สร้าง Version ซ้ำ

## 5. ตรวจผลใน SQL Editor

```sql
select
  dataset.code,
  version.version_no,
  version.status,
  version.row_count,
  version.new_count,
  version.updated_count,
  version.removed_count,
  version.unchanged_count,
  version.published_at
from public.mod2_site_datasets dataset
join public.mod2_site_versions version
  on version.id = dataset.active_version_id
where dataset.code = 'site-facility-2026';

select
  count(*) as sites,
  count(distinct site.site_code) as unique_site_codes,
  count(*) filter where not extensions.st_isvalid(site.geom) as invalid_geometry
from public.mod2_sites site
join public.mod2_site_datasets dataset
  on dataset.active_version_id = site.version_id
where dataset.code = 'site-facility-2026';
```

ผลที่ถูกต้อง:

```text
status              active
row_count           2009
sites               2009
unique_site_codes   2009
invalid_geometry    0
```

## ข้อควรระวัง

- ห้ามนำ `SUPABASE_SECRET_KEY` ไปใส่ใน HTML, JavaScript ฝั่ง Browser หรือ Git
- ห้ามเปลี่ยน Storage bucket เป็น Public
- User ฝั่งเว็บควรอ่านข้อมูลผ่าน authenticated session เท่านั้น
- เก็บ Migration และ SHA-256 ของไฟล์ Import ไว้ในเอกสารเปลี่ยนแปลงของหน่วยงาน
- ก่อน Import รุ่นถัดไปควรสำรองฐานข้อมูลตามนโยบายของหน่วยงาน
