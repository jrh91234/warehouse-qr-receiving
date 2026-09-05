const fields = {
  materialCode: ['materialcode','material','partcode','partno','partnumber','รหัสพาร์ท','รหัสวัสดุ'],
  materialName: ['materialname','partname','ชื่อพาร์ท'],
  specification: ['specification','spec','สเปค'],
  lotNumber: ['lotnumber','lot','batch','ล็อต'],
  warehouse: ['warehouse','คลัง'], location: ['location','ตำแหน่ง'],
  quantity: ['quantity','qty','จำนวน'], unit: ['unit','หน่วย']
};
export const LOCATION_CODES = Array.from({length: 100}, (_, index) => `FR${String(index + 1).padStart(3, '0')}`);
export const WAREHOUSE_OPTIONS = [
  {code:'CK001', chinese:'原材料库', thai:'คลังวัตถุดิบ'},
  {code:'CK005', chinese:'半成品库-待冲压', thai:'คลังสินค้ากึ่งสำเร็จรูป-รอปั๊มขึ้นรูป'},
  {code:'CK006', chinese:'半成品库-待折弯', thai:'คลังสินค้ากึ่งสำเร็จรูป-รอพับ'},
  {code:'CK007', chinese:'半成品库-待焊接', thai:'คลังสินค้ากึ่งสำเร็จรูป-รอเชื่อม'},
  {code:'CK008', chinese:'半成品库-待喷涂', thai:'คลังสินค้ากึ่งสำเร็จรูป-รอพ่นสี'},
  {code:'CK010', chinese:'半成品库-待委外', thai:'คลังสินค้ากึ่งสำเร็จรูป-รอส่งผลิตภายนอก'},
  {code:'CK014', chinese:'镀后半成品库', thai:'คลังสินค้ากึ่งสำเร็จรูปหลังชุบ'},
  {code:'CK015', chinese:'电气半成品库-待后序', thai:'คลังสินค้ากึ่งสำเร็จรูปแผนกไฟฟ้า-รอกระบวนการถัดไป'},
  {code:'CK016', chinese:'汽车半成品库-待后序', thai:'คลังสินค้ากึ่งสำเร็จรูปยานยนต์-รอกระบวนแพ็ค'},
  {code:'CK018', chinese:'汽车半成品库-待全选', thai:'คลังสินค้ากึ่งสำเร็จรูปยานยนต์-รอตรวจคัด 100%'},
  {code:'CK019', chinese:'铝压铸半成品库-待全选', thai:'คลังสินค้ากึ่งสำเร็จรูปอะลูมิเนียม-รอตรวจคัด 100%'},
  {code:'CK017', chinese:'铝压铸半成品库-待后序', thai:'คลังสินค้ากึ่งสำเร็จรูปอะลูมิเนียม-รอกระบวนการถัดไป'},
  {code:'CK022', chinese:'铝压铸-成品库', thai:'คลังสินค้าสำเร็จรูปอะลูมิเนียม'},
  {code:'CK024', chinese:'不良品库', thai:'คลังสินงานเสีย'},
  {code:'CK011', chinese:'铝压铸半成品库-待打磨', thai:'คลังสินค้ากึ่งสำเร็จรูปอะลูมิเนียม-รอขัด'},
  {code:'CK012', chinese:'铝压铸半成品库-待机加工', thai:'คลังสินค้ากึ่งสำเร็จรูปอะลูมิเนียม-รอ CNC'},
  {code:'', chinese:'粉末库', thai:'คลังผงสี'},
  {code:'CK009', chinese:'半成品库-待组装', thai:'คลังสินค้ากึ่งสำเร็จรูป-รอประกอบ'},
  {code:'CK020', chinese:'电气-成品库', thai:'คลังสินค้าสำเร็จรูปไฟฟ้าอิเล็ก'},
  {code:'CK021', chinese:'汽车-成品库', thai:'คลังสินค้าสำเร็จรูปยานยนต์'},
  {code:'CK002', chinese:'外购件库', thai:'คลังชิ้นส่วนจัดซื้อภายนอก'},
  {code:'CK003', chinese:'客供料库', thai:'คลังวัสดุที่ลูกค้า'},
  {code:'CK004', chinese:'辅材库', thai:'คลังวัสดุเสริม'},
  {code:'CK025', chinese:'废品库', thai:'คลังของ scrap'},
  {code:'CK026', chinese:'封存库', thai:'คลังสินค้ากักเก็บ'},
  {code:'CK027', chinese:'委外-封存库', thai:'คลังงานผลิตภายนอก-กักเก็บ'},
  {code:'CK023', chinese:'呆滞品库', thai:'คลังสินค้าคงค้าง'},
  {code:'CK013', chinese:'委外-车间库', thai:'คลังงานผลิตภายนอก-พื้นที่โรงงาน'}
];
const normalized = key => key.toLowerCase().replace(/[\s_\-]/g, '');
export function parseQR(raw) {
  const text = String(raw).trim();
  if (!text || text.length > 4096) throw new Error('QR ต้องมีข้อมูลและยาวไม่เกิน 4,096 ตัวอักษร');
  let source = {};
  try { const obj = JSON.parse(text); if(obj && typeof obj === 'object' && !Array.isArray(obj)) source = obj; } catch {}
  if (!Object.keys(source).length) {
    for (const line of text.split(/[\n|;]/)) {
      const match = line.match(/^\s*([^:=]+)\s*[:=]\s*(.+?)\s*$/);
      if (match) source[match[1]] = match[2];
    }
  }
  const data = {};
  for(const [field, aliases] of Object.entries(fields)) {
    const item = Object.entries(source).find(([key]) => aliases.includes(normalized(key)));
    if(item && ['string','number'].includes(typeof item[1])) data[field] = String(item[1]).trim();
  }
  // Warehouse labels use: materialCode*lotNumber*quantity[*packageReference].
  // Some labels add a fourth package-reference token after the quantity.
  if(!Object.keys(data).length) {
    const star = text.split('*').map(part => part.trim());
    if(star.length >= 3 && /^[^*]{2,80}$/.test(star[0]) && /^[A-Za-z0-9_-]{2,80}$/.test(star[1]) && /^\d+(?:\.\d+)?$/.test(star[2])) {
      data.materialCode=star[0]; data.lotNumber=star[1]; data.quantity=star[2]; data.unit=star[2].includes('.')?'kg':'EA';
    }
  }
  return {data, raw: text, recognized: Object.keys(data).length > 0};
}
export function validateReceipt(record) {
  for(const [key, title] of Object.entries({rawQR:'QR code',employee:'ผู้รับพาร์ท',materialCode:'รหัสพาร์ท',lotNumber:'Lot number',warehouse:'คลังปลายทาง',location:'ตำแหน่งจัดเก็บ',unit:'หน่วย'})) {
    if(!String(record[key] ?? '').trim()) return `กรุณาระบุ${title}`;
  }
  if(!Number.isFinite(Number(record.quantity)) || Number(record.quantity) <= 0 || Number(record.quantity) > 1000000000) return 'จำนวนต้องมากกว่า 0 และไม่เกิน 1,000,000,000';
  if(String(record.rawQR).length > 4096) return 'ข้อมูล QR ยาวเกินกำหนด';
  if(!LOCATION_CODES.includes(String(record.location ?? '').trim().toUpperCase())) return 'ตำแหน่งจัดเก็บต้องเลือก FR001-FR100';
  for(const key of ['employee','materialCode','materialName','specification','lotNumber','warehouse','location','unit','notes']) if(String(record[key] ?? '').length > 500) return 'ข้อความแต่ละช่องต้องไม่เกิน 500 ตัวอักษร';
  return '';
}
export function validApiUrl(value) {
  try { const url=new URL(value); return url.protocol==='https:' && url.hostname==='script.google.com' && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) && !url.search && !url.hash; } catch {return false;}
}
