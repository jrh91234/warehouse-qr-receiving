import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const source=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
const sample={id:'11111111-1111-4111-8111-111111111111',rawQR:'QR-auth-001',employee:'WH-001',materialCode:'000123',materialName:'Part',specification:'',lotNumber:'0001',warehouse:'Main',location:'FR001',quantity:25,unit:'EA',notes:'',createdAt:'2026-09-05T00:00:00Z'};

function backend(){
  const rowsBySheet={Receipts:[['Request ID','Received at','Scanned at','Employee','Raw QR','Material code','Material name','Specification','Lot number','Warehouse','Location','Quantity','Unit','Notes']]};
  const properties={ACCESS_CODE:'testing-code-123456',SPREADSHEET_ID:'test-sheet'};
  const cache=new Map(); let uuid=0;
  function sheet(name){
    const rows=rowsBySheet[name];
    return {
      getLastRow:()=>rows.length,getMaxRows:()=>1000,insertRowsAfter(){},setFrozenRows(){},deleteRow:row=>rows.splice(row-1,1),
      getRange(row,col,count=1,width=1){
        const api={
          getValues:()=>Array.from({length:count},(_,r)=>Array.from({length:width},(_,c)=>(rows[row-1+r]||[])[col-1+c])),
          getValue:()=>(rows[row-1]||[])[col-1],
          setValues:values=>{values.forEach((value,r)=>{while(rows.length<=row-1+r)rows.push([]);value.forEach((cell,c)=>{rows[row-1+r][col-1+c]=cell;});});return api;},
          setValue:value=>{while(rows.length<row)rows.push([]);while((rows[row-1]||[]).length<col)rows[row-1].push('');rows[row-1][col-1]=value;return api;},
          setNumberFormat:()=>api,
          createTextFinder:value=>({matchEntireCell(){return this;},useRegularExpression(){return this;},findNext(){for(let r=Math.max(1,row-1);r<Math.min(rows.length,row-1+count);r++)if(String((rows[r]||[])[col-1]??'')===String(value))return {getRow:()=>r+1};return null;}})
        }; return api;
      }
    };
  }
  const ctx={
    ContentService:{MimeType:{JSON:'JSON'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties[key]||null,setProperty:(key,value)=>{properties[key]=value;}})},
    CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA-256'},Charset:{UTF_8:'UTF-8'},getUuid:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`,computeDigest:(_,value)=>Array.from(createHash('sha256').update(value,'utf8').digest())},
    SpreadsheetApp:{openById:()=>({getSheetByName:name=>rowsBySheet[name]?sheet(name):null,insertSheet:name=>{rowsBySheet[name]=[[]];return sheet(name);}}),flush(){}}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,post:body=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(body)}}).text),rows:rowsBySheet};
}

test('first admin bootstrap, user login, and username-bound receipt',()=>{
  const b=backend();
  assert.equal(b.post({action:'bootstrapAdmin',accessCode:'testing-code-123456',username:'admin',password:'AdminPass123'}).ok,true);
  const admin=b.post({action:'login',username:'admin',password:'AdminPass123'});
  assert.equal(admin.ok,true); assert.equal(admin.user.role,'admin');
  assert.equal(b.post({action:'upsertUser',sessionToken:admin.token,user:{username:'WH-001',password:'Receiver123',role:'receiver',active:true}}).ok,true);
  const receiver=b.post({action:'login',username:'WH-001',password:'Receiver123'});
  assert.equal(receiver.ok,true); assert.equal(receiver.user.username,'WH-001');
  const saved=b.post({action:'receive',sessionToken:receiver.token,receipt:{...sample}});
  assert.equal(saved.ok,true); assert.equal(b.rows.Receipts[1][3],'WH-001');
  assert.equal(b.post({action:'receive',sessionToken:receiver.token,receipt:{...sample,id:'22222222-2222-4222-8222-222222222222',rawQR:'QR-auth-002',employee:'WH-002'}}).ok,false);
  assert.equal(b.post({action:'listUsers',sessionToken:receiver.token}).ok,false);
  assert.equal(b.post({action:'listUsers',sessionToken:admin.token}).users.length,2);
});
