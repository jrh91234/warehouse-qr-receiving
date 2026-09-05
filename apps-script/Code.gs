/** WH Receive backend. Set SPREADSHEET_ID and ACCESS_CODE in Script Properties. */
var RECEIPT_HEADERS = ['Request ID','Received at','Scanned at','Employee','Raw QR','Material code','Material name','Specification','Lot number','Warehouse','Location','Quantity','Unit','Notes'];

function doGet() {
  return json_({ok:true,service:'WH Receive',version:'1.0.0'});
}

function doPost(e) {
  try {
    if(!e || !e.postData || e.postData.contents.length > 160000) throw new Error('คำขอไม่ถูกต้อง');
    var body=JSON.parse(e.postData.contents);
    var properties=PropertiesService.getScriptProperties();
    var secret=properties.getProperty('ACCESS_CODE');
    if(!secret || secret.length<12) throw new Error('ผู้ดูแลยังไม่ได้ตั้งรหัสเข้าใช้งานอย่างน้อย 12 ตัวอักษร');
    if(typeof body.accessCode!=='string' || !equal_(body.accessCode,secret)) throw new Error('รหัสเข้าใช้งานไม่ถูกต้อง');
    var sheetId=properties.getProperty('SPREADSHEET_ID');
    if(!sheetId) throw new Error('ผู้ดูแลยังไม่ได้ตั้ง SPREADSHEET_ID');
    var book=SpreadsheetApp.openById(sheetId);
    var sheet=book.getSheetByName('Receipts');
    if(!sheet) throw new Error('ไม่พบแท็บ Receipts กรุณาให้ผู้ดูแลตรวจสอบ');
    if(sheet.getRange(1,1,1,RECEIPT_HEADERS.length).getValues()[0].join('|')!==RECEIPT_HEADERS.join('|')) throw new Error('หัวตาราง Receipts ไม่ตรงกับระบบ กรุณาให้ผู้ดูแลตรวจสอบ');
    if(body.action==='ping') return json_({ok:true,version:'1.0.0'});
    if(body.action==='receiveBatch') return receiveBatch_(sheet,body.receipts);
    if(body.action!=='receive') throw new Error('คำสั่งไม่ถูกต้อง');
    var receipt=validate_(body.receipt);
    var lock=LockService.getScriptLock();
    if(!lock.tryLock(25000)) throw new Error('มีรายการรับเข้าพร้อมกัน กรุณาลองส่งอีกครั้ง');
    try {
      var lastRow=sheet.getLastRow();
      if(lastRow>1) {
        var sameRequest=sheet.getRange(2,1,lastRow-1,1).createTextFinder(receipt.id).matchEntireCell(true).useRegularExpression(false).findNext();
        if(sameRequest) return json_({ok:true,id:receipt.id,serverTime:sheet.getRange(sameRequest.getRow(),2).getValue().toISOString(),replayed:true});
        var sameQR=sheet.getRange(2,5,lastRow-1,1).createTextFinder(receipt.rawQR).matchEntireCell(true).useRegularExpression(false).findNext();
        if(sameQR) return json_({ok:true,id:receipt.id,duplicate:true,serverTime:new Date().toISOString()});
      }
      var now=new Date();
      var values=[receipt.id,now,new Date(receipt.createdAt),receipt.employee,receipt.rawQR,receipt.materialCode,receipt.materialName,receipt.specification,receipt.lotNumber,receipt.warehouse,receipt.location,Number(receipt.quantity),receipt.unit,receipt.notes];
      var next=lastRow+1;
      if(next>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),1000);
      sheet.getRange(next,1).setNumberFormat('@');
      sheet.getRange(next,4,1,8).setNumberFormat('@');
      sheet.getRange(next,13,1,2).setNumberFormat('@');
      sheet.getRange(next,1,1,RECEIPT_HEADERS.length).setValues([values.map(safeCell_)]);
      sheet.getRange(next,2,1,2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
      sheet.getRange(next,12).setNumberFormat('#,##0.###');
      SpreadsheetApp.flush();
      return json_({ok:true,id:receipt.id,serverTime:now.toISOString()});
    } finally {lock.releaseLock();}
  } catch(error) {return json_({ok:false,message:error.message||'เกิดข้อผิดพลาดในการบันทึก'});}
}

function receiveBatch_(sheet,receipts) {
  if(!Array.isArray(receipts)||receipts.length<1||receipts.length>20) throw new Error('จำนวนรายการต่อชุดต้องอยู่ระหว่าง 1 ถึง 20');
  receipts=receipts.map(validate_);
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(25000)) throw new Error('มีรายการรับเข้าพร้อมกัน กรุณาลองส่งอีกครั้ง');
  try {
    var last=sheet.getLastRow(), ids={}, qrs={}, results=[], rows=[];
    if(last>1) {
      var existing=sheet.getRange(2,1,last-1,5).getValues();
      existing.forEach(function(row){if(row[0])ids[String(row[0])]=row[1];if(row[4])qrs[String(row[4])]=true;});
    }
    receipts.forEach(function(r){
      if(ids[r.id]) { results.push({id:r.id,replayed:true,serverTime:new Date(ids[r.id]).toISOString()}); return; }
      if(qrs[r.rawQR]) { results.push({id:r.id,duplicate:true,serverTime:new Date().toISOString()}); return; }
      var now=new Date();
      rows.push([r.id,now,new Date(r.createdAt),r.employee,r.rawQR,r.materialCode,r.materialName,r.specification,r.lotNumber,r.warehouse,r.location,Number(r.quantity),r.unit,r.notes].map(safeCell_));
      ids[r.id]=now; qrs[r.rawQR]=true; results.push({id:r.id,serverTime:now.toISOString()});
    });
    if(rows.length) {
      var next=last+1;
      if(next+rows.length-1>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),Math.max(1000,rows.length));
      sheet.getRange(next,1,rows.length,RECEIPT_HEADERS.length).setValues(rows);
      sheet.getRange(next,2,rows.length,2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
      sheet.getRange(next,12,rows.length,1).setNumberFormat('#,##0.###');
      SpreadsheetApp.flush();
    }
    return json_({ok:true,results:results});
  } finally { lock.releaseLock(); }
}

function validate_(r) {
  if(!r || typeof r!=='object') throw new Error('ไม่พบข้อมูลรับพาร์ท');
  if(typeof r.id!=='string'||!/^[0-9a-f-]{36}$/i.test(r.id)) throw new Error('รหัสรายการไม่ถูกต้อง');
  var required=['rawQR','employee','materialCode','lotNumber','warehouse','location','unit'];
  var optional=['materialName','specification','notes'];
  required.concat(optional).forEach(function(key){
    if(r[key]===undefined && optional.indexOf(key)>=0) r[key]='';
    if(typeof r[key]!=='string') throw new Error('ข้อมูล '+key+' ไม่ถูกต้อง');
    r[key]=r[key].trim();
    if(required.indexOf(key)>=0&&!r[key]) throw new Error('กรุณาระบุ '+key);
    if(r[key].length>(key==='rawQR'?4096:500)) throw new Error('ข้อมูล '+key+' ยาวเกินกำหนด');
  });
  if(!isFinite(Number(r.quantity))||Number(r.quantity)<=0||Number(r.quantity)>1000000000) throw new Error('จำนวนรับไม่ถูกต้อง');
  if(typeof r.createdAt!=='string'||!isFinite(Date.parse(r.createdAt))) throw new Error('เวลาสแกนไม่ถูกต้อง');
  return r;
}
function safeCell_(value){return typeof value==='string'&&/^[=+@\-\t\r\n]/.test(value)?"'"+value:value;}
function equal_(a,b){var mismatch=a.length^b.length;for(var i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;}
function json_(body){return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);}
