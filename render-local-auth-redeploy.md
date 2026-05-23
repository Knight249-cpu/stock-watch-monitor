# Render Redeploy Guide for Admin-Managed Local Auth

เอกสารนี้สรุปขั้นตอนที่ต้องทำหลังโปรเจ็กต์ `stock-watch-monitor` ถูก refactor จาก **Manus OAuth** ไปเป็น **local authentication แบบหลายผู้ใช้ที่แอดมินสร้างบัญชีให้** เพื่อให้สามารถรันบน Render ได้โดยไม่ต้องพึ่งระบบ login ของ Manus อีกต่อไป

## สิ่งที่เปลี่ยนไปในรอบนี้

ระบบใหม่ใช้ **JWT session cookie แบบ first-party**, หน้า `/login` ภายในแอป, ตาราง `users` ที่มี `email`, `passwordHash`, `isActive`, และ `createdByAdminId`, รวมถึงหน้า `/admin/users` สำหรับจัดการบัญชีผู้ใช้โดยแอดมินโดยตรง ดังนั้นหลัง deploy แล้วจะไม่มีการ redirect ไปยัง OAuth callback ของ Manus อีก

| ส่วน | ก่อน refactor | หลัง refactor |
| --- | --- | --- |
| การเข้าสู่ระบบ | Manus OAuth | Email + password ภายในแอป |
| การสร้างบัญชี | อิง identity จาก Manus | แอดมินสร้างให้ผ่านหน้า Admin Users |
| Session | OAuth callback + cookie | JWT cookie แบบ first-party |
| การ deploy บน Render | ติดปัญหาเพราะผูกกับ Manus OAuth | ใช้งานได้โดยไม่ต้องใช้ Manus OAuth |

## ลำดับการ redeploy ที่แนะนำ

ให้ redeploy ตามลำดับนี้เพื่อเลี่ยง downtime ที่ไม่จำเป็นและเพื่อให้ schema ใหม่พร้อมก่อน web service ตัวใหม่เริ่มทำงาน

| ลำดับ | งานที่ต้องทำ | เหตุผล |
| --- | --- | --- |
| 1 | ดึงโค้ดเวอร์ชันล่าสุดขึ้น repository/deploy source | ให้ Render build จากโค้ด local auth รุ่นใหม่ |
| 2 | Deploy web service | ให้ image ใหม่พร้อม schema และ route ใหม่ |
| 3 | ตรวจ environment variables | เพื่อให้ session cookie และงาน schedule ยังทำงานต่อได้ |
| 4 | รัน one-time admin bootstrap | เพื่อกำหนดรหัสผ่านให้บัญชีแอดมินแรก |
| 5 | ทดสอบ login และ admin user management | ยืนยันว่า login/reset/deactivate ทำงานบน Render จริง |
| 6 | ตรวจ cron/scheduled refresh ต่อ | เพื่อยืนยันว่า auth refactor ไม่กระทบงาน refresh ราคาหุ้น |

## Environment variables ที่ Render ต้องมี

ค่าเดิมที่ใช้กับข้อมูลหุ้นและ LINE ยังคงจำเป็น ส่วนค่าที่เกี่ยวกับ Manus OAuth ไม่จำเป็นต่อ flow login ใหม่แล้ว

| ตัวแปร | จำเป็น | บทบาท |
| --- | --- | --- |
| `DATABASE_URL` | ใช่ | เชื่อมต่อฐานข้อมูลหลัก |
| `JWT_SECRET` | ใช่ | ใช้ sign และ verify JWT session cookie |
| `LINE_CHANNEL_ACCESS_TOKEN` | ใช่ หากเปิด LINE alerts | ส่งแจ้งเตือน LINE |
| `SCHEDULE_SECRET` | ใช่ หากใช้ scheduled refresh endpoint | ป้องกัน endpoint ภายในสำหรับ cron job |
| `NODE_ENV` | ใช่ | ควรเป็น `production` บน Render |
| `PORT` | Render กำหนดให้ | ไม่ต้อง hardcode ในโค้ด |

## ขั้นตอน bootstrap แอดมินคนแรก

หลัง migration ครั้งนี้ ผู้ใช้เดิมทั้งหมดจะยังคงอยู่ในตาราง `users` แต่จะยังไม่มีรหัสผ่านที่มนุษย์รู้จนกว่าจะถูกกำหนดใหม่ ดังนั้นหลัง deploy ให้รันคำสั่ง one-time bootstrap ด้านล่างใน Render shell หรือ job ที่รันครั้งเดียว เพื่อสร้างหรืออัปเดตบัญชีแอดมินที่คุณจะใช้เข้าสู่ระบบ

```bash
pnpm bootstrap:admin --email admin@example.com --password 'CHANGE_ME_NOW' --name 'Administrator'
```

ถ้าอีเมลนี้มีอยู่แล้ว ระบบจะ **อัปเดต** บัญชีเดิมให้เป็นแอดมินที่ active พร้อมตั้งรหัสผ่านใหม่ หากยังไม่มี ระบบจะ **สร้าง** บัญชีแอดมินขึ้นใหม่โดยไม่กระทบ watchlist ของผู้ใช้อื่น

> หลัง login ด้วยแอดมินคนแรกแล้ว ให้เข้า `/admin/users` เพื่อสร้างบัญชีผู้ใช้ใหม่ รีเซ็ตรหัสผ่านผู้ใช้เดิม หรือปิดการใช้งานบัญชีที่ไม่ต้องใช้

## วิธีตรวจสอบหลัง deploy

หลัง web service กลับมาทำงาน ให้ตรวจตามลำดับต่อไปนี้

| จุดตรวจ | วิธีตรวจ | ผลที่คาดหวัง |
| --- | --- | --- |
| หน้า `/login` | เปิด URL ของแอปบน Render | เห็นฟอร์ม email/password ภายในแอป |
| Login แอดมิน | ใช้บัญชีที่ bootstrap แล้ว | เข้าหน้า dashboard ได้สำเร็จ |
| หน้า `/admin/users` | เปิดเมนู Admin Users | เห็นรายการผู้ใช้ทั้งหมด |
| สร้างผู้ใช้ใหม่ | สร้างบัญชี user 1 รายการ | ผู้ใช้ใหม่ถูกเพิ่มในตารางทันที |
| Reset password | กำหนดรหัสผ่านใหม่ให้ผู้ใช้หนึ่งราย | ผู้ใช้นั้นใช้รหัสใหม่ login ได้ |
| Deactivate | ปิดการใช้งานผู้ใช้ที่ไม่ใช่ตัวเอง | ผู้ใช้นั้น login ไม่ได้อีก |
| Scheduled refresh | ตรวจ cron/webhook เดิม | งานรีเฟรชยังยิงเข้า endpoint ได้ตามรอบ |

## หมายเหตุเกี่ยวกับ migration ข้อมูล

migration รอบนี้เติม `passwordHash` placeholder ให้ผู้ใช้เดิมที่เคยอิง Manus OAuth และแทนค่า `email` ที่หายไปด้วยอีเมลรูปแบบ `legacy-user-<id>@local.invalid` เพื่อป้องกันการชนกับข้อกำหนด `NOT NULL` และ `UNIQUE` ของ schema ใหม่ นั่นหมายความว่า หากมีผู้ใช้เก่าที่ต้องกลับมาใช้งานจริง แอดมินควรอัปเดตอีเมลให้ถูกต้องและรีเซ็ตรหัสผ่านให้ผู้ใช้นั้นก่อนใช้งาน

## ข้อเสนอแนะเชิงปฏิบัติ

สำหรับการตัดขึ้น production จริง ผมแนะนำให้เตรียม **maintenance window สั้น ๆ** สำหรับขั้นตอน deploy + bootstrap admin และทดสอบ login หลัง deploy ทันที เพราะถึงแม้ตัว watchlist data จะยังคงอยู่ แต่ผู้ใช้จะยังเข้าไม่ได้จนกว่าจะมีอย่างน้อยหนึ่งบัญชีแอดมินที่ตั้งรหัสผ่านเรียบร้อยแล้ว
