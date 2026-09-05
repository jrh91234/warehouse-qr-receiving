/** WH Receive backend. Set SPREADSHEET_ID and ACCESS_CODE in Script Properties. */
var RECEIPT_HEADERS = ['Request ID','Received at','Scanned at','Employee','Raw QR','Material code','Material name','Specification','Lot number','Warehouse','Location','Quantity','Unit','Notes'];
var USER_HEADERS = ['Username','Password hash','Role','Active','Created at','Last login'];
var SESSION_TTL_SECONDS = 21600;

function doGet(e) {
  var status={ok:true,service:'WH Receive',version:'1.4.0',transport:'iframe'};
  if(e&&e.parameter&&e.parameter.transport==='iframe') return iframe_(status,String(e.parameter.requestId||''),e.parameter.origin);
  return json_(status);
}

// Run once from the Apps Script editor to set the spreadsheet and shared bootstrap code.
function configureBackend_(spreadsheetId,accessCode) {
  if(typeof spreadsheetId!=='string'||!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) throw new Error('Invalid spreadsheet id');
  if(typeof accessCode!=='string'||accessCode.length<12) throw new Error('ACCESS_CODE must be at least 12 characters');
  SpreadsheetApp.openById(spreadsheetId).getSheets();
  PropertiesService.getScriptProperties().setProperties({SPREADSHEET_ID:spreadsheetId,ACCESS_CODE:accessCode},true);
  return {ok:true,spreadsheetId:spreadsheetId};
}

function doPost(e) {
  var iframeRequest=!!(e&&e.parameter&&e.parameter.transport==='iframe');
  var requestId=iframeRequest?String(e.parameter.requestId||''):'';
  var response;
  try {
    if(iframeRequest&&!allowedOrigin_(e.parameter.origin)) throw new Error('ไม่อนุญาตให้เรียกใช้จากเว็บไซต์นี้');
    var raw=iframeRequest?e.parameter.payload:(e&&e.postData&&e.postData.contents);
    if(typeof raw!=='string'||!raw||raw.length>160000) throw new Error('คำขอไม่ถูกต้อง');
    var body=JSON.parse(raw), action=String(body.action||'');
    var properties=PropertiesService.getScriptProperties(), sheetId=properties.getProperty('SPREADSHEET_ID');
    if(!sheetId) throw new Error('ผู้ดูแลยังไม่ได้ตั้ง SPREADSHEET_ID');
    var book=SpreadsheetApp.openById(sheetId);
    if(action==='login') response=login_(body,book,properties);
    else if(action==='bootstrapAdmin') {requireAccessCode_(body,properties);response=bootstrapAdmin_(body,book,properties);}
    else {
    var auth=authorize_(body,properties);
    if(action==='logout') response=logout_(body);
    else if(action==='listUsers') response=listUsers_(auth,book);
    else if(action==='upsertUser') response=upsertUser_(auth,body,book,properties);
    else if(action==='deleteUser') response=deleteUser_(auth,body,book);
    else {
      var sheet=book.getSheetByName('Receipts');
      if(!sheet) throw new Error('ไม่พบแท็บ Receipts กรุณาให้ผู้ดูแลตรวจสอบ');
      if(sheet.getRange(1,1,1,RECEIPT_HEADERS.length).getValues()[0].join('|')!==RECEIPT_HEADERS.join('|')) throw new Error('หัวตาราง Receipts ไม่ตรงกับระบบ กรุณาให้ผู้ดูแลตรวจสอบ');
      if(action==='ping') response={ok:true,version:'1.4.0',user:auth.username||null};
      else if(action==='receiveBatch') response=receiveBatch_(sheet,body.receipts,auth);
      else if(action==='deleteReceipt') response=deleteReceipt_(sheet,body.id,auth);
      else {
        if(action!=='receive') throw new Error('คำสั่งไม่ถูกต้อง');
        var receipt=bindEmployee_(body.receipt||{},auth);
        var lock=LockService.getScriptLock();
        if(!lock.tryLock(25000)) throw new Error('มีรายการรับเข้าพร้อมกัน กรุณาลองส่งอีกครั้ง');
        try {
          var lastRow=sheet.getLastRow();
          if(lastRow>1) {
            var sameRequest=sheet.getRange(2,1,lastRow-1,1).createTextFinder(receipt.id).matchEntireCell(true).useRegularExpression(false).findNext();
            if(sameRequest) response={ok:true,id:receipt.id,serverTime:sheet.getRange(sameRequest.getRow(),2).getValue().toISOString(),replayed:true};
            else {
              var sameQR=sheet.getRange(2,5,lastRow-1,1).createTextFinder(receipt.rawQR).matchEntireCell(true).useRegularExpression(false).findNext();
              if(sameQR) response={ok:true,id:receipt.id,duplicate:true,serverTime:new Date().toISOString()};
            }
          }
          if(!response) {
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
            response={ok:true,id:receipt.id,serverTime:now.toISOString()};
          }
        } finally {lock.releaseLock();}
      }
    }
    }
  } catch(error) {response={ok:false,message:error.message||'เกิดข้อผิดพลาดในการบันทึก'};}
  return iframeRequest?iframe_(response,requestId,e.parameter.origin):json_(response);
}

function authorize_(body,properties) {
  if(typeof body.sessionToken==='string'&&body.sessionToken) {
    try {
      var cached=CacheService.getScriptCache().get('wh-session-'+body.sessionToken);
      if(cached) return JSON.parse(cached);
    } catch(error) {}
  }
  requireAccessCode_(body,properties);
  return {legacy:true};
}
function requireAccessCode_(body,properties) {
  var secret=properties.getProperty('ACCESS_CODE');
  if(!secret||secret.length<12) throw new Error('ผู้ดูแลยังไม่ได้ตั้งรหัสเข้าใช้งานอย่างน้อย 12 ตัวอักษร');
  if(typeof body.accessCode!=='string'||!equal_(body.accessCode,secret)) throw new Error('รหัสเข้าใช้งานไม่ถูกต้อง');
}
function login_(body,book,properties) {
  var username=String(body.username||'').trim(), password=String(body.password||'');
  if(!/^[A-Za-z0-9ก-๙._-]{2,100}$/.test(username)||password.length<8||password.length>128) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  var sheet=usersSheet_(book), row=findUser_(sheet,username);
  if(!row||!isActive_(row.values[3])||!equal_(String(row.values[1]||''),passwordHash_(row.values[0],password,properties))) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  var now=new Date(); sheet.getRange(row.row,6).setValue(now);
  var token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
  CacheService.getScriptCache().put('wh-session-'+token,JSON.stringify({username:String(row.values[0]),role:String(row.values[2]||'receiver')}),SESSION_TTL_SECONDS);
  return {ok:true,token:token,user:{username:String(row.values[0]),role:String(row.values[2]||'receiver')}};
}
function bootstrapAdmin_(body,book,properties) {
  var username=String(body.username||'').trim(), password=String(body.password||''), sheet=usersSheet_(book);
  if(sheet.getLastRow()>1) throw new Error('มีบัญชีผู้ใช้งานแล้ว กรุณาให้ผู้ดูแลระบบเข้าสู่ระบบ');
  if(!/^[A-Za-z0-9ก-๙._-]{2,100}$/.test(username)||password.length<8||password.length>128) throw new Error('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ/ไทย/ตัวเลข และรหัสผ่านอย่างน้อย 8 ตัวอักษร');
  var now=new Date(); sheet.getRange(2,1,1,USER_HEADERS.length).setValues([[username,passwordHash_(username,password,properties),'admin',true,now,'']]);
  return {ok:true,message:'สร้างบัญชีผู้ดูแลแล้ว'};
}
function listUsers_(auth,book) {
  requireAdmin_(auth);
  var sheet=usersSheet_(book), last=sheet.getLastRow(), users=[];
  if(last>1) sheet.getRange(2,1,last-1,USER_HEADERS.length).getValues().forEach(function(row){users.push({username:String(row[0]||''),role:String(row[2]||'receiver'),active:isActive_(row[3]),createdAt:dateValue_(row[4]),lastLogin:dateValue_(row[5])});});
  return {ok:true,users:users};
}
function upsertUser_(auth,body,book,properties) {
  requireAdmin_(auth);
  var incoming=body.user||{}, username=String(incoming.username||'').trim(), password=String(incoming.password||''), role=String(incoming.role||'receiver')==='admin'?'admin':'receiver', active=incoming.active!==false;
  if(!/^[A-Za-z0-9ก-๙._-]{2,100}$/.test(username)) throw new Error('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ/ไทย/ตัวเลข 2-100 ตัวอักษร');
  var sheet=usersSheet_(book), found=findUser_(sheet,username), now=new Date();
  if(!found) {
    if(password.length<8||password.length>128) throw new Error('รหัสผ่านต้องยาว 8-128 ตัวอักษร');
    sheet.getRange(sheet.getLastRow()+1,1,1,USER_HEADERS.length).setValues([[username,passwordHash_(username,password,properties),role,active,now,'']]);
  } else {
    sheet.getRange(found.row,3).setValue(role); sheet.getRange(found.row,4).setValue(active);
    if(password) {if(password.length<8||password.length>128) throw new Error('รหัสผ่านต้องยาว 8-128 ตัวอักษร');sheet.getRange(found.row,2).setValue(passwordHash_(found.values[0],password,properties));}
  }
  return {ok:true,message:found?'ปรับปรุงผู้ใช้แล้ว':'เพิ่มผู้ใช้แล้ว'};
}
function deleteUser_(auth,body,book) {
  requireAdmin_(auth);
  var username=String(body.username||'').trim();
  if(username===String(auth.username||'')) throw new Error('ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่');
  var sheet=usersSheet_(book), found=findUser_(sheet,username);
  if(!found) throw new Error('ไม่พบผู้ใช้');
  sheet.deleteRow(found.row);
  return {ok:true,message:'ลบผู้ใช้แล้ว'};
}
function logout_(body) {
  try {if(typeof body.sessionToken==='string'&&body.sessionToken) CacheService.getScriptCache().remove('wh-session-'+body.sessionToken);} catch(error) {}
  return {ok:true};
}
function requireAdmin_(auth) {if(!auth||auth.legacy||auth.role!=='admin') throw new Error('ต้องใช้สิทธิ์ผู้ดูแลระบบ');}
function usersSheet_(book) {
  var sheet=book.getSheetByName('Users');
  if(!sheet) {sheet=book.insertSheet('Users');sheet.getRange(1,1,1,USER_HEADERS.length).setValues([USER_HEADERS]);sheet.setFrozenRows(1);}
  if(sheet.getRange(1,1,1,USER_HEADERS.length).getValues()[0].join('|')!==USER_HEADERS.join('|')) throw new Error('หัวตาราง Users ไม่ตรงกับระบบ');
  return sheet;
}
function findUser_(sheet,username) {
  var last=sheet.getLastRow(); if(last<2) return null;
  var wanted=String(username).toLowerCase(), values=sheet.getRange(2,1,last-1,USER_HEADERS.length).getValues();
  for(var i=0;i<values.length;i++) if(String(values[i][0]||'').toLowerCase()===wanted) return {row:i+2,values:values[i]};
  return null;
}
function passwordHash_(username,password,properties) {
  var salt=properties.getProperty('PASSWORD_SALT');
  if(!salt) {salt=Utilities.getUuid();properties.setProperty('PASSWORD_SALT',salt);}
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(username).toLowerCase()+':'+salt+':'+password,Utilities.Charset.UTF_8);
  return bytes.map(function(value){var n=value<0?value+256:value;return ('0'+n.toString(16)).slice(-2);}).join('');
}
function isActive_(value) {return value===true||String(value).toLowerCase()==='true'||String(value)==='1';}
function dateValue_(value) {return value instanceof Date?value.toISOString():value?String(value):'';}

function receiveBatch_(sheet,receipts,auth) {
  if(!Array.isArray(receipts)||receipts.length<1||receipts.length>20) throw new Error('จำนวนรายการต่อชุดต้องอยู่ระหว่าง 1 ถึง 20');
  receipts=receipts.map(function(r){return bindEmployee_(r,auth);});
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
    return {ok:true,results:results};
  } finally { lock.releaseLock(); }
}

function bindEmployee_(receipt,auth) {
  if(auth&&auth.username) {
    if(receipt&&receipt.employee&&String(receipt.employee).trim()!==String(auth.username)) throw new Error('รายการรอส่งเป็นของผู้ใช้อื่น กรุณาเข้าสู่ระบบด้วย username เดิม');
    receipt.employee=auth.username;
  }
  return validate_(receipt);
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
  if(!/^FR(?:00[1-9]|0[1-9][0-9]|100)$/.test(r.location)) throw new Error('ตำแหน่งจัดเก็บต้องเลือก FR001-FR100');
  if(!isFinite(Number(r.quantity))||Number(r.quantity)<=0||Number(r.quantity)>1000000000) throw new Error('จำนวนรับไม่ถูกต้อง');
  if(typeof r.createdAt!=='string'||!isFinite(Date.parse(r.createdAt))) throw new Error('เวลาสแกนไม่ถูกต้อง');
  return r;
}
function safeCell_(value){return typeof value==='string'&&/^[=+@\-\t\r\n]/.test(value)?"'"+value:value;}
function equal_(a,b){var mismatch=a.length^b.length;for(var i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;}
function allowedOrigin_(origin) {
  return typeof origin==='string'&&(/^https:\/\/jrh91234\.github\.io$/.test(origin)||/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin));
}
function iframe_(body,requestId,origin) {
  if(!allowedOrigin_(origin)) return HtmlService.createHtmlOutput('');
  var message=JSON.stringify({type:'wh-receive-response',requestId:requestId,result:body}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  // Google wraps this HTML in a sandbox iframe. Send to ancestors using an exact
  // target origin so only our app receives it, including when the app is embedded.
  var script='var message='+message+',target='+JSON.stringify(origin)+';var recipient=window;while(recipient!==recipient.parent){recipient=recipient.parent;recipient.postMessage(message,target);}';
  var output=HtmlService.createHtmlOutput('<!doctype html><html><body><script>'+script+'<\/script></body></html>');
  return HtmlService.XFrameOptionsMode&&output.setXFrameOptionsMode ? output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) : output;
}

function deleteReceipt_(sheet,id,auth) {
  if(!auth||auth.legacy||!auth.username) throw new Error('ต้องเข้าสู่ระบบก่อนลบรายการ');
  id=String(id||'').trim();
  if(!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('รหัสรายการไม่ถูกต้อง');
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(25000)) throw new Error('มีรายการกำลังแก้ไข กรุณาลองอีกครั้ง');
  try {
    var last=sheet.getLastRow();
    if(last<2) throw new Error('ไม่พบรายการรับเข้า');
    var found=sheet.getRange(2,1,last-1,1).createTextFinder(id).matchEntireCell(true).useRegularExpression(false).findNext();
    if(!found) throw new Error('ไม่พบรายการรับเข้า หรือรายการถูกลบไปแล้ว');
    var row=found.getRow(), employee=String(sheet.getRange(row,4).getValue()||'').trim();
    if(auth.role!=='admin'&&employee.toLowerCase()!==String(auth.username).trim().toLowerCase()) throw new Error('ลบได้เฉพาะรายการของตนเอง');
    sheet.deleteRow(row);
    SpreadsheetApp.flush();
    return {ok:true,id:id,message:'ลบรายการรับเข้าแล้ว'};
  } finally { lock.releaseLock(); }
}
function json_(body){return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);}
