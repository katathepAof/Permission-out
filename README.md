# Permission Out

เว็บแอประดับ production สำหรับเปรียบเทียบเส้นทางเคเบิลจาก KML/KMZ วิเคราะห์ New / Same / Remove คำนวณจำนวนเสาและค่าบริการรายปี แสดงผลบนแผนที่ และจัดเก็บโครงการผ่าน Supabase

## ความสามารถหลัก

- นำเข้า KML/KMZ หลายไฟล์ แยกชุดฐานและชุดเปรียบเทียบ
- วิเคราะห์ระยะใกล้เคียงด้วย threshold/interval และตัดเส้นซ้ำแบบเลือกได้
- แผนที่ Leaflet, ค้นหาชื่อเส้นทางหรือพิกัด, ระบุจังหวัดแบบออฟไลน์
- ตัวกรองจังหวัด สถานะสาย และระดับการทับซ้อน
- คำนวณเสา, diameter, อัตราค่าพาดสาย, surcharge และยอดรวมแบบ real-time
- Export CSV, KML และ KMZ ตามตัวกรอง
- ระบบบัญชี Supabase Auth, โครงการส่วนตัว, Cloud Sync และประวัติการวิเคราะห์
- Supabase-required ใน Production: Cloudflare Worker สร้าง runtime config จาก Variables and Secrets และหน้าแอปจะแจ้งเตือนหากตั้งค่าไม่ครบ
- PWA/offline shell, responsive UI, print layout และ security headers
- Bundle Supabase JS, Leaflet และ JSZip ภายใน deployment ไม่พึ่งพา third-party JavaScript CDN

## ตั้งค่า Supabase

1. สร้าง Supabase project แล้วเปิด **SQL Editor**
2. รันไฟล์ [`supabase/schema.sql`](supabase/schema.sql) ทั้งไฟล์
3. ใน **Authentication → URL Configuration** กำหนด Site URL เป็นโดเมน Cloudflare Pages และเพิ่ม localhost/preview URLs ที่ต้องใช้
4. ใช้ Project URL และ Publishable key (หรือ legacy anon key) เท่านั้น ห้ามนำ `service_role` key มาใส่ฝั่งเว็บ

### เพิ่มชั้นข้อมูล PEA Area

1. รัน `supabase/schema.sql` เวอร์ชันล่าสุดเพื่อสร้างตาราง `reference_layers` และ Storage bucket `reference-layers`
2. เปิด **Storage → reference-layers** ใน Supabase Dashboard แล้วอัปโหลด `PEA Area.kmz` ไว้ที่ root ของ bucket
3. รัน [`supabase/seed-pea-area.sql`](supabase/seed-pea-area.sql) ใน SQL Editor เพื่อเพิ่ม metadata
4. กลับมาที่หน้าแอป กดปุ่มรีเฟรชข้าง dropdown **ชั้นข้อมูลอ้างอิง** แล้วเลือก “เขตพื้นที่การไฟฟ้าส่วนภูมิภาค (PEA)”

ไฟล์ KMZ ถูกเก็บใน Supabase Storage ส่วนตาราง PostgreSQL เก็บเฉพาะ metadata เพื่อให้ดาวน์โหลดและแสดงผลได้รวดเร็ว โดยไม่เพิ่ม binary ขนาดใหญ่ลงในแถวฐานข้อมูล

## ทดสอบและ Build

ต้องใช้ Node.js 20 ขึ้นไป และไม่มี package dependency ที่ต้องติดตั้ง

```bash
npm run check
npm run build
```

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

Worker จะสร้าง `/bootstrap.js` แบบ `no-store` จาก environment variables ตอน runtime และมี `/api/health` สำหรับตรวจสถานะโดยไม่เปิดเผยค่า credentials กุญแจดังกล่าวเป็น public client key และการป้องกันข้อมูลทำโดย Row Level Security ในฐานข้อมูล

`keep_vars = true` ใน `wrangler.toml` จะรักษา Variables and Secrets ที่ตั้งผ่าน Dashboard ไม่ให้ถูก `wrangler deploy` ลบหรือเขียนทับ

สามารถ deploy ผ่าน Wrangler ได้หลัง login:

```bash
npm run build
npx wrangler deploy
```

## โครงสร้างสำคัญ

- `Permission_Out.html` — แกนวิเคราะห์และหน้าหลัก
- `production.js` / `production.css` — workspace, auth, projects, autosave และ UI production
- `supabase/schema.sql` — ตาราง, indexes, triggers, grants และ RLS policies
- `scripts/build.mjs` — สร้าง static bundle และ inject public Supabase config
- `src/worker.js` — runtime config, health endpoint และ static-assets fallback
- `_headers` — CSP และ security headers สำหรับ Cloudflare
- `sw.js` — offline application shell

## Checklist ก่อนเปิดใช้งานจริง

- เปิด Email confirmation และกำหนด SMTP ขององค์กรใน Supabase
- ตรวจ URL redirect ของ Production/Preview
- ทดสอบ RLS ด้วยผู้ใช้สองบัญชีให้แน่ใจว่าไม่เห็นโครงการข้ามบัญชี
- เปิด Cloudflare Web Analytics/Logpush ตามนโยบายองค์กร
- กำหนด retention และ backup/PITR ของ Supabase ตาม SLA
- หากไฟล์เส้นทางมีข้อมูลอ่อนไหว ให้คงการประมวลผลฝั่ง client ตามค่าเริ่มต้น และทบทวนนโยบายการเก็บ snapshot ก่อนเปิด Cloud Sync
