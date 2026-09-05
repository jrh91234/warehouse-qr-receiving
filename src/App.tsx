import { useState, useEffect, useRef } from 'react';
import QrScanner from 'qr-scanner';
import { Box, ScanLine, History, Settings, ArrowUpRight, ArrowRight, Camera, ImagePlus, Keyboard, Check, X, Wifi, WifiOff, RotateCw, PackageCheck, ChevronRight, CircleAlert, ScanQrCode, LoaderCircle, LockKeyhole, Users, UserPlus, ShieldCheck, LogOut } from 'lucide-react';
import { LOCATION_CODES, parseQR, validateReceipt, validApiUrl } from './core.mjs';

type Fields = {materialCode:string;materialName:string;specification:string;lotNumber:string;warehouse:string;location:string;quantity:string;unit:string;notes:string};
type Receipt = Fields & {id:string;rawQR:string;employee:string;createdAt:string;status:'pending'|'synced'|'duplicate';error?:string;serverTime?:string;apiUrl:string};
type Config = {apiUrl:string;sheetUrl:string};
type User = {username:string;role:'admin'|'receiver'};
type ManagedUser = User & {active:boolean;createdAt:string;lastLogin:string};
const empty: Fields = {materialCode:'',materialName:'',specification:'',lotNumber:'',warehouse:'',location:'',quantity:'',unit:'EA',notes:''};
const KEY='wh-receive-v1';
function read<T,>(key:string,fallback:T):T {try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}
function put(key:string,value:unknown){localStorage.setItem(key,JSON.stringify(value));}
function date(value:string){return new Date(value).toLocaleString('th-TH',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}

export default function App(){
  const [view,setView]=useState<'scan'|'history'|'settings'|'admin'>('scan');
  const [config,setConfig]=useState<Config>(read(KEY+'-config',{apiUrl:'',sheetUrl:''}));
  const [configDraft,setConfigDraft]=useState(config);
  const [employee,setEmployee]=useState(read(KEY+'-employee',''));
  const [accessCode,setAccessCode]=useState(()=>sessionStorage.getItem(KEY+'-access')||'');
  const [sessionToken,setSessionToken]=useState(()=>sessionStorage.getItem(KEY+'-session')||'');
  const [user,setUser]=useState<User|null>(()=>{try{return JSON.parse(sessionStorage.getItem(KEY+'-user')||'null') as User|null;}catch{return null;}});
  const [loginUsername,setLoginUsername]=useState('');
  const [loginPassword,setLoginPassword]=useState('');
  const [bootstrapMode,setBootstrapMode]=useState(false);
  const [bootstrapUsername,setBootstrapUsername]=useState('');
  const [bootstrapPassword,setBootstrapPassword]=useState('');
  const [authBusy,setAuthBusy]=useState(false);
  const [adminUsers,setAdminUsers]=useState<ManagedUser[]>([]);
  const [adminForm,setAdminForm]=useState({username:'',password:'',role:'receiver' as 'admin'|'receiver'});
  const [adminLoading,setAdminLoading]=useState(false);
  const [records,setRecords]=useState<Receipt[]>(read(KEY+'-records',[]));
  const recordRef=useRef(records);
  const [fields,setFields]=useState<Fields>({...empty,...read(KEY+'-destination',{})});
  const [rawQR,setRawQR]=useState('');
  const [recognized,setRecognized]=useState(false);
  const [manual,setManual]=useState(false);
  const [manualText,setManualText]=useState('');
  const [scanning,setScanning]=useState(false);
  const [quickMode,setQuickMode]=useState(()=>read(KEY+'-quick',true));
  const [cameraReady,setCameraReady]=useState(false);
  const [online,setOnline]=useState(navigator.onLine);
  const [notice,setNotice]=useState<{message:string;type:'success'|'error'|'info'}|null>(null);
  const [sending,setSending]=useState(false);
  const [testing,setTesting]=useState(false);
  const busy=useRef(false);
  const syncTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const video=useRef<HTMLVideoElement>(null);
  const scanner=useRef<QrScanner|null>(null);
  const file=useRef<HTMLInputElement>(null);
  const form=useRef<HTMLFormElement>(null);
  const today=new Date().toLocaleDateString('en-CA');
  const pending=records.filter(r=>r.status==='pending');
  const completed=records.filter(r=>r.status==='synced'&&new Date(r.createdAt).toLocaleDateString('en-CA')===today);
  const flash=(message:string,type:'success'|'error'|'info'='info')=>setNotice({message,type});
  function saveRecords(next:Receipt[]){put(KEY+'-records',next);recordRef.current=next;setRecords(next);}
  function scheduleSync(){if(!online)return;if(syncTimer.current)clearTimeout(syncTimer.current);syncTimer.current=setTimeout(()=>{syncTimer.current=null;void syncAll();},700);}
  useEffect(()=>{fetch('./config.json').then(r=>r.json()).then((data:Config)=>{if(data.apiUrl&&!read<Config>(KEY+'-config',{apiUrl:'',sheetUrl:''}).apiUrl){setConfig(data);setConfigDraft(data);}}).catch(()=>{});},[]);
  useEffect(()=>{if(user){setEmployee(user.username);put(KEY+'-employee',user.username);}else setEmployee('');},[user]);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{const update=(event:StorageEvent)=>{if(event.key===KEY+'-records'){const next=read<Receipt[]>(KEY+'-records',[]);recordRef.current=next;setRecords(next);}};window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update);},[]);
  useEffect(()=>{if(!scanning||!video.current)return;let cancelled=false;const instance=new QrScanner(video.current,result=>{if(!cancelled){setScanning(false);acceptQR(result.data);}},{preferredCamera:'environment',highlightScanRegion:true,highlightCodeOutline:true,maxScansPerSecond:5,calculateScanRegion:(cameraVideo)=>{const width=cameraVideo.videoWidth;const height=cameraVideo.videoHeight;if(!width||!height)return {x:0,y:0,width:1,height:1};const scale=Math.min(1,960/Math.max(width,height));return {x:0,y:0,width,height,downScaledWidth:Math.max(1,Math.round(width*scale)),downScaledHeight:Math.max(1,Math.round(height*scale))};}});scanner.current=instance;instance.start().then(()=>{if(!cancelled)setCameraReady(true);}).catch((error:Error)=>{if(cancelled)return;setScanning(false);flash(error.name==='NotAllowedError'?'กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์ แล้วลองอีกครั้ง':'เปิดกล้องไม่ได้ ลองใช้ Chrome/Safari ผ่าน HTTPS หรือเลือกรูป QR','error');});return()=>{cancelled=true;instance.destroy();scanner.current=null;setCameraReady(false);};},[scanning]);
  useEffect(()=>{if(view!=='scan')setScanning(false);},[view]);
  useEffect(()=>{if(user&&online&&pending.length&&!busy.current)void syncAll();},[online,user]);
  useEffect(()=>{if(view==='admin'&&user?.role==='admin')void loadUsers();},[view,user?.role]);
  function acceptQR(raw:string){
    try{const parsed=parseQR(raw);const previous=recordRef.current.find(r=>r.rawQR===parsed.raw);if(previous){flash(previous.status==='pending'?'QR นี้อยู่ในรายการรอส่งแล้ว':'เคยรับ QR นี้แล้ว กรุณาตรวจประวัติ','error');return;}
    setRawQR(parsed.raw);setRecognized(parsed.recognized);setFields({...empty,...read(KEY+'-destination',{}),...parsed.data});setManual(false);setManualText('');setView('scan');setNotice(null);navigator.vibrate?.(100);
    }catch(e){flash((e as Error).message,'error');}
  }
  async function request(apiUrl:string,body:object,includeCredentials=true){
    if(!validApiUrl(apiUrl))throw new Error('ยังไม่ได้เชื่อมต่อระบบ กรุณาตั้งค่า Web App URL');
    const credentials=includeCredentials?(sessionToken?{sessionToken}:accessCode.trim()?{accessCode}:{}):{};
    const response=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...body,...credentials}),redirect:'follow',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('ติดต่อ Google Sheets ไม่สำเร็จ');
    const result=await response.json();if(!result.ok)throw new Error(result.message||'บันทึกไม่สำเร็จ');return result;
  }
  async function login(event:React.FormEvent){
    event.preventDefault();setAuthBusy(true);
    try{const result=await request(config.apiUrl,{action:'login',username:loginUsername.trim(),password:loginPassword},false);if(!result.token||!result.user)throw new Error('ระบบไม่ส่งข้อมูลการเข้าสู่ระบบกลับมา');const nextUser=result.user as User;sessionStorage.setItem(KEY+'-session',result.token);sessionStorage.setItem(KEY+'-user',JSON.stringify(nextUser));setSessionToken(result.token);setUser(nextUser);setLoginPassword('');setView('scan');setNotice(null);}
    catch(e){flash((e as Error).message,'error');}
    finally{setAuthBusy(false);}
  }
  async function bootstrapAdmin(event:React.FormEvent){
    event.preventDefault();setAuthBusy(true);
    try{await request(config.apiUrl,{action:'bootstrapAdmin',username:bootstrapUsername.trim(),password:bootstrapPassword});setLoginUsername(bootstrapUsername.trim());setBootstrapPassword('');setBootstrapMode(false);flash('สร้างบัญชีผู้ดูแลแล้ว กรุณาเข้าสู่ระบบ','success');}
    catch(e){flash((e as Error).message,'error');}
    finally{setAuthBusy(false);}
  }
  async function logout(){
    if(pending.length){flash('ยังมีรายการรอส่ง กรุณาส่ง Google Sheets ให้เสร็จก่อนออกจากระบบ','error');return;}
    try{if(config.apiUrl)await request(config.apiUrl,{action:'logout'});}catch{}
    sessionStorage.removeItem(KEY+'-session');sessionStorage.removeItem(KEY+'-user');setSessionToken('');setUser(null);setView('scan');setRawQR('');setNotice(null);
  }
  async function loadUsers(){
    if(!user||user.role!=='admin')return;setAdminLoading(true);
    try{const result=await request(config.apiUrl,{action:'listUsers'});setAdminUsers(Array.isArray(result.users)?result.users:[]);}
    catch(e){flash((e as Error).message,'error');}
    finally{setAdminLoading(false);}
  }
  async function saveAdminUser(event:React.FormEvent){
    event.preventDefault();setAdminLoading(true);
    try{await request(config.apiUrl,{action:'upsertUser',user:{username:adminForm.username.trim(),password:adminForm.password,role:adminForm.role,active:true}});setAdminForm({username:'',password:'',role:'receiver'});flash('เพิ่มผู้ใช้แล้ว','success');await loadUsers();}
    catch(e){flash((e as Error).message,'error');}
    finally{setAdminLoading(false);}
  }
  async function toggleUser(item:ManagedUser){
    setAdminLoading(true);
    try{await request(config.apiUrl,{action:'upsertUser',user:{username:item.username,password:'',role:item.role,active:!item.active}});flash(item.active?'ปิดใช้งานผู้ใช้แล้ว':'เปิดใช้งานผู้ใช้แล้ว','success');await loadUsers();}
    catch(e){flash((e as Error).message,'error');}
    finally{setAdminLoading(false);}
  }
  async function syncAll(){
    if(busy.current||!online)return;busy.current=true;setSending(true);
    const waiting=[...recordRef.current.filter(r=>r.status==='pending')].slice(0,20);
    if(!waiting.length){busy.current=false;setSending(false);return;}
    let canContinue=false;
    try{
      const result=await request(waiting[0].apiUrl,{action:'receiveBatch',receipts:waiting});
      if(!Array.isArray(result.results)||result.results.length!==waiting.length)throw new Error('คำตอบจากระบบไม่ครบถ้วน รายการยังอยู่ในคิว');
      const byId=new Map<string,{id:string;duplicate?:boolean;replayed?:boolean;serverTime?:string}>(result.results.map((item:{id:string;duplicate?:boolean;replayed?:boolean;serverTime?:string})=>[item.id,item] as [string,{id:string;duplicate?:boolean;replayed?:boolean;serverTime?:string}]));
      saveRecords(recordRef.current.map(r=>{const item=byId.get(r.id);if(!item)return r;return {...r,status:item.duplicate?'duplicate':'synced',serverTime:item.serverTime,error:item.duplicate?'QR นี้มีรายการรับเข้าใน Google Sheets แล้ว':undefined};}));
      const success=result.results.filter((item:{duplicate?:boolean})=>!item.duplicate).length;
      flash(`ส่ง Google Sheets แล้ว ${success} รายการ`,'success');
      canContinue=true;
    }catch(e){saveRecords(recordRef.current.map(r=>waiting.some(item=>item.id===r.id)?{...r,error:(e as Error).message}:r));flash(`${(e as Error).message} · รายการยังอยู่ในเครื่อง กดส่งอีกครั้งได้`,'error');}
    finally{busy.current=false;setSending(false);if(canContinue&&online&&recordRef.current.some(r=>r.status==='pending'))setTimeout(()=>void syncAll(),0);}
  }
  async function submit(event:React.FormEvent){
    event.preventDefault();
    const receipt:Receipt={...fields,id:crypto.randomUUID(),rawQR,employee:user?.username||'',createdAt:new Date().toISOString(),status:'pending',apiUrl:config.apiUrl};
    const issue=validateReceipt(receipt);if(issue){flash(issue,'error');return;}
    if(!validApiUrl(config.apiUrl)||!sessionToken){flash('กรุณาเข้าสู่ระบบใหม่ก่อนรับพาร์ท','error');setView('scan');return;}
    if(recordRef.current.some(r=>r.rawQR===rawQR)){flash('QR นี้อยู่ในประวัติแล้ว','error');return;}
    try{put(KEY+'-employee',user?.username||'');put(KEY+'-destination',{warehouse:fields.warehouse,location:fields.location});saveRecords([receipt,...recordRef.current]);setRawQR('');setFields({...empty,warehouse:fields.warehouse,location:fields.location});}
    catch{flash('พื้นที่จัดเก็บในเครื่องไม่พร้อม ยังไม่ได้บันทึก กรุณาตรวจเบราว์เซอร์','error');return;}
    if(navigator.onLine){flash('รับเข้าคิวแล้ว กำลังส่ง Google Sheets…','info');scheduleSync();if(quickMode)setScanning(true);}else flash('เก็บรายการไว้ในเครื่องแล้ว เมื่อมีอินเทอร์เน็ตให้กด “ส่งรายการรอ”','info');
  }
  const field=(key:keyof Fields,label:string,required=false,placeholder='',type='text')=><label className={key==='materialName'||key==='notes'?'wide':''}>{label}{required&&<span className="required"> *</span>}<input type={type} required={required} value={fields[key]} onChange={e=>setFields({...fields,[key]:e.target.value})} placeholder={placeholder} maxLength={500} {...(type==='number'?{min:0.001,step:'any',inputMode:'decimal' as const}:{})}/></label>;
  const locationField=<label>ตำแหน่งจัดเก็บ <span className="required">*</span><select required value={fields.location} onChange={e=>setFields({...fields,location:e.target.value})}><option value="">เลือกตำแหน่งจัดเก็บ</option>{LOCATION_CODES.map(code=><option key={code} value={code}>{code}</option>)}</select><small>พิมพ์ FR001–FR100 เพื่อค้นหาจากรายการ</small></label>;
  const navigation=(<><button className={view==='scan'?'active':''} onClick={()=>setView('scan')}><ScanLine size={20}/><span>รับพาร์ท</span><ChevronRight className="nav-arrow" size={16}/></button><button className={view==='history'?'active':''} onClick={()=>setView('history')}><History size={20}/><span>ประวัติการรับ</span>{pending.length>0&&<b className="count">{pending.length}</b>}</button>{user?.role==='admin'&&<button className={view==='admin'?'active':''} onClick={()=>setView('admin')}><ShieldCheck size={20}/><span>Admin panel</span><ChevronRight className="nav-arrow" size={16}/></button>}<button className={view==='settings'?'active':''} onClick={()=>{setConfigDraft(config);setView('settings');}}><Settings size={20}/><span>ตั้งค่า</span></button><button className="logout-nav" onClick={logout}><LogOut size={20}/><span>ออกจากระบบ</span></button></>);
  if(!user) return <div className="auth-shell"><div className="auth-card"><div className="auth-brand"><span className="brand-icon"><Box size={25}/></span><span>WH<span className="brand-light"> Receive</span><small>WAREHOUSE OPERATIONS</small></span></div><div className="auth-eyebrow">{bootstrapMode?'FIRST-TIME SETUP':'WAREHOUSE OPERATIONS'}</div><h1>{bootstrapMode?'สร้างผู้ดูแลระบบ':'เข้าสู่ระบบรับพาร์ท'}</h1><p>{bootstrapMode?'สร้างบัญชี Admin คนแรกสำหรับจัดการผู้ใช้งาน':'ใช้ชื่อผู้ใช้และรหัสผ่านของคุณเพื่อเริ่มรับพาร์ท'}</p>{notice&&<div className={'notice '+notice.type} role="status">{notice.type==='success'?<Check size={20}/>:<CircleAlert size={20}/>}<span>{notice.message}</span><button aria-label="ปิดข้อความ" onClick={()=>setNotice(null)}><X size={18}/></button></div>}{bootstrapMode?<form className="auth-form" onSubmit={bootstrapAdmin}><label>รหัสเข้าใช้งานผู้ดูแล<LockKeyhole size={15}/><input required type="password" autoComplete="off" value={accessCode} onChange={e=>setAccessCode(e.target.value)} placeholder="ACCESS_CODE"/></label><label>ชื่อผู้ใช้ Admin<input required autoComplete="username" value={bootstrapUsername} onChange={e=>setBootstrapUsername(e.target.value)} placeholder="เช่น admin" maxLength={100}/></label><label>รหัสผ่าน<input required type="password" autoComplete="new-password" value={bootstrapPassword} onChange={e=>setBootstrapPassword(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" minLength={8} maxLength={128}/></label><button className="primary-button" disabled={authBusy}>{authBusy?<LoaderCircle className="spin" size={18}/>:<UserPlus size={18}/>}สร้างบัญชี Admin</button></form>:<form className="auth-form" onSubmit={login}><label>ชื่อผู้ใช้<input required autoComplete="username" value={loginUsername} onChange={e=>setLoginUsername(e.target.value)} placeholder="เช่น WH-001" maxLength={100}/></label><label>รหัสผ่าน<input required type="password" autoComplete="current-password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} placeholder="รหัสผ่าน" maxLength={128}/></label><button className="primary-button" disabled={authBusy}>{authBusy?<LoaderCircle className="spin" size={18}/>:<ArrowRight size={18}/>}เข้าสู่ระบบ</button></form>}<button className="auth-link" onClick={()=>{setBootstrapMode(!bootstrapMode);setNotice(null);}}>{bootstrapMode?'มีบัญชีแล้ว? เข้าสู่ระบบ':'ตั้งค่าครั้งแรก / สร้าง Admin'}</button><small className="auth-footnote">ชื่อผู้ใช้ที่เข้าสู่ระบบจะถูกบันทึกเป็นชื่อ / รหัสผู้รับอัตโนมัติ</small></div></div>;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="./"><span className="brand-icon"><Box size={25}/></span><span>WH<span className="brand-light"> Receive</span><small>WAREHOUSE OPERATIONS</small></span></a><div className="nav-caption">พื้นที่ทำงาน</div><nav>{navigation}</nav><div className="sidebar-bottom"><div className="system-dot"/>ระบบรับพาร์ทเข้าคลัง<small>QR RECEIVING · V1.0</small></div></aside>
    <div className="workspace"><header className="topbar"><span className="breadcrumb">Warehouse <ChevronRight size={14}/><strong>{view==='scan'?'รับพาร์ทเข้าคลัง':view==='history'?'ประวัติการรับ':view==='admin'?'Admin panel':'ตั้งค่าการเชื่อมต่อ'}</strong></span><span className={'connection '+(!online?'offline':'')}><i/>{online?'ออนไลน์':'ออฟไลน์'}<b className="user-chip">{user.username}</b></span></header>
    <main><div className="page-heading"><div><div className="eyebrow">{view==='scan'?'INBOUND RECEIVING':view==='history'?'RECEIVING HISTORY':view==='admin'?'ADMINISTRATION':'WORKSPACE SETTINGS'}</div><h1>{view==='scan'?'รับพาร์ทเข้าคลัง':view==='history'?'ประวัติการรับพาร์ท':view==='admin'?'จัดการผู้ใช้งาน':'ตั้งค่าการเชื่อมต่อ'}</h1><p>{view==='scan'?'สแกนป้าย ตรวจสอบข้อมูล แล้วรับพาร์ทเข้าคลัง':view==='history'?'รายการที่บันทึกจากอุปกรณ์นี้':view==='admin'?'เพิ่ม ปิดใช้งาน และกำหนดสิทธิ์บัญชีผู้รับพาร์ท':'เชื่อมต่อ Google Sheets และดูบัญชีที่เข้าสู่ระบบ'}</p></div><div className="date-label">{new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'})}</div></div>
    {notice&&<div className={'notice '+notice.type} role="status">{notice.type==='success'?<Check size={20}/>:<CircleAlert size={20}/>}<span>{notice.message}</span><button aria-label="ปิดข้อความ" onClick={()=>setNotice(null)}><X size={18}/></button></div>}
    {(view==='scan'||view==='history')&&<div className="stats"><div><span className="stat-icon green"><PackageCheck size={21}/></span><div><span>รับสำเร็จวันนี้</span><strong>{completed.length}<small> รายการ</small></strong></div></div><div><span className="stat-icon amber"><RotateCw size={20}/></span><div><span>รอส่งข้อมูล</span><strong>{pending.length}<small> รายการ</small></strong></div>{pending.length>0&&<button className="text-button" disabled={sending||!online} onClick={syncAll}>{sending?'กำลังส่ง…':'ส่งรายการรอ'}<ArrowUpRight size={16}/></button>}</div><div className="sheet-stat"><span className="stat-icon neutral"><Box size={20}/></span><div><span>ปลายทางข้อมูล</span><strong className="stat-destination">Google Sheets</strong><small>{config.apiUrl?'ตั้งค่าปลายทางแล้ว':'รอเชื่อมต่อระบบ'}</small></div><button className="icon-button" aria-label="ตั้งค่าปลายทาง" onClick={()=>setView('settings')}><ArrowUpRight size={20}/></button></div></div>}
    {view==='scan'&&<>
      {!config.apiUrl&&<div className="setup-strip"><span><CircleAlert size={17}/>ตั้งค่าการเชื่อมต่อ Google Sheets ก่อนบันทึกรายการแรก</span><button onClick={()=>setView('settings')}>ตั้งค่าระบบ <ArrowRight size={16}/></button></div>}
      <div className="receiving-grid"><section className="panel scan-panel"><div className="panel-heading"><h2><span className="step-number">01</span>สแกน QR code</h2><span className="micro-label">PART LABEL</span></div>
        <div className={'viewfinder '+(scanning?'is-scanning':'')}>
          {scanning?<><video ref={video} muted playsInline/><div className="live-tag"><i/>{cameraReady?'กล้องพร้อมสแกน':'กำลังเปิดกล้อง…'}</div><button className="stop-camera" onClick={()=>setScanning(false)}>ปิดกล้อง <X size={16}/></button></>:<><div className="scan-corners"><ScanQrCode size={66} strokeWidth={1.25}/></div><h3>{rawQR?'อ่าน QR code แล้ว':'พร้อมรับพาร์ทชิ้นถัดไป'}</h3><p>{rawQR?'ตรวจสอบข้อมูลทางด้านขวาก่อนยืนยัน':'วาง QR code บนป้ายให้อยู่ในกรอบ'}</p><button className="lime-button" onClick={()=>{setNotice(null);setScanning(true);}}><Camera size={19}/>{rawQR?'สแกนใหม่':'เปิดกล้องสแกน'}<ArrowRight size={18}/></button><span className="camera-note">ใช้กล้องหลังของโทรศัพท์</span></>}
        </div><div className="scan-options"><button onClick={()=>file.current?.click()}><ImagePlus size={18}/>เลือกรูป QR</button><span/><button onClick={()=>setManual(!manual)}><Keyboard size={18}/>กรอกรหัสเอง</button></div><label className="quick-toggle"><input type="checkbox" checked={quickMode} onChange={e=>{setQuickMode(e.target.checked);put(KEY+'-quick',e.target.checked);}}/><span className="toggle-track"/><span>โหมดสแกนต่อเนื่อง</span><small>บันทึกเข้าคิวและเปิดกล้องต่อทันที</small></label>
        <input ref={file} hidden type="file" accept="image/*" onChange={async e=>{const uploaded=e.target.files?.[0];if(!uploaded)return;setScanning(false);try{const result=await QrScanner.scanImage(uploaded,{returnDetailedScanResult:true});acceptQR(result.data);}catch{flash('อ่าน QR ในภาพไม่ได้ กรุณาเลือกภาพที่เห็น QR เต็มรูป หรือกรอกรหัสเอง','error');}e.target.value='';}}/>
        {manual&&<form className="manual-form" onSubmit={e=>{e.preventDefault();acceptQR(manualText);}}><label>ข้อความจาก QR / รหัสบนป้าย<textarea required value={manualText} onChange={e=>setManualText(e.target.value)} maxLength={4096} placeholder="สแกนด้วยเครื่องอ่าน หรือพิมพ์รหัสบนป้าย"/></label><button className="secondary-button">ใช้รหัสนี้ <ArrowRight size={16}/></button></form>}
        <div className="scan-tip"><ScanLine size={21}/><p>จัด QR ให้อยู่กลางภาพและขยับเข้าใกล้จนเห็นชัด<br/><span>ถ้ามีตัวหนังสือด้านหลัง ให้เว้นขอบขาวรอบ QR และหลีกเลี่ยงแสงสะท้อน</span></p></div>
      </section><section className="panel detail-panel"><div className="panel-heading"><h2><span className="step-number">02</span>ตรวจสอบและรับเข้า</h2><span className={'pill '+(rawQR?'ready':'')}>{rawQR?'อ่านรหัสแล้ว':'รอสแกน'}</span></div>
        {!rawQR?<div className="empty-detail"><div><Box size={39} strokeWidth={1.3}/></div><h3>ข้อมูลพาร์ทจะแสดงที่นี่</h3><p>เปิดกล้องสแกน QR บนป้ายพาร์ท<br/>หรือเลือกกรอกรหัสเองเพื่อเริ่มรับเข้า</p><span><ScanLine size={15}/> สแกน <ArrowRight size={14}/> ตรวจสอบ <ArrowRight size={14}/> รับเข้า</span></div>:<form ref={form} className="receipt-form" onSubmit={submit}>
          <div className="raw-code"><span>QR ต้นฉบับ</span><code>{rawQR}</code></div>{!recognized&&<p className="form-note">QR นี้ยังไม่มีรูปแบบแยกข้อมูลที่รู้จัก กรุณากรอกข้อมูลตามป้ายด้านล่าง</p>}
          <div className="form-grid">{field('materialCode','Material code',true)}{field('lotNumber','Lot number',true)}{field('materialName','Material name')}{field('specification','Specification')}{field('warehouse','คลังปลายทาง',true)}{locationField}{field('quantity','จำนวนรับจริง',true,'0','number')}{field('unit','หน่วย',true)}<label>ชื่อ / รหัสผู้รับ <span className="required">*</span><input required readOnly value={user.username}/><small>ใช้ username จากการ Login อัตโนมัติ</small></label>{field('notes','หมายเหตุ')}</div>
          <div className="form-actions"><button type="button" className="text-button muted" onClick={()=>setRawQR('')}>ยกเลิก</button><button className="primary-button">{sending?<LoaderCircle className="spin" size={19}/>:<PackageCheck size={19}/>}ยืนยันรับเข้าคลัง<ArrowRight size={18}/></button></div>
        </form>}
      </section></div>
      <section className="panel recent-panel"><div className="panel-heading"><h2>รายการล่าสุด</h2><button className="text-button" onClick={()=>setView('history')}>ดูประวัติทั้งหมด <ArrowRight size={16}/></button></div>{records.length?renderRows(records.slice(0,3)):<div className="empty-history"><History size={23}/><span>ยังไม่มีรายการรับพาร์ทจากอุปกรณ์นี้</span><small>รายการจะแสดงหลังจากยืนยันรับเข้า</small></div>}</section>
    </>}
    {view==='history'&&<section className="panel"><div className="panel-heading"><h2>รายการจากอุปกรณ์นี้ <span className="muted">({records.length})</span></h2><button className="secondary-button" onClick={syncAll} disabled={sending||!pending.length||!online}><RotateCw size={16} className={sending?'spin':''}/>{sending?'กำลังส่ง…':'ส่งรายการรอ'}</button></div><p className="history-note">ประวัติทั้งหมดจากทุกเครื่องอยู่ใน Google Sheets · รายการรอส่งเก็บอยู่ในเบราว์เซอร์นี้ อย่าล้างข้อมูลเว็บไซต์ก่อนส่งสำเร็จ</p>{records.length?renderRows(records):<div className="empty-history"><History size={28}/>ยังไม่มีรายการ</div>}</section>}
    {view==='admin'&&<div className="admin-grid"><section className="panel"><div className="panel-heading"><h2><UserPlus size={20}/>เพิ่มผู้ใช้งาน</h2><span className="micro-label">USER ACCESS</span></div><form className="settings-form" onSubmit={saveAdminUser}><label>ชื่อผู้ใช้<input required autoComplete="off" value={adminForm.username} onChange={e=>setAdminForm({...adminForm,username:e.target.value})} placeholder="เช่น WH-001 หรือ ชื่อพนักงาน" maxLength={100}/><small>ใช้ตัวอักษรไทย/อังกฤษ ตัวเลข จุด ขีด หรือขีดล่าง</small></label><label>รหัสผ่าน<input required type="password" autoComplete="new-password" value={adminForm.password} onChange={e=>setAdminForm({...adminForm,password:e.target.value})} placeholder="อย่างน้อย 8 ตัวอักษร" minLength={8} maxLength={128}/></label><label>สิทธิ์<select value={adminForm.role} onChange={e=>setAdminForm({...adminForm,role:e.target.value as 'admin'|'receiver'})}><option value="receiver">ผู้รับพาร์ท</option><option value="admin">ผู้ดูแลระบบ</option></select></label><button className="primary-button" disabled={adminLoading}><UserPlus size={18}/>เพิ่มผู้ใช้</button></form></section><section className="panel"><div className="panel-heading"><h2><Users size={20}/>บัญชีผู้ใช้งาน <span className="muted">({adminUsers.length})</span></h2><button className="text-button" onClick={()=>void loadUsers()} disabled={adminLoading}><RotateCw size={15} className={adminLoading?'spin':''}/>รีเฟรช</button></div>{adminUsers.length?<div className="user-list">{adminUsers.map(item=><div className="user-row" key={item.username}><div className="user-avatar"><Users size={18}/></div><div className="user-main"><strong>{item.username}</strong><span>{item.role==='admin'?'ผู้ดูแลระบบ':'ผู้รับพาร์ท'} · {item.lastLogin?'เข้าสู่ระบบล่าสุด '+date(item.lastLogin):'ยังไม่เคยเข้าสู่ระบบ'}</span></div><span className={'user-state '+(item.active?'active':'inactive')}>{item.active?'ใช้งานอยู่':'ปิดใช้งาน'}</span><button type="button" className="secondary-button user-toggle" disabled={adminLoading||item.username===user.username} onClick={()=>void toggleUser(item)}>{item.active?'ปิดใช้งาน':'เปิดใช้งาน'}</button></div>)}</div>:<div className="empty-history"><Users size={24}/>ยังไม่มีบัญชีผู้ใช้</div>}<p className="history-note">ผู้ใช้ที่ Login แล้วจะถูกบันทึกเป็นชื่อ / รหัสผู้รับในทุกรายการรับเข้าโดยอัตโนมัติ</p></section></div>}
    {view==='settings'&&<div className="settings-grid"><section className="panel"><div className="panel-heading"><h2><Settings size={20}/>การเชื่อมต่อ</h2><span className="micro-label">GOOGLE SHEETS</span></div><form className="settings-form" onSubmit={e=>{e.preventDefault();if(!validApiUrl(configDraft.apiUrl)){flash('URL ต้องเป็น https://script.google.com/macros/s/…/exec','error');return;}if(configDraft.sheetUrl&&!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(?:\/.*)?$/.test(configDraft.sheetUrl)){flash('ลิงก์ชีตต้องเป็น Google Sheets URL','error');return;}try{put(KEY+'-config',configDraft);put(KEY+'-employee',user.username);if(accessCode.trim())sessionStorage.setItem(KEY+'-access',accessCode);setConfig(configDraft);flash('บันทึกการตั้งค่าแล้ว','success');}catch{flash('บันทึกการตั้งค่าไม่ได้ กรุณาอนุญาตพื้นที่จัดเก็บของเบราว์เซอร์','error');}}}>
      <label>ชื่อ / รหัสผู้รับพาร์ท<input required readOnly maxLength={100} value={user.username}/><small>ใช้ username จากการ Login อัตโนมัติ</small></label><label>Web App URL<input required type="url" value={configDraft.apiUrl} onChange={e=>setConfigDraft({...configDraft,apiUrl:e.target.value.trim()})} placeholder="https://script.google.com/macros/s/…/exec"/><small>ใช้ URL ที่ได้จากการ Deploy Google Apps Script</small></label><label>ลิงก์ Google Sheets<input type="url" value={configDraft.sheetUrl} onChange={e=>setConfigDraft({...configDraft,sheetUrl:e.target.value.trim()})} placeholder="https://docs.google.com/spreadsheets/d/…"/></label><label>รหัสผู้ดูแลเดิม<LockKeyhole size={15}/><input type="password" autoComplete="off" value={accessCode} onChange={e=>setAccessCode(e.target.value)} placeholder="ใช้เฉพาะการตั้งค่าระบบเดิม"/><small>ระบบ Login ใช้ username/password แล้ว ไม่ต้องกรอกช่องนี้สำหรับการรับพาร์ท</small></label><div className="settings-actions"><button className="primary-button"><Check size={18}/>บันทึกการตั้งค่า</button><button type="button" className="secondary-button" disabled={testing} onClick={async()=>{setTesting(true);try{await request(configDraft.apiUrl,{action:'ping'});flash('เชื่อมต่อ Google Sheets สำเร็จ พร้อมรับพาร์ท','success');}catch(e){flash((e as Error).message,'error');}finally{setTesting(false);}}}>{testing?<LoaderCircle className="spin" size={17}/>:<Wifi size={17}/>}ทดสอบการเชื่อมต่อ</button></div>
    </form></section><aside className="setup-help"><span className="help-icon"><Box size={28}/></span><h2>เริ่มต้นใช้งาน</h2><ol><li>ผู้ดูแลตั้งค่า Google Sheets กับ Apps Script</li><li>สร้างบัญชี Admin ครั้งแรกด้วย ACCESS_CODE</li><li>เพิ่มบัญชีพนักงานใน Admin panel แล้วให้แต่ละคน Login</li></ol><p>ระบบจะใช้ username ของผู้ที่ Login เป็นชื่อ / รหัสผู้รับในรายการรับเข้า ใช้ Chrome บน Android หรือ Safari บน iPhone และอนุญาตกล้องเมื่อเริ่มสแกน</p></aside></div>}
    <footer><span><Box size={14}/> WH Receive</span><span>ข้อมูลการรับเข้า · Google Sheets{config.sheetUrl&&/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(config.sheetUrl)&&<a href={config.sheetUrl} target="_blank" rel="noreferrer">เปิดชีต <ArrowUpRight size={14}/></a>}</span></footer>
    </main></div><nav className="mobile-nav">{navigation}</nav>
  </div>;
  function renderRows(items:Receipt[]){return <div className="records-list">{items.map(r=><div className="record-row" key={r.id}><span className="record-icon"><Box size={21}/></span><div className="record-main"><strong>{r.materialCode}</strong><span>Lot {r.lotNumber} · {r.location}</span>{r.error&&<small className="error-text">{r.error}</small>}</div><div className="record-quantity"><strong>{r.quantity} <small>{r.unit}</small></strong><span>{date(r.createdAt)}</span></div><span className={'record-status '+r.status}>{r.status==='synced'?<><Check size={14}/>บันทึกแล้ว</>:r.status==='duplicate'?'รายการซ้ำ':<><RotateCw size={13}/>รอส่ง</>}</span></div>)}</div>;}
}
