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
- Supabase-required ใน Production: Cloudflare build จะหยุดทันทีหากไม่ได้กำหนด URL/Key ป้องกันการเปิดระบบโดยไม่มี Cloud Sync
- PWA/offline shell, responsive UI, print layout และ security headers

## ตั้งค่า Supabase

1. สร้าง Supabase project แล้วเปิด **SQL Editor**
2. รันไฟล์ [`supabase/schema.sql`](supabase/schema.sql) ทั้งไฟล์
3. ใน **Authentication → URL Configuration** กำหนด Site URL เป็นโดเมน Cloudflare Pages และเพิ่ม localhost/preview URLs ที่ต้องใช้
4. ใช้ Project URL และ Publishable key (หรือ legacy anon key) เท่านั้น ห้ามนำ `service_role` key มาใส่ฝั่งเว็บ

## ทดสอบและ Build

ต้องใช้ Node.js 20 ขึ้นไป และไม่มี package dependency ที่ต้องติดตั้ง

```bash
npm run check
npm run build
```

ผลลัพธ์อยู่ใน `dist/` การ build ในเครื่องโดยไม่มี environment variables ใช้ตรวจ UI ได้ แต่ Cloudflare Pages build จะบังคับให้มี Supabase configuration

## Deploy บน Cloudflare Workers Static Assets

เชื่อม repository กับ Cloudflare Workers Builds แล้วตั้งค่า:

| ค่า | กำหนดเป็น |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 20 หรือใหม่กว่า |

เพิ่ม Environment variables ใน Workers Build Settings:

- `SUPABASE_URL` = Project URL
- `SUPABASE_PUBLISHABLE_KEY` = Publishable key (รองรับ `SUPABASE_ANON_KEY` เป็น fallback)

ไฟล์ build จะสร้าง `app-config.js` จาก environment variables โดยอัตโนมัติ และจะหยุด build หากไม่ได้กำหนดค่าทั้งสองตัว กุญแจดังกล่าวเป็น public client key และการป้องกันข้อมูลทำโดย Row Level Security ในฐานข้อมูล

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
- `_headers` — CSP และ security headers สำหรับ Cloudflare
- `sw.js` — offline application shell

## Checklist ก่อนเปิดใช้งานจริง

- เปิด Email confirmation และกำหนด SMTP ขององค์กรใน Supabase
- ตรวจ URL redirect ของ Production/Preview
- ทดสอบ RLS ด้วยผู้ใช้สองบัญชีให้แน่ใจว่าไม่เห็นโครงการข้ามบัญชี
- เปิด Cloudflare Web Analytics/Logpush ตามนโยบายองค์กร
- กำหนด retention และ backup/PITR ของ Supabase ตาม SLA
- หากไฟล์เส้นทางมีข้อมูลอ่อนไหว ให้คงการประมวลผลฝั่ง client ตามค่าเริ่มต้น และทบทวนนโยบายการเก็บ snapshot ก่อนเปิด Cloud Sync
