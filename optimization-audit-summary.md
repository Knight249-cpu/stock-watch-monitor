# Stock Watch Monitor: Tech Stack Audit และ Streaming Refactor Summary

## สรุปภาพรวม

โปรเจ็กต์ **Stock Watch Monitor** เป็นเว็บแอปแบบ full-stack JavaScript/TypeScript โดยฝั่งหน้าเว็บใช้ **React + TypeScript + Vite + Tailwind CSS + shadcn/ui** และฝั่งเซิร์ฟเวอร์ใช้ **Node.js + Express + tRPC** ร่วมกับฐานข้อมูลผ่าน **Drizzle ORM** ภายใต้โครงสร้าง `client/`, `server/` และ `drizzle/`

ก่อนการแก้รอบนี้ ระบบอัปเดตราคาอาศัยแนวทาง **dashboard query + refresh mutation + auto-refresh polling บน frontend** เป็นหลัก แม้จะมีการเพิ่ม cache, cooldown และ staleness guard ไว้แล้วบางส่วน แต่ยังคงมีรูปแบบการเรียกซ้ำที่ทำให้สิ้นเปลืองคำขอ โดยเฉพาะเมื่อมีหลายแท็บเปิดพร้อมกัน หรือเมื่อ mutation ทำให้ต้อง invalidate dashboard query เพิ่มเติมหลังข้อมูลเพิ่งถูกเปลี่ยนไปแล้ว

## สรุป Tech Stack

| ส่วนของระบบ | เทคโนโลยีหลัก | หลักฐานในโปรเจ็กต์ |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite | `client/src/pages/Home.tsx`, `client/src/App.tsx`, `package.json` |
| UI Styling | Tailwind CSS, shadcn/ui | `client/src/index.css`, `client/src/components/ui/*` |
| Backend | Node.js, Express, tRPC | `server/_core/index.ts`, `server/routers.ts`, `server/routers/watchlist.ts` |
| Database | Drizzle ORM + SQL migrations | `drizzle/schema.ts`, `drizzle/*.sql`, `server/db.ts` |
| Auth | Session-based auth ผ่าน Manus OAuth | `server/_core/context.ts`, `server/_core/sdk.ts`, `server/_core/oauth.ts` |
| Testing | Vitest, Testing Library | `vitest.config.ts`, `server/*.test.ts`, `client/src/**/*.test.tsx` |

## ปัญหาหลักที่พบก่อน refactor

ระบบเดิมมีต้นทุนคำขอสูงจากการอัปเดตราคาในลักษณะ **pull-based polling** กล่าวคือ หน้าเว็บจะคอยกระตุ้นการรีเฟรชเป็นช่วงเวลา และเมื่อมีการเพิ่ม ลบ หรือแก้ไข watchlist ก็ยังมีจุดที่ต้อง invalidate dashboard query เพื่อดึงข้อมูลซ้ำอีกครั้ง แม้ข้อมูลใหม่จะเพิ่งถูกคำนวณหรือเขียนเสร็จแล้ว

| จุดเสี่ยงเดิม | ผลกระทบ |
| --- | --- |
| Frontend ใช้ auto-refresh polling เป็นตัวขับหลัก | ทุกแท็บของผู้ใช้มีโอกาสยิง refresh ของตัวเอง ทำให้คำขอซ้ำกัน |
| หลัง mutation มีการ invalidate dashboard query | เกิด request เพิ่ม แม้ระบบเพิ่งมีข้อมูลล่าสุดอยู่แล้ว |
| ยังไม่มี push channel กลับไปยังหลายแท็บ | แต่ละแท็บต้องดึงข้อมูลเองแทนการรับ snapshot ชุดเดียวกัน |
| การเชื่อมต่อแบบช่วงสั้น | ใช้ request-response ซ้ำแทนการเปิดท่อเชื่อมต่อระยะยาว |

## สิ่งที่แก้ไขในรอบนี้

รอบนี้ได้ refactor ระบบจากแนวคิด **frontend polling เป็นหลัก** ไปสู่ **Server-Sent Events (SSE) streaming** เพื่อให้ browser เปิดการเชื่อมต่อยาวกับเซิร์ฟเวอร์หนึ่งเส้นต่อแท็บ และรับ snapshot ใหม่เมื่อมีข้อมูลเปลี่ยนหรือเมื่อเซิร์ฟเวอร์ทำ scheduled refresh เสร็จ แทนการยิง request เป็นช่วงสั้นซ้ำไปมา

### 1. แยก service กลางสำหรับ dashboard, refresh และ stream session

สร้างไฟล์ใหม่ `server/watchlistRealtime.ts` เพื่อรวม logic สำคัญ ได้แก่ การ format dashboard payload, การ refresh ราคา, การ broadcast snapshot และการจัดการ stream session ต่อผู้ใช้ ทำให้ backend มีจุดควบคุมการอัปเดตราคาและการกระจายข้อมูลแบบรวมศูนย์มากขึ้น

### 2. เพิ่ม SSE endpoint สำหรับ watchlist stream

ใน `server/_core/index.ts` ได้เพิ่มเส้นทาง `GET /api/watchlist/stream` เพื่อเปิด stream แบบ long-lived โดยอาศัย session เดิมของผู้ใช้สำหรับการยืนยันตัวตน จากนั้น browser จะรับ event ประเภท `bootstrap`, `mutation` และ `refresh` ผ่าน stream เดียว

### 3. เปลี่ยน Home.tsx จาก polling เป็น stream-driven updates

ใน `client/src/pages/Home.tsx` ได้ถอด logic `setInterval` สำหรับ auto-refresh เดิมออก แล้วแทนที่ด้วยการเปิด stream ผ่าน helper ใหม่ `client/src/lib/watchlistStream.ts` จากนั้นใช้ snapshot ที่รับมาอัปเดต cache ของ dashboard และอัปเดตสถานะบน UI เช่น **Live stream**, warning และ error message

เมื่อ stream เปิดอยู่ การเพิ่ม ลบ หรือแก้ค่าใน watchlist จะไม่ต้อง invalidate dashboard query ซ้ำในแท็บเดียวกันอีก เพราะ backend จะ push snapshot กลับมาให้เอง

### 4. รักษา optimization เดิมและใช้ร่วมกับ streaming

แม้จะเปลี่ยนมาใช้ stream แล้ว แต่ระบบยังคงใช้ optimization ที่เพิ่มไว้ก่อนหน้า ได้แก่

| Optimization ที่คงไว้ | บทบาท |
| --- | --- |
| In-memory quote cache / request de-duplication ใน `server/stockData.ts` | ลดการเรียก data source ภายนอกซ้ำเมื่อ query เดิมถูกขอพร้อมกัน |
| Staleness guard ใน refresh logic | ข้ามการ fetch ภายนอกเมื่อราคาที่มีอยู่ยังสดพอ |
| ค่า default auto-refresh 120 วินาที | ลดความถี่การ refresh ฝั่งเซิร์ฟเวอร์เมื่อเทียบกับช่วงเวลาที่สั้นกว่าเดิม |

### 5. เพิ่มและอัปเดตชุดทดสอบ

ได้ปรับและรันชุดทดสอบให้สอดคล้องกับโครงสร้างใหม่ โดยครอบคลุมทั้ง backend และ frontend เช่น router tests, stream helper tests และ Home integration tests

| ไฟล์ทดสอบที่อัปเดต | สิ่งที่ยืนยัน |
| --- | --- |
| `server/watchlist.router.test.ts` | router เรียก service ใหม่และ publish snapshot ถูกต้อง |
| `client/src/lib/watchlistAutoRefresh.test.ts` | helper สำหรับ stream parse payload และผูก EventSource ถูกต้อง |
| `client/src/pages/Home.test.tsx` | หน้า Home เปิด/ปิด stream, รับ snapshot, แสดง warning/error และลด invalidate เมื่อ stream เปิดอยู่ |

ผลการตรวจล่าสุดคือ **Vitest ผ่าน 43 tests** และ **TypeScript check ผ่าน**

## ผลเชิงสถาปัตยกรรมหลังแก้ไข

หลัง refactor นี้ ระบบอัปเดตราคาเปลี่ยนจากการ “ถามซ้ำเป็นช่วง ๆ” ไปเป็นการ “เปิดท่อรอรับข้อมูล” มากขึ้น ซึ่งเหมาะกับกรณี watchlist ที่ต้องการให้หลายส่วนของหน้าเว็บเห็นข้อมูลใหม่เร็ว แต่ไม่อยากเสียต้นทุนกับคำขอซ้ำในทุกจังหวะ

| ก่อน refactor | หลัง refactor |
| --- | --- |
| Frontend เป็นตัว polling หลัก | Backend เป็นตัวควบคุม refresh และ push snapshot |
| Mutation มักตามด้วย invalidate dashboard query | เมื่อ stream เปิดอยู่ ใช้ push snapshot แทนการดึงซ้ำ |
| หลายแท็บมีแนวโน้มยิง refresh คนละชุด | แต่ละแท็บรับ event stream แทนการเรียก refresh ถี่ ๆ จาก UI |
| Logic refresh กระจายอยู่ใน router และหน้า Home | รวมศูนย์ใน service และ stream helper มากขึ้น |

## ไฟล์สำคัญที่เปลี่ยนในรอบนี้

| ไฟล์ | การเปลี่ยนแปลงหลัก |
| --- | --- |
| `server/watchlistRealtime.ts` | เพิ่ม service ใหม่สำหรับ dashboard/refresh/stream session |
| `server/routers/watchlist.ts` | ลด logic ที่ซ้ำ ย้ายไปใช้ service และ publish snapshot หลัง mutation |
| `server/_core/index.ts` | เพิ่ม SSE endpoint `/api/watchlist/stream` |
| `client/src/lib/watchlistStream.ts` | เพิ่ม helper สำหรับ EventSource และ parse stream payload |
| `client/src/pages/Home.tsx` | เปลี่ยนจาก polling เป็น stream-driven UI updates |
| `server/watchlist.router.test.ts` | อัปเดต tests ให้รองรับ service/stream architecture |
| `client/src/lib/watchlistAutoRefresh.test.ts` | เปลี่ยนเป็น tests ของ stream helper |
| `client/src/pages/Home.test.tsx` | เพิ่ม integration tests สำหรับ stream behavior |

## ข้อสังเกตเพิ่มเติม

แม้รอบนี้จะช่วยลดคำขอซ้ำได้มากในเชิงสถาปัตยกรรม แต่การประหยัดจริงยังขึ้นกับพฤติกรรมผู้ใช้ เช่น จำนวนแท็บที่เปิดพร้อมกัน จำนวนรายการใน watchlist และข้อจำกัดของ data source ภายนอก หากต้องการวัดผลเชิงปริมาณในรอบถัดไป ควรเพิ่ม metrics เช่น จำนวน refresh ต่อชั่วโมง, cache hit rate, จำนวน snapshot ที่ push สำเร็จ และจำนวน mutation ที่ไม่ต้อง invalidate query อีกต่อไป
