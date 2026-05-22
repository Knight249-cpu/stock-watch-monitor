# คู่มือย้าย Stock Watch Monitor ไป Deploy ภายนอก

ผู้จัดทำ: **Manus AI**

## ภาพรวมของระบบปัจจุบัน

โปรเจ็กต์นี้เป็นแอปแบบ full-stack ที่ใช้ **React 19 + TypeScript + Vite** สำหรับฝั่งหน้าเว็บ และใช้ **Node.js + Express + tRPC + Drizzle ORM** สำหรับฝั่งเซิร์ฟเวอร์ โดยฐานข้อมูลที่คาดหวังคือ MySQL/TiDB ตามการตั้งค่าในโค้ดและตัวแปรแวดล้อมหลักของระบบ ปัจจุบันหน้า watchlist ใช้ **Server-Sent Events (SSE)** ผ่านปลายทาง `/api/watchlist/stream` เพื่อกระจาย snapshot ราคาหุ้นจากเซิร์ฟเวอร์ไปยังเบราว์เซอร์ที่เชื่อมต่ออยู่ ส่วน logic การดึงราคาและการส่ง LINE alert อยู่ในฝั่งเซิร์ฟเวอร์ภายใต้โมดูล `server/stockData.ts`, `server/watchlistRealtime.ts` และ `server/lineAlerts.ts`

ในรอบนี้มีการเพิ่ม **scheduled endpoint** ใหม่คือ `POST /api/internal/scheduled/watchlist-refresh` ซึ่งใช้ `SCHEDULE_SECRET` สำหรับป้องกันการเรียกโดยไม่ได้รับอนุญาต ปลายทางนี้จะวนประมวลผลผู้ใช้ที่มี watchlist ทั้งหมด, รีเฟรชราคา, ประเมิน cutloss/sale rule, และส่ง LINE alert ตามเงื่อนไขที่ตั้งไว้ ทำให้คุณสามารถย้ายงานอัปเดตทุก 1 นาทีออกจากระบบ Manus ไปอยู่บน cron service หรือ worker ภายนอกได้โดยตรง

## สิ่งที่ต้องเข้าใจก่อนย้ายออกจาก Manus

แม้ Manus จะมีระบบโฮสต์ในตัวและรองรับ custom domain แต่เนื่องจากคุณต้องการย้ายออกไปโฮสต์ภายนอกเอง คู่มือนี้จึงออกแบบให้ทำงานกับ Render หรือ Railway ได้ อย่างไรก็ตาม โปรเจ็กต์นี้ยังพึ่งพา **Manus OAuth** และ environment บางตัวของ Manus อยู่ เช่น `VITE_APP_ID`, `OAUTH_SERVER_URL`, `BUILT_IN_FORGE_API_URL`, และ `BUILT_IN_FORGE_API_KEY` ดังนั้นการย้ายออกไปภายนอกอาจมี **compatibility work** เพิ่มเติม โดยเฉพาะถ้าคุณต้องการเลิกพึ่งระบบ login หรือ API ภายในของ Manus ทั้งหมด คุณควรวางแผนเปลี่ยน auth layer ในระยะถัดไป

## ไฟล์และโมดูลสำคัญ

| ส่วนของระบบ | ไฟล์สำคัญ | หน้าที่ |
| --- | --- | --- |
| Frontend | `client/src/pages/Home.tsx`, `client/src/lib/watchlistStream.ts` | แสดง dashboard, เปิด SSE stream, อัปเดต UI แบบสด |
| Backend API | `server/_core/index.ts`, `server/routers/watchlist.ts` | bootstrap เซิร์ฟเวอร์, เปิด route หลัก, tRPC API |
| ราคาและสัญญาณ | `server/stockData.ts`, `server/watchlistRealtime.ts`, `server/alertRules.ts` | ดึงข้อมูลราคา, cache, คำนวณ cutloss/sale, สร้าง snapshot |
| LINE alerts | `server/lineAlerts.ts` | ส่งข้อความเข้า LINE Messaging API |
| Scheduled runner ใหม่ | `server/scheduledWatchlist.ts` | ประมวลผล refresh ทุกผู้ใช้และเปิด internal scheduled endpoint |
| Database | `server/db.ts`, `drizzle/schema.ts`, `drizzle/*.sql` | query helper, schema, migration |
| Tests | `server/*.test.ts`, `client/src/pages/Home.test.tsx` | unit/integration tests สำหรับ logic หลัก |

## เปรียบเทียบทางเลือกสำหรับ Deploy ภายนอก

| ทางเลือก | เหมาะกับกรณีนี้หรือไม่ | เหตุผลหลัก |
| --- | --- | --- |
| **Render Web Service + Render Cron Job** | **เหมาะที่สุด** | Render รองรับ cron jobs เป็น service แยก, ใช้ environment variables ได้, และรับประกันว่าหนึ่ง cron จะมี active run ได้ครั้งละหนึ่งตัว [1] |
| **Railway Web Service + Railway Background Worker** | **เหมาะเมื่ออยากใช้ Railway จริง ๆ** | Railway cron ไม่เหมาะกับงานที่ต้องถี่กว่า every 5 minutes และเวลาอาจคลาดเคลื่อนได้หลายวินาทีถึงหลายนาที [2] [3] จึงควรใช้ worker ที่ทำงานต่อเนื่องแทน |
| **Railway Cron Job ล้วน** | **ไม่แนะนำสำหรับ requirement นี้** | Railway ระบุชัดว่ารูปแบบ cron ไม่เหมาะเมื่อคุณต้องการความถี่มากกว่า every 5 minutes [2] [3] |

> Render เหมาะกับ requirement “ทุก 1 นาทีตลอด 24 ชั่วโมง” มากกว่า เพราะคุณสามารถแยก web service กับ cron job ได้ตรงตัว ในขณะที่ Railway ควรใช้ worker แบบ always-on หากยังต้องการความถี่ระดับ 1 นาที [1] [3] [4]

## Environment Variables ที่ต้องเตรียม

| ตัวแปร | จำเป็นหรือไม่ | ใช้ทำอะไร |
| --- | --- | --- |
| `DATABASE_URL` | จำเป็น | ใช้เชื่อมฐานข้อมูล MySQL/TiDB |
| `JWT_SECRET` | จำเป็น | ใช้เซ็น session cookie |
| `LINE_CHANNEL_ACCESS_TOKEN` | จำเป็นถ้าจะส่ง LINE | ใช้เรียก LINE Messaging API |
| `SCHEDULE_SECRET` | จำเป็นสำหรับงาน schedule | ใช้ป้องกัน endpoint `POST /api/internal/scheduled/watchlist-refresh` |
| `PORT` | จำเป็นตามแพลตฟอร์ม | ให้ web service ฟังพอร์ตที่แพลตฟอร์มกำหนด |
| `VITE_APP_ID` | จำเป็นถ้ายังใช้ Manus OAuth | app ID สำหรับ flow login เดิม |
| `OAUTH_SERVER_URL` | จำเป็นถ้ายังใช้ Manus OAuth | backend OAuth ของ Manus |
| `OWNER_OPEN_ID` | ใช้ตามระบบเดิม | ช่วยกำหนด owner/admin logic |
| `BUILT_IN_FORGE_API_URL` | อาจจำเป็นหากยังพึ่ง API ภายใน Manus | URL สำหรับบริการภายในของ Manus |
| `BUILT_IN_FORGE_API_KEY` | อาจจำเป็นหากยังพึ่ง API ภายใน Manus | key สำหรับบริการภายในของ Manus |
| `VITE_FRONTEND_FORGE_API_URL` และ `VITE_FRONTEND_FORGE_API_KEY` | อาจจำเป็น | ใช้ในบาง flow ฝั่ง frontend ที่พึ่ง API ภายใน |

ถ้าคุณต้องการให้โปรเจ็กต์นี้กลายเป็นระบบที่ไม่ผูกกับ Manus จริง ๆ ในระยะกลาง ควรแยกงานออกเป็นสองเฟส คือเฟสแรกย้ายโฮสต์และฐานข้อมูลก่อน แล้วเฟสที่สองค่อยเปลี่ยนระบบ auth และ API ภายในที่ยังอิง Manus อยู่

## ขั้นตอน Deploy บน Render

### ขั้นที่ 1: เตรียม repository

ให้นำ ZIP ที่แนบไปแตกไฟล์บนเครื่องของคุณ จากนั้นอัปโหลดขึ้น GitHub หรือ GitLab เป็น repository ใหม่ ถ้าต้องการเก็บประวัติให้สะอาด ควรสร้าง branch ใหม่สำหรับการย้ายออกไปภายนอกโดยเฉพาะ

### ขั้นที่ 2: สร้างฐานข้อมูล

สร้างฐานข้อมูล MySQL ที่คุณจะใช้จริงก่อน ไม่ว่าจะเป็น TiDB Cloud, Aiven MySQL หรือผู้ให้บริการ MySQL รายอื่น จากนั้นคัดลอก connection string มาใส่เป็น `DATABASE_URL` ใน Render ภายหลัง คู่มือนี้ไม่ผูกกับฐานข้อมูลของ Manus เพราะคุณต้องการให้ระบบทำงานได้อย่างอิสระภายนอก

### ขั้นที่ 3: สร้าง Render Web Service

ใน Render Dashboard ให้สร้าง **Web Service** จาก repository ของคุณ แล้วกำหนดค่าหลักดังนี้

| รายการ | ค่าแนะนำ |
| --- | --- |
| Runtime | Node |
| Build Command | `pnpm install && pnpm build` |
| Start Command | `pnpm start` |
| Health Check Path | `/` |

จากนั้นใส่ environment variables ตามตารางด้านบน โดยเฉพาะ `DATABASE_URL`, `JWT_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` และ `SCHEDULE_SECRET`

### ขั้นที่ 4: รัน migration ฐานข้อมูล

หลัง service build สำเร็จ ให้เปิด shell ของ service แล้วรัน migration SQL ตามโฟลเดอร์ `drizzle/` หรือใช้ workflow ของคุณเองในการ apply schema ให้ตาราง `users`, `watchlistSettings` และ `watchlistItems` ถูกสร้างครบถ้วนก่อนเปิดใช้งานจริง

### ขั้นที่ 5: สร้าง Render Cron Job สำหรับ refresh ทุก 1 นาที

Render รองรับ cron jobs เป็น service แยก และ command ของงานต้องจบการทำงานเองเมื่อเสร็จ [1] สำหรับโปรเจ็กต์นี้ ให้สร้าง **Cron Job** แยกอีกหนึ่งตัวจาก repo เดิม แล้วกำหนดค่าโดยใช้ schedule ทุก 1 นาที และสั่ง `curl` เรียก internal endpoint ที่เพิ่มไว้ใหม่

ตัวอย่างคำสั่ง:

```bash
curl -fsS -X POST "$WEB_BASE_URL/api/internal/scheduled/watchlist-refresh" \
  -H "Authorization: Bearer $SCHEDULE_SECRET"
```

โดยให้เพิ่ม environment variable ของ cron job ดังนี้

| ตัวแปร | ความหมาย |
| --- | --- |
| `WEB_BASE_URL` | base URL ของ Render web service เช่น `https://your-app.onrender.com` |
| `SCHEDULE_SECRET` | ต้องตรงกับ secret ที่ตั้งใน web service |

แนวคิดนี้ทำให้ cron job เป็นเพียงตัว trigger ส่วน logic จริงอยู่ในซอร์สโค้ดของแอปหลัก จึงดูแลง่ายและ test ได้ใน repository เดียว

### ขั้นที่ 6: ทดสอบ end-to-end

หลัง deploy เสร็จ ให้ทดสอบตามลำดับดังนี้ เริ่มจาก login ให้ผ่าน, เพิ่มหุ้นอย่างน้อยหนึ่งรายการใน watchlist, ตั้งค่า cutloss หรือ sale, แล้วเรียก scheduled endpoint แบบ manual หนึ่งครั้งเพื่อตรวจว่าราคาอัปเดตและ LINE alert ทำงานจริง หลังจากนั้นค่อยเปิด cron schedule ทุก 1 นาที

## ขั้นตอน Deploy บน Railway

### ข้อสรุปก่อนเริ่ม

Railway docs ระบุว่าระบบ cron ของตนเอง **ไม่เหมาะกับงานที่ถี่กว่า every 5 minutes** และไม่รับประกันความแม่นยำระดับนาที [2] [3] ดังนั้นถ้าคุณต้องการ “ทุก 1 นาทีตลอด 24 ชั่วโมง” จริง ๆ คุณควรใช้ **Railway Web Service + Railway Background Worker** แทน cron ของ Railway

### ขั้นที่ 1: สร้าง Railway Web Service

เชื่อม repository เดียวกันเข้ากับ Railway แล้ว deploy เป็น service หลักด้วยคำสั่ง build และ start แบบเดียวกับ Render

| รายการ | ค่าแนะนำ |
| --- | --- |
| Build Command | `pnpm install && pnpm build` |
| Start Command | `pnpm start` |

กำหนด environment variables ชุดเดียวกับ Render โดยเฉพาะ `DATABASE_URL`, `JWT_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` และ `SCHEDULE_SECRET`

### ขั้นที่ 2: สร้าง Background Worker แยกอีกหนึ่ง service

สร้าง service ที่สองในโปรเจ็กต์ Railway เดียวกันเพื่อรันงานตามเวลาแบบ always-on เพราะ Railway แนะนำ worker สำหรับงานต่อเนื่องและการประมวลผลนอก request path [3] ใน worker service นี้ คุณมีสองทางเลือก

| วิธี | คำอธิบาย |
| --- | --- |
| เรียก HTTP endpoint ในลูป | worker รัน shell loop ที่ `curl` ไปยัง web service ทุก 60 วินาที |
| เขียน runner ภายในเพิ่มในอนาคต | ถ้าต้องการลด hop ของ HTTP สามารถเพิ่ม CLI runner ที่เรียก shared function โดยตรงในเฟสถัดไป |

สำหรับการย้ายรอบนี้ ผมแนะนำวิธีแรกเพราะใช้กับโค้ดปัจจุบันได้ทันทีและไม่ต้องเพิ่มจุด build ใหม่

ตัวอย่าง worker command:

```bash
while true; do
  curl -fsS -X POST "$WEB_BASE_URL/api/internal/scheduled/watchlist-refresh" \
    -H "Authorization: Bearer $SCHEDULE_SECRET" || true
  sleep 60
done
```

ถ้าคุณใช้วิธีนี้ worker จะเป็น process แบบ always-on ซึ่งสอดคล้องกับคำแนะนำของ Railway สำหรับ continuous processing มากกว่า cron แบบรันสั้น [3]

### ขั้นที่ 3: ทดสอบ worker

ให้ตรวจ log ของ worker ว่ามีการยิง endpoint ทุก 60 วินาทีและ web service ตอบกลับ `ok: true` พร้อม summary จากนั้นทดสอบสถานการณ์จริงโดยตั้งค่า cutloss หรือ sale ให้เกิด signal เพื่อยืนยันว่า LINE alert ถูกส่งออกนอก Manus ได้จริง

## ขั้นตอนตรวจสอบหลังย้ายระบบ

หลังย้ายเสร็จ ผมแนะนำให้คุณตรวจอย่างน้อยสี่เรื่องพร้อมกัน ได้แก่ การเชื่อมต่อฐานข้อมูล, การ login, การดึงราคาหุ้น, และการส่ง LINE alert หากส่วน login เดิมที่พึ่ง Manus OAuth มีปัญหา ให้แยกประเด็นนี้ออกจากงาน schedule เพราะงาน scheduled refresh ใหม่สามารถทำงานได้แม้คุณจะยังไม่เปลี่ยนระบบ auth ทันที ตราบใดที่ฐานข้อมูลและ watchlist data ถูกย้ายมาครบ

## สรุปคำแนะนำเชิงปฏิบัติ

ถ้าคุณต้องการทางที่ตรง requirement ที่สุดในตอนนี้ ให้เลือก **Render** สำหรับแอปหลักและสร้าง **Render Cron Job** แยกเพื่อเรียก `POST /api/internal/scheduled/watchlist-refresh` ทุก 1 นาที เพราะแพลตฟอร์มนี้รองรับรูปแบบ cron service โดยตรงและแยกภาระงานออกจาก web service ได้ชัดเจน [1] หากคุณต้องการใช้ **Railway** จริง ๆ ให้ใช้ **Web Service + Background Worker** แทน cron ของ Railway เพราะเอกสารทางการระบุชัดว่าระบบ cron ของ Railway ไม่เหมาะกับความถี่ต่ำกว่า 5 นาที [2] [3]

## References

[1]: https://render.com/docs/cronjobs "Cron Jobs – Render Docs"
[2]: https://docs.railway.com/cron-jobs "Cron Jobs | Railway Docs"
[3]: https://docs.railway.com/guides/cron-workers-queues "Choose Between Cron Jobs, Background Workers, and Queues | Railway Guides"
[4]: https://render.com/docs/background-workers "Background Workers – Render Docs"
