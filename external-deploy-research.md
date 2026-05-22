# External Deploy Research Notes

## Render Cron Jobs

- Render รองรับบริการประเภท cron job ที่ตั้งเวลารันด้วย cron expression ได้จากหน้า Dashboard
- งาน cron บน Render ควรเป็นงานที่เริ่มแล้วจบ และ command ต้อง exit เมื่อเสร็จ เพราะคิดค่าบริการตามเวลาที่รันอยู่
- Render ระบุว่า cron job จะ active ได้สูงสุดหนึ่งรันต่อหนึ่งงานในเวลาเดียวกัน หากมีรันเดิมค้างอยู่ รันถัดไปจะถูกหน่วงจนกว่ารันเดิมจะเสร็จ
- หากงานต้องรันต่อเนื่องหรือยาวนาน ควรใช้ background worker แทน
- เวลาในตาราง cron ใช้ UTC

## Railway Cron Jobs

- Railway cron จะรัน start command ของ service ตาม cron schedule ที่ตั้งไว้ใน Settings > Cron Schedule
- service แบบ cron ต้องทำงานให้เสร็จและปิด process เอง มิฉะนั้นรอบถัดไปจะถูกข้าม
- Railway ระบุว่าไม่เหมาะกับงานที่ต้องถี่กว่า every 5 minutes และไม่รับประกันความแม่นยำถึงระดับนาทีเป๊ะ
- เวลาใน cron schedule ใช้ UTC
- หาก process ก่อนหน้ายัง Active อยู่ตอนถึงรอบถัดไป งาน cron รอบใหม่จะไม่ถูกรัน

## Railway Pattern Selection

เอกสาร Railway แยกชัดเจนว่า cron job เหมาะกับงานตามเวลาแบบสั้นและต้อง exit เมื่อเสร็จ โดยความถี่ขั้นต่ำคือทุก 5 นาที และเวลาอาจคลาดเคลื่อนได้เล็กน้อย ส่วน background worker เหมาะกับงานต่อเนื่องแบบ always-on มากกว่า และหากต้องการ decouple การประมวลผลควรเพิ่ม queue เช่น Redis ร่วมด้วย

## Render Pattern Selection

เอกสาร Render ระบุว่า background worker เหมาะกับงานที่รันต่อเนื่องและงาน async นอก critical request path ขณะที่ cron job เหมาะกับงานเริ่มแล้วจบเป็นรอบ ๆ ดังนั้นสำหรับระบบนี้ แนวทางบน Render ที่ตรงที่สุดคือใช้ web service สำหรับแอปหลัก และใช้ cron job แยกอีกตัวสำหรับรันงาน refresh/alert ทุก 1 นาที หรือใช้ worker หากต้องการ loop ต่อเนื่องจริง ๆ
