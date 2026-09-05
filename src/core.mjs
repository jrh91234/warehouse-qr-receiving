const fields = {
  materialCode: ['materialcode','material','partcode','partno','partnumber','รหัสพาร์ท','รหัสวัสดุ'],
  materialName: ['materialname','partname','ชื่อพาร์ท'],
  specification: ['specification','spec','สเปค'],
  lotNumber: ['lotnumber','lot','batch','ล็อต'],
  warehouse: ['warehouse','คลัง'], location: ['location','ตำแหน่ง'],
  quantity: ['quantity','qty','จำนวน'], unit: ['unit','หน่วย']
};
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
  return {data, raw: text, recognized: Object.keys(data).length > 0};
}
export function validateReceipt(record) {
  for(const [key, title] of Object.entries({rawQR:'QR code',employee:'ผู้รับพาร์ท',materialCode:'รหัสพาร์ท',lotNumber:'Lot number',warehouse:'คลังปลายทาง',location:'ตำแหน่งจัดเก็บ',unit:'หน่วย'})) {
    if(!String(record[key] ?? '').trim()) return `กรุณาระบุ${title}`;
  }
  if(!Number.isFinite(Number(record.quantity)) || Number(record.quantity) <= 0 || Number(record.quantity) > 1000000000) return 'จำนวนต้องมากกว่า 0 และไม่เกิน 1,000,000,000';
  if(String(record.rawQR).length > 4096) return 'ข้อมูล QR ยาวเกินกำหนด';
  for(const key of ['employee','materialCode','materialName','specification','lotNumber','warehouse','location','unit','notes']) if(String(record[key] ?? '').length > 500) return 'ข้อความแต่ละช่องต้องไม่เกิน 500 ตัวอักษร';
  return '';
}
export function validApiUrl(value) {
  try { const url=new URL(value); return url.protocol==='https:' && url.hostname==='script.google.com' && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) && !url.search && !url.hash; } catch {return false;}
}
