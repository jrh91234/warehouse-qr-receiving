# WH Receive

เว็บภาษาไทยสำหรับสแกน QR รับพาร์ทบนมือถือ บันทึก Google Sheets ผ่าน Google Apps Script และ deploy ด้วย GitHub Pages

## การใช้งาน

1. ผู้ดูแลตั้งค่า Apps Script และลิงก์เว็บก่อนใช้งานครั้งแรก
2. ครั้งแรกเลือก **ตั้งค่าครั้งแรก / สร้าง Admin** แล้วใช้ `ACCESS_CODE` สร้างบัญชีผู้ดูแล
3. ผู้ดูแลเข้าสู่ระบบ เปิด **Admin panel** และเพิ่มบัญชีผู้รับพาร์ท
4. พนักงาน Login ด้วย username/password ของตนเอง แล้วเปิดกล้องสแกน QR หรือเลือกรูป/กรอกรหัสเอง
5. ตรวจรหัสพาร์ท ล็อต คลัง ตำแหน่ง จำนวนจริง และหน่วย แล้วกดยืนยันรับเข้า ชื่อ/รหัสผู้รับจะใช้ username ที่ Login โดยอัตโนมัติ ตำแหน่งจัดเก็บเลือกจากรายการ FR001–FR100 ได้โดยพิมพ์รหัสเพื่อค้นหา
6. สถานะ **บันทึกแล้ว** หมายถึงเซิร์ฟเวอร์ยืนยันแล้ว หากเน็ตหลุดให้เปิดประวัติและกด **ส่งรายการรอ** ผู้ส่งแก้ไขหรือลบรายการของตนเองได้จากรายการล่าสุด/ประวัติ ส่วน Admin แก้ไขหรือลบรายการของทุกคนได้

หน้าเว็บเปิด **โหมดสแกนต่อเนื่อง** เป็นค่าเริ่มต้น: เมื่อกดยืนยัน แอปจะเก็บรายการเข้าคิวในเครื่องทันที เปิดกล้องสำหรับชิ้นถัดไป และส่งรายการค้างขึ้น Google Sheets เป็นชุดละไม่เกิน 20 รายการเพื่อลดเวลารอเครือข่าย ป้ายที่สแกนสำเร็จแต่ยังไม่ขึ้นชีตจะแสดงสถานะ “รอส่ง” จนกว่าเซิร์ฟเวอร์จะตอบรับ

รายการที่รอส่งอยู่ใน localStorage ของเบราว์เซอร์เดิม ต้องไม่ล้างข้อมูลเว็บไซต์หรือเปลี่ยนเบราว์เซอร์ก่อนส่งสำเร็จ ต้องเปิดเว็บขณะมีอินเทอร์เน็ตก่อน แอปยังไม่รองรับการเปิดหน้าเว็บใหม่ขณะออฟไลน์ รหัสเข้าใช้งานอยู่ใน sessionStorage เท่านั้นและไม่ถูกรวมในข้อมูลที่รอส่ง

หน้าประวัติจะโหลดรายการล่าสุดจาก Google Sheets รวมทุกเครื่อง และมีตัวกรองตามวันที่กับผู้ลงข้อมูล ส่วนรายการรอส่งยังอยู่ในเบราว์เซอร์นี้จนกว่าจะส่งสำเร็จ

## ตั้งค่า Google Apps Script

1. สร้าง Google Sheets ที่มีแท็บ `Receipts` และหัวตารางแถว 1 ตามลำดับนี้:

   Request ID, Received at, Scanned at, Employee, Raw QR, Material code, Material name, Specification, Lot number, Warehouse, Location, Quantity, Unit, Notes

2. สร้าง Apps Script แล้วนำโค้ด `apps-script/Code.gs` และ manifest `apps-script/appsscript.json` ไปใช้
3. ตั้ง Script Properties:
   - `SPREADSHEET_ID`: ID ของชีต
   - `ACCESS_CODE`: รหัสตั้งค่าครั้งแรกอย่างน้อย 12 ตัวอักษร เก็บไว้เฉพาะผู้ดูแล
4. Deploy เป็น Web app, Execute as **Me**, Who has access **Anyone** และอนุญาตสิทธิ์ Google Sheets
5. ใส่ URL ที่ลงท้าย `/exec` ใน `public/config.json` หรือหน้าตั้งค่า ห้ามใส่ ACCESS_CODE ใน repository หรือ config สาธารณะ
6. กดทดสอบการเชื่อมต่อก่อนรับพาร์ทจริง

เมื่อเปิดหน้า Admin panel ระบบจะสร้างแท็บ `Users` ให้อัตโนมัติ โดยมีหัวตาราง `Username, Password hash, Role, Active, Created at, Last login` ไม่ต้องสร้างเอง รหัสผ่านจะเก็บเป็นแฮชในชีตและ session ของผู้ใช้เก็บชั่วคราวใน Apps Script Cache

Endpoint เปิดสำหรับเข้าถึงจากโทรศัพท์ แต่คำสั่ง Login เปิดให้ตรวจสอบบัญชีได้ ส่วนการอ่าน/เขียนข้อมูลและจัดการผู้ใช้ต้องใช้ session ของผู้ใช้หรือ `ACCESS_CODE` แบบเก่าสำหรับความเข้ากันได้ ชีตยังคงเป็นไฟล์ส่วนตัว ไม่ต้องเปิดชีตสาธารณะ หน้าเว็บส่งคำขอผ่าน iframe form และรับผลด้วย `postMessage` เพราะ Content Service ของ Apps Script redirect ข้ามโดเมน จึงไม่ต้องพึ่ง CORS header หรือ proxy ภายนอก

อ้างอิง: [Apps Script Web Apps](https://developers.google.com/apps-script/guides/web), [Content Service](https://developers.google.com/apps-script/guides/content)

## รูปแบบ QR

รองรับ JSON เช่น:

```json
{"materialCode":"PART-DEMO-001","materialName":"Demo part","lotNumber":"LOT-001","quantity":25,"unit":"EA"}
```

หรือข้อความระบุชื่อฟิลด์ เช่น:

```text
Material code: PART-DEMO-001|Lot number: LOT-001|Quantity: 25|Unit: EA
```

ป้าย Warehouse แบบในรูปใช้รูปแบบ `MaterialCode*LotNumber*Quantity*PackageReference` เช่น `1005QT00197*2026083001*10*0002-2` แอปจะแยก Material code, Lot number และ Quantity (`10`) ให้อัตโนมัติ พร้อมตั้ง Unit เป็น EA ถ้า Quantity เป็นทศนิยม เช่น `42.5` จะตั้ง Unit เป็น kg ส่วนตัวเลขท้ายเป็นรหัสอ้างอิงแพ็กเกจและยังเก็บครบใน Raw QR ถ้าไม่มีรหัสแพ็กเกจ รูปแบบ `MaterialCode*LotNumber*Quantity` ก็รองรับเช่นกัน

รหัสแบบต่อกันซึ่งไม่ทราบโครงสร้างจะเก็บข้อความเดิมทั้งหมด แล้วให้ผู้ใช้กรอกข้อมูลตามป้าย ไม่มีการเดาความยาวรหัสพาร์ท/ล็อต และไม่มีการเดาข้อมูลจากรูปถ่าย ป้ายตัวอย่างที่แนบไม่ได้ถูกรวมใน public repository

QR เดียวกันรับเข้าได้ครั้งเดียว ทั้งในเครื่องและบนเซิร์ฟเวอร์ จึงเหมาะกับป้ายที่มีรหัสเฉพาะถุง/กล่อง หากเป็น QR รหัสพาร์ทที่ใช้ซ้ำ ต้องปรับกติกาก่อนใช้จริง จำนวนและรายละเอียดแก้ได้จากหน้าประวัติ รายการที่ส่งแล้วแก้ไขหรือลบได้โดยเจ้าของรายการหรือ Admin ผ่านหน้าเว็บ โดยเซิร์ฟเวอร์ตรวจสิทธิ์ซ้ำทุกครั้ง

## ความถูกต้องของการบันทึก

- ใช้ UUID เดิมสำหรับการส่งซ้ำ และตรวจบนเซิร์ฟเวอร์ภายใต้ ScriptLock
- ป้องกันการรับ QR ซ้ำระหว่างโทรศัพท์หลายเครื่อง
- เก็บ timestamp จากเซิร์ฟเวอร์และเวลาสแกนจากอุปกรณ์แยกกัน
- ตรวจฟิลด์บังคับและจำนวนทั้งหน้าจอและเซิร์ฟเวอร์
- ข้อมูลจาก QR/ช่องกรอกแสดงเป็นข้อความ และป้องกันการแทรกสูตรในชีต
- ไม่ใช้ `no-cors`: ถ้าอ่านคำตอบไม่ได้ รายการยังเป็นรอส่ง และใช้ UUID เดิม retry เพื่อไม่เพิ่มแถวซ้ำ

## พัฒนาและทดสอบ

```sh
npm ci
npm test
npm run dev
npm run build
```

ชุดทดสอบครอบคลุม QR parser, validation, idempotency, duplicate QR, authorization และการป้องกัน spreadsheet formula injection
ยังต้องทดสอบกล้องบนโทรศัพท์จริงและการใช้งานหลายเครื่องหน้างานก่อนใช้เป็นระบบประจำ

## GitHub Pages

Repository Settings → Pages → Source: **GitHub Actions**
ทุก push ไป `main` จะทดสอบ build และ deploy ด้วย `.github/workflows/deploy.yml`
Vite ใช้ relative base (`./`) เพื่อรองรับ path ของ repository

อ้างอิง: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
