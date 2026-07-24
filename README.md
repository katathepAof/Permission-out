# Permission Out

เว็บแอประดับ production สำหรับเปรียบเทียบข้อมูลเส้นทาง PEA และ UFM วิเคราะห์ New / Same / Remove คำนวณจำนวนเสาและค่าบริการรายปี แสดงผลบนแผนที่ และอ่านชุดข้อมูลกลางจาก Supabase

## ความสามารถหลัก

- นำเข้า KML/KMZ หลายไฟล์ แยกชุดฐานและชุดเปรียบเทียบ
- วิเคราะห์ระยะใกล้เคียงด้วย threshold/interval และตัดเส้นซ้ำแบบเลือกได้
- แผนที่ Leaflet, ค้นหาชื่อเส้นทางหรือพิกัด, ระบุจังหวัดแบบออฟไลน์
- ตัวกรองจังหวัด สถานะสาย และระดับการทับซ้อน
- คำนวณเสา, diameter, อัตราค่าพาดสาย, surcharge และยอดรวมแบบ real-time
- Export CSV, KML และ KMZ ตามตัวกรอง พร้อมรหัส/ชื่อ/ประเภทพื้นที่ PEA ของแต่ละเส้นทาง และแนบ Polygon พื้นที่ PEA ใน KML/KMZ
- ระบบบัญชี Supabase Auth และสิทธิ์ Admin สำหรับจัดการผู้ใช้งาน
- โครงสร้างแบบหลายโมดูล โดย MOD 1 ใช้วิเคราะห์ PEA/UFM และสามารถเพิ่ม MOD 2 โดยใช้ Supabase project เดียวกันได้
- Supabase-required ใน Production: Cloudflare Worker สร้าง runtime config จาก Variables and Secrets และหน้าแอปจะแจ้งเตือนหากตั้งค่าไม่ครบ
- PWA/offline shell, responsive UI, print layout และ security headers
- Bundle Supabase JS, Leaflet และ JSZip ภายใน deployment ไม่พึ่งพา third-party JavaScript CDN

## ตั้งค่า Supabase

1. สร้าง Supabase project แล้วเปิด **SQL Editor**
2. รันไฟล์ [`supabase/schema.sql`](supabase/schema.sql) ทั้งไฟล์
3. รัน [`supabase/migrations/20260723100000_billing_engine.sql`](supabase/migrations/20260723100000_billing_engine.sql) เพื่อสร้างสูตรคำนวณกลางแบบมีเวอร์ชัน, RPC สำหรับคำนวณรายรายการ/แบบชุด และตาราง audit
4. ใน **Authentication → URL Configuration** กำหนด Site URL เป็นโดเมน Cloudflare Pages และเพิ่ม localhost/preview URLs ที่ต้องใช้
5. ใช้ Project URL และ Publishable key (หรือ legacy anon key) เท่านั้น ห้ามนำ `service_role` key มาใส่ฝั่งเว็บ

### ระบบ Login และ Admin User Management

1. รัน migration [`supabase/migrations/20260723130000_user_administration.sql`](supabase/migrations/20260723130000_user_administration.sql) ใน Supabase SQL Editor เพื่อให้ `profiles` มีคอลัมน์สิทธิ์สำหรับรายงานและการเชื่อมต่อกับระบบอื่น
2. สร้างผู้ใช้คนแรกใน **Authentication → Users** แล้วกำหนดให้เป็น Admin ด้วย SQL:

```sql
update public.profiles
set role = 'admin', is_active = true
where id = (select id from auth.users where email = 'admin@your-company.com');
```

3. ใน Cloudflare Worker → **Settings → Variables and Secrets** เพิ่ม:

- `SUPABASE_SERVICE_ROLE_KEY` เป็นชนิด **Secret** เท่านั้น

Service-role key ใช้เฉพาะภายใน Cloudflare Worker สำหรับ `/api/admin/users` และไม่ถูกส่งไปยัง Browser หรือ `bootstrap.js` ระบบจะตรวจ Supabase access token, สถานะบัญชี และสิทธิ์ `admin` ทุกคำขอ รวมถึงป้องกัน Admin ลบบัญชีตนเองหรือลดจำนวน Admin ที่ใช้งานได้เหลือศูนย์

Worker บันทึกสิทธิ์หลักไว้ใน Supabase Auth `app_metadata` (`permission_out_role` และ `permission_out_active`) และซิงก์ลง `profiles` เมื่อ Schema รองรับ จึง Login และจัดการผู้ใช้ได้แม้ฐานเดิมยังไม่ได้เพิ่มสองคอลัมน์ดังกล่าว แต่ยังควรรัน migration เพื่อให้หน่วยงานอื่น query สิทธิ์จากฐานข้อมูลกลางได้โดยตรง

บัญชีใหม่ต้องสร้างจากเมนู **บัญชีผู้ใช้ → จัดการผู้ใช้** โดย Admin การสมัครบัญชีด้วยตนเองจากหน้าเว็บถูกปิดไว้ ผู้ใช้ยังสามารถขอลิงก์ตั้งรหัสผ่านใหม่ผ่านหน้า Login ได้

### ระบบอัปเดตข้อมูล PEA/UFM สำหรับ Admin

1. รัน migration [`supabase/migrations/20260723150000_dataset_versioning.sql`](supabase/migrations/20260723150000_dataset_versioning.sql)
2. Migration จะสร้าง Private Storage bucket `permission-out-admin-data` และตาราง:
   - `managed_datasets`
   - `managed_dataset_versions`
   - `managed_dataset_features`
   - `managed_dataset_audit`
3. Admin เปิดเมนู **บัญชีผู้ใช้ → จัดการข้อมูล PEA / UFM**
4. เลือกประเภทข้อมูลและอัปโหลดไฟล์ `.kml`/`.kmz` ได้หลายไฟล์ ไฟล์ละไม่เกิน 100 MB
5. ระบบเก็บไฟล์ต้นฉบับแบบ Private, แปลงเส้นทางเป็น Feature batches และเปรียบเทียบกับ Active version
6. ตรวจจำนวน `เพิ่ม / เปลี่ยน / ลบ / เหมือนเดิม` ก่อนกด Publish

ชื่อไฟล์เดิมจะอ้างถึง Dataset เดิมแต่สร้างเวอร์ชันใหม่เสมอ ข้อมูลที่ผู้ใช้เห็นจะไม่เปลี่ยนระหว่างนำเข้า เมื่อ Publish ระบบจะสลับ `active_version_id` แบบ Transaction และสามารถย้อนกลับ Archived version ได้ ไฟล์ที่ไม่ได้อัปโหลดจะไม่ถูกลบอัตโนมัติ

หน้าวิเคราะห์จะรวม Active managed datasets เข้ากับ Storage manifest เดิม และแทนที่รายการชื่อเดียวกันด้วยเวอร์ชันที่ Admin เผยแพร่แล้วเท่านั้น User อ่านข้อมูลผ่าน Worker API ที่ตรวจ Supabase access token; การอัปโหลด นำเข้า Publish และ Rollback ตรวจสิทธิ์ `admin` ทุกคำขอ

## ทดสอบและ Build

ต้องใช้ Node.js 20 ขึ้นไป และไม่มี package dependency ที่ต้องติดตั้ง

```bash
npm run check
npm run build
```

ทดสอบ UX/UI แบบ Local พร้อมข้อมูล Supabase:

```bash
npm run build:local
npm run preview
```

`build:local` อ่านเฉพาะ `SUPABASE_URL` และ `SUPABASE_PUBLISHABLE_KEY` จาก `API_Key.txt`
เพื่อสร้าง `dist/bootstrap.js` ชั่วคราว โดยไม่อ่านหรือส่ง `service_role`/secret key ไปยังหน้าเว็บ
ทั้ง `API_Key.txt` และ `dist/` ถูกละเว้นโดย Git และห้ามนำขึ้น repository

ผลลัพธ์อยู่ใน `dist/` ส่วน `src/worker.js` จะอ่าน Supabase configuration ตอน runtime จึงไม่ต้องเปิดเผยค่าให้ build process

## Deploy บน Cloudflare Workers Static Assets

เชื่อม repository กับ Cloudflare Workers Builds แล้วตั้งค่า:

| ค่า | กำหนดเป็น |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 20 หรือใหม่กว่า |

เพิ่ม Environment variables ที่ **Worker → Settings → Variables and Secrets** (runtime variables ไม่ใช่ Build variables):

- `SUPABASE_URL` = Project URL
- `SUPABASE_PUBLISHABLE_KEY` = Publishable key (รองรับ `SUPABASE_ANON_KEY` เป็น fallback)
- `SUPABASE_SERVICE_ROLE_KEY` = Service-role key โดยต้องตั้งเป็น **Secret** ห้ามตั้งเป็น plaintext variable

Worker จะสร้าง `/bootstrap.js` แบบ `no-store` จาก environment variables ตอน runtime และมี `/api/health` สำหรับตรวจสถานะโดยไม่เปิดเผยค่า credentials กุญแจดังกล่าวเป็น public client key และการป้องกันข้อมูลทำโดย Row Level Security ในฐานข้อมูล

`keep_vars = true` ใน `wrangler.toml` จะรักษา Variables and Secrets ที่ตั้งผ่าน Dashboard ไม่ให้ถูก `wrangler deploy` ลบหรือเขียนทับ

สามารถ deploy ผ่าน Wrangler ได้หลัง login:

```bash
npm run build
npx wrangler deploy
```

## โครงสร้างสำคัญ

- `Permission_Out.html` — แกนวิเคราะห์และหน้าหลัก
- `production.js` / `production.css` — MOD 1, Supabase datasets, auth และ UI production
- `admin-users.js` / `admin-users.css` — หน้าจัดการผู้ใช้สำหรับ Admin
- `admin-data.js` / `admin-data.css` — อัปโหลด Staging, ตรวจ Diff, Publish และ Rollback ข้อมูล PEA/UFM
- `supabase/schema.sql` — ตาราง, indexes, triggers, grants และ RLS policies
- `scripts/build.mjs` — สร้าง static bundle และ inject public Supabase config
- `src/worker.js` — runtime config, health endpoint และ static-assets fallback
- `_headers` — CSP และ security headers สำหรับ Cloudflare
- `sw.js` — offline application shell

## UIH spatial data

- KMZ ต้นฉบับเก็บใน Supabase Storage ที่ `uih-20072026/v1/kmz/` สำหรับตรวจสอบย้อนหลังและใช้งานกับ Google Earth
- หน้าเว็บเลือกด้วย Dataset ID และจะดาวน์โหลดข้อมูลแบบ compact gzip เมื่อกดวิเคราะห์เท่านั้น (`analysis/*.json.gz`)
- ข้อมูลสำหรับส่งต่อเป็น GeoJSON ตาม RFC 7946 + gzip (`exchange/*.geojson.gz`) พร้อม `data-dictionary.csv`, SHA-256, CRS และ metadata ใน `manifest.json`
- PostGIS schema, GiST spatial index และ API แบบแบ่งหน้าอยู่ใน `supabase/migrations/20260722190000_uih_postgis.sql`
- หลัง apply migration ให้รัน `npm run data:import-uih-postgis` เพื่อนำ geometry เข้าตารางที่ค้นหาเชิงพื้นที่ได้

## UFM comparison data

- ไฟล์ KML/KMZ ต้นฉบับจากโฟลเดอร์ `UFM` ถูกแปลงและจัดเก็บใน Supabase Storage ที่ `ufm/v1/`
- หน้าเว็บแสดงรายการไฟล์เปรียบเทียบเป็น checkbox เลือกพร้อมกันได้หลายชุด และดาวน์โหลด compact gzip เฉพาะตอนกดวิเคราะห์
- `analysis/*.json.gz` ใช้สำหรับวิเคราะห์บนเว็บอย่างรวดเร็ว ส่วน `exchange/*.geojson.gz` เป็น GeoJSON ตาม RFC 7946 สำหรับส่งต่อหน่วยงานอื่น
- ตัวโหลดจะแตก metadata ที่ฝังใน `description` ของ UFM เช่น Code, Status, Type, Core, Measured และ Calculated เพื่อแสดงในตาราง/Popup และแนบไปกับ Export
- `manifest.json` มีจำนวนเส้น ขนาดไฟล์ SHA-256 และ CRS ส่วน `data-dictionary.csv` อธิบายโครงสร้างข้อมูล
- เตรียมข้อมูลด้วย `npm run data:prepare-ufm` และอัปโหลดด้วย `npm run data:upload-ufm`

## สูตรคำนวณกลางและข้อมูลพื้นที่ PEA ใน Export

- สูตร `permission_fee` เก็บแบบ versioned ใน `billing_formula_versions` และหน้าเว็บอ่านสูตร active ผ่าน `get_active_billing_formula`
- ระบบอื่นเรียก `calculate_permission_fee_v1` สำหรับหนึ่งรายการ หรือ `calculate_permission_fee_batch_v1` สำหรับหลายรายการได้ โดยผลลัพธ์ระบุ `formula_code` และ `formula_version`
- การคำนวณแบบชุดรวมต้นทุนที่ยังไม่ปัดเศษก่อน แล้วปัดเฉพาะยอดสรุป 2 ตำแหน่งให้ตรงกับหน้าเว็บและ Export
- ตอน Export ระบบจะ densify เส้นทุกประมาณ 0.02 องศาและโหลดเฉพาะ PEA chunk ที่เป็นผู้สมัครของจุดเหล่านั้น จึงครอบคลุมเส้นที่ผ่านหลายพื้นที่โดยไม่เพิ่มภาระในการเปิดหน้าเว็บและการวิเคราะห์ปกติ
- CSV ระบุ PEA Area ID, ชื่อ, ประเภทสำนักงาน และวิธีจับคู่ต่อเส้น ส่วน KML/KMZ แนบทั้งข้อมูลดังกล่าวและ Polygon เพื่อให้หน่วยงานอื่นนำไปใช้ต่อได้

## Checklist ก่อนเปิดใช้งานจริง

- เปิด Email confirmation และกำหนด SMTP ขององค์กรใน Supabase
- ตรวจ URL redirect ของ Production/Preview
- ทดสอบ RLS ด้วยบัญชี User/Admin ให้แน่ใจว่า User อ่านชุดข้อมูลที่อนุญาตได้ แต่แก้ไขข้อมูลกลางหรือสิทธิ์ผู้ใช้งานไม่ได้
- เปิด Cloudflare Web Analytics/Logpush ตามนโยบายองค์กร
- กำหนด retention และ backup/PITR ของ Supabase ตาม SLA
- แยกตาราง, Storage prefix และ RLS ของแต่ละ MOD ให้ชัดเจน แม้จะใช้ Supabase project และระบบ Login เดียวกัน
