import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, can, permissionMap, audit, ROLES, RESOURCES, ACTIONS, STATUSES } from './db.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const DATA_DIR=resolve(process.env.DATA_DIR||join(ROOT,'var'));
const PORT=Number(process.env.PORT||8080);
const HOST=process.env.HOST||'127.0.0.1';
const IS_PROD=process.env.NODE_ENV==='production';
const SESSION_MS=12*60*60*1000;
const IDLE_MS=60*60*1000;
const MAX_BODY=48*1024;
export const db=openDatabase(join(DATA_DIR,'rescue1.sqlite'));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};

export function hashPassword(password){
  const salt=crypto.randomBytes(24).toString('hex');
  const digest=crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024}).toString('hex');
  return 'scrypt$'+salt+'$'+digest;
}
function verifyPassword(password,stored){
  if(typeof stored!=='string'||!stored.startsWith('scrypt$')) return false;
  const parts=stored.split('$');
  if(parts.length!==3) return false;
  const expected=Buffer.from(parts[2],'hex');
  if(expected.length!==64) return false;
  const actual=crypto.scryptSync(password,parts[1],64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
  return crypto.timingSafeEqual(actual,expected);
}
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
const fail=(status,message)=>Object.assign(new Error(message),{status});
function check(value,key,{required=false,max=500,kind='text'}={}){
  if(value===undefined||value===null||value===''){
    if(required)throw fail(400,key+' is required');
    return '';
  }
  if(typeof value!=='string'||value.length>max)throw fail(400,'Invalid '+key);
  const clean=value.trim();
  if(required&&!clean)throw fail(400,key+' is required');
  if(kind==='email'&&clean&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))throw fail(400,'Invalid email');
  if(kind==='date'&&clean&&!/^\d{4}-\d{2}-\d{2}$/.test(clean))throw fail(400,'Invalid date');
  if(kind==='time'&&clean&&!/^\d{2}:\d{2}$/.test(clean))throw fail(400,'Invalid time');
  return clean;
}
function safeMoney(value){
  if(!Number.isSafeInteger(value)||value<0||value>99999999999)throw fail(400,'Invalid amount in cents');
  return value;
}
function json(res,status,payload,headers={}){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
  res.end(JSON.stringify(payload));
}
function readJson(req){
  return new Promise((resolve,reject)=>{
    let count=0,text='';
    req.on('data',chunk=>{
      count+=chunk.length;
      if(count>MAX_BODY){reject(fail(413,'Request too large'));req.destroy();return;}
      text+=chunk.toString('utf8');
    });
    req.on('end',()=>{
      try{const result=JSON.parse(text||'{}');if(!result||typeof result!=='object'||Array.isArray(result))throw 0;resolve(result);}
      catch{reject(fail(400,'Invalid JSON body'));}
    });
    req.on('error',reject);
  });
}
function cookie(req,name){
  const source=req.headers.cookie||'';
  const field=source.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  return field?.slice(name.length+1)||'';
}
function sessionUser(req){
  const token=cookie(req,'r1_session');
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  const row=db.prepare('SELECT s.token_hash,s.csrf,s.expires_at,s.last_used,p.id,p.email,p.name,p.role,p.active,p.change_password FROM sessions s JOIN staff p ON p.id=s.staff_id WHERE s.token_hash=?').get(hash);
  if(!row)return null;
  const current=Date.now();
  if(!row.active||row.expires_at<current||current-row.last_used>IDLE_MS){
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);
    return null;
  }
  db.prepare('UPDATE sessions SET last_used=? WHERE token_hash=?').run(current,hash);
  return row;
}
function protect(req,user,resource,action='view'){
  if(!user)throw fail(401,'Sign in required');
  if(user.change_password&&resource!=='password')throw fail(403,'Change your temporary password first');
  if(resource!=='password'&&!can(db,user,resource,action))throw fail(403,'Your role does not permit this action');
}
function csrf(req,user){
  if(!user||!req.headers['x-csrf-token']||req.headers['x-csrf-token']!==user.csrf)throw fail(403,'Security token missing or invalid');
  const origin=req.headers.origin;
  if(origin){
    const host=req.headers.host;
    try{if(new URL(origin).host!==host)throw fail(403,'Origin mismatch');}
    catch(e){throw e.status?e:fail(403,'Invalid request origin');}
  }
}
function getClientKey(req,subject){
  const proxy=process.env.TRUST_PROXY==='1';
  const forwarded=proxy?String(req.headers['x-forwarded-for']||'').split(',')[0].trim():'';
  return (forwarded||req.socket.remoteAddress||'unknown')+':'+subject;
}
function limitLogin(key,count=8,windowMs=15*60*1000){
  const threshold=Date.now()-windowMs;
  db.prepare('DELETE FROM login_attempts WHERE created_at<?').run(threshold);
  const found=db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key=?').get(key).n;
  if(found>=count)throw fail(429,'Too many attempts. Try again later');
  db.prepare('INSERT INTO login_attempts(key,created_at) VALUES (?,?)').run(key,Date.now());
}
function clearAttempts(key){db.prepare('DELETE FROM login_attempts WHERE key=?').run(key);}
function issueSession(res,user){
  const token=crypto.randomBytes(32).toString('hex');
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  const csrfToken=crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,staff_id,csrf,expires_at,last_used) VALUES (?,?,?,?,?)')
    .run(tokenHash,user.id,csrfToken,Date.now()+SESSION_MS,Date.now());
  res.setHeader('set-cookie','r1_session='+token+'; Path=/; HttpOnly; SameSite=Strict'+(IS_PROD?'; Secure':'')+'; Max-Age=43200');
  return csrfToken;
}
function clearSession(res,user){
  if(user)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);
  res.setHeader('set-cookie','r1_session=; Path=/; HttpOnly; SameSite=Strict'+(IS_PROD?'; Secure':'')+'; Max-Age=0');
}
function exists(table,id){
  return Boolean(db.prepare('SELECT id FROM '+table+' WHERE id=?').get(id));
}
function staffScope(reqUser){
  return reqUser.role==='crew';
}
const SCHEMA={
 customers:{fields:['name','phone','email','notes'],required:['name']},
 leads:{fields:['customer_name','phone','email','service','origin','destination','requested_date','status','notes'],required:['customer_name','phone','origin']},
 jobs:{fields:['customer_name','phone','origin','destination','move_date','start_time','status','service','crew_notes','lead_id'],required:['customer_name','origin','move_date']},
 expenses:{fields:['vendor','category','amount_cents','incurred_on','memo','job_id'],required:['vendor','category','incurred_on','amount_cents']},
 invoices:{fields:['job_id','customer_name','invoice_number','amount_cents','due_date','status','memo'],required:['customer_name','invoice_number','amount_cents']},
 leave:{table:'leave_requests',fields:['start_date','end_date','leave_type','note'],required:['start_date','end_date']},
 time:{table:'time_entries',fields:['note'],required:[]}
};
function getTable(resource){return SCHEMA[resource]?.table||resource;}
function sanitize(resource,input,patch=false){
  const schema=SCHEMA[resource];
  if(!schema)throw fail(404,'Unknown resource');
  const result={};
  for(const field of schema.fields){
    if(!(field in input)){if(!patch&&schema.required.includes(field))throw fail(400,field+' is required');continue;}
    const val=input[field];
    if(field==='amount_cents'){result[field]=safeMoney(val);continue;}
    if(field==='status'){
      if(!STATUSES[resource]?.includes(val))throw fail(400,'Invalid status');
      result[field]=val;
      continue;
    }
    if(field==='job_id'||field==='lead_id'){
      result[field]=val===null||val===''?null:check(val,field,{max:70});
      if(result[field]&&!exists(field==='job_id'?'jobs':'leads',result[field]))throw fail(400,'Unknown '+field);
      continue;
    }
    const required=schema.required.includes(field);
    const kind=field==='email'?'email':field==='move_date'||field==='requested_date'||field==='incurred_on'||field==='due_date'||field==='start_date'||field==='end_date'?'date':field==='start_time'?'time':'text';
    result[field]=check(val,field,{required,max:field==='notes'||field==='crew_notes'||field==='memo'?4000:field==='email'?255:350,kind});
  }
  if(!patch&&resource==='expenses'&&result.amount_cents===undefined)throw fail(400,'Amount required');
  if(!patch&&resource==='invoices'&&result.amount_cents===undefined)throw fail(400,'Amount required');
  return result;
}
function createRecord(resource,body,user){
  protect(null,user,resource,'create');
  const table=getTable(resource);
  const fields=sanitize(resource,body);
  const id=uid();
  const stamp=now();
  if(resource==='leave'){fields.staff_id=user.id;fields.status='pending';}
  if(resource==='expenses'){fields.submitted_by=user.id;fields.status='pending';}
  if(resource==='invoices')fields.paid_cents=0;
  fields.created_at=stamp;
  const keys=['id',...Object.keys(fields)], values=[id,...Object.values(fields)];
  db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...values);
  audit(db,user,'create',resource,id);
  return db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id);
}
function readRecord(resource,id,user){
  const table=getTable(resource);
  let row=db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id);
  if(!row)throw fail(404,'Record not found');
  if(staffScope(user)&&resource==='jobs'&&!db.prepare('SELECT 1 FROM assignments WHERE job_id=? AND staff_id=?').get(id,user.id))throw fail(403,'Not assigned to this job');
  if(staffScope(user)&&['time','leave'].includes(resource)&&row.staff_id!==user.id)throw fail(403,'Not your record');
  return row;
}
function listRecords(resource,user){
  const table=getTable(resource);
  if(staffScope(user)&&resource==='jobs'){
    return db.prepare('SELECT j.* FROM jobs j JOIN assignments a ON j.id=a.job_id WHERE a.staff_id=? ORDER BY j.move_date DESC LIMIT 300').all(user.id);
  }
  if(staffScope(user)&&['time','leave'].includes(resource)){
    return db.prepare('SELECT * FROM '+table+' WHERE staff_id=? ORDER BY created_at DESC LIMIT 300').all(user.id);
  }
  return db.prepare('SELECT * FROM '+table+' ORDER BY created_at DESC LIMIT 500').all();
}
function patchRecord(resource,id,body,user){
  const row=readRecord(resource,id,user);
  let fields=sanitize(resource,body,true);
  if(resource==='time'){
    if(user.id===row.staff_id&&fields.note!==undefined&&row.ended_at===null){ /* own live entry note */ }
    else if(!can(db,user,'time','approve'))throw fail(403,'Only an approver can modify this entry');
    if(can(db,user,'time','approve')&&body.status!==undefined){
      if(!['pending','approved','rejected'].includes(body.status))throw fail(400,'Invalid time approval');
      fields.status=body.status;
    }
  }else if(resource==='leave'){
    if(!can(db,user,'leave','approve'))throw fail(403,'Only HR or an authorized manager can review leave');
    if(body.status!==undefined){
      if(!STATUSES.leave.includes(body.status))throw fail(400,'Invalid leave status');
      fields.status=body.status;
      fields.reviewed_by=user.id;
    }
    delete fields.start_date;delete fields.end_date;delete fields.leave_type;delete fields.note;
  }else if(resource==='expenses'){
    if(body.status!==undefined){
      protect(null,user,'expenses','approve');
      if(!STATUSES.expenses.includes(body.status))throw fail(400,'Invalid expense status');
      fields.status=body.status;
    }
  }else if(resource==='invoices'){
    if(row.status==='paid'||row.status==='void')throw fail(409,'Closed invoice cannot be edited');
    if(row.paid_cents>0&&fields.amount_cents!==undefined&&fields.amount_cents<row.paid_cents)throw fail(400,'Cannot lower total below recorded payments');
    if(body.status==='paid')throw fail(400,'Record actual payments instead of marking paid');
  }
  if(!Object.keys(fields).length)throw fail(400,'No valid changes');
  const keys=Object.keys(fields);
  db.prepare('UPDATE '+getTable(resource)+' SET '+keys.map(x=>x+'=?').join(',')+' WHERE id=?')
    .run(...Object.values(fields),id);
  audit(db,user,'edit',resource,id);
  return readRecord(resource,id,user);
}
function csvEscape(value){
  const input=String(value??'');
  const neutralized=/^[\s]*[=+\-@]/.test(input)?"'"+input:input;
  return '"'+neutralized.replaceAll('"','""')+'"';
}
function serveStatic(res,path){
  const allowed=new Set(['/','/index.html','/styles.css','/script.js','/favicon.svg','/robots.txt','/sitemap.xml','/404.html','/moving-guide.html','/staff','/staff/','/staff/app.js','/staff/style.css','/staff/login.html']);
  const serviceOK=/^\/services\/[a-z-]+\.html$/.test(path);
  if(!allowed.has(path)&&!serviceOK) return false;
  let file;
  if(path==='/staff'||path==='/staff/'||path==='/staff/login.html')file=join(ROOT,'app/ui/index.html');
  else if(path==='/staff/app.js')file=join(ROOT,'app/ui/app.js');
  else if(path==='/staff/style.css')file=join(ROOT,'app/ui/style.css');
  else file=join(ROOT,path==='/'?'index.html':path.slice(1));
  if(!existsSync(file)||!statSync(file).isFile())return false;
  const ext=extname(file);
  res.writeHead(200,{'content-type':mime[ext]||'application/octet-stream',
    'cache-control':ext==='.html'?'no-cache':'public, max-age=300',
    'content-security-policy':path.startsWith('/staff')?"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'":"default-src 'self' https: data:; script-src 'self' https: 'unsafe-inline'; style-src 'self' https: 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; frame-src https://portal.smartmoving.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
  res.end(readFileSync(file));return true;
}
function requireStaffEdit(user,body,existing){
  protect(null,user,'staff',existing?'edit':'create');
  const role=body.role||existing?.role||'crew';
  if(!ROLES.includes(role))throw fail(400,'Invalid role');
  if(user.role==='hr'&&role!=='crew')throw fail(403,'HR may provision crew only');
  if(user.role==='admin'&&(role==='owner'||role==='admin'||existing?.role==='owner'||existing?.role==='admin'))
    throw fail(403,'Only owner can manage administrator roles');
  if(user.role!=='owner'&&user.role!=='admin'&&user.role!=='hr')throw fail(403,'Restricted account management');
  if(existing?.role==='owner'&&role!=='owner'){
    const others=db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role='owner' AND active=1 AND id!=?").get(existing.id).n;
    if(!others)throw fail(409,'Cannot remove the last owner');
  }
  if(existing?.id===user.id&&body.active===false)throw fail(400,'Cannot disable yourself');
  return role;
}
export async function handle(req,res){
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('referrer-policy','strict-origin-when-cross-origin');
  res.setHeader('x-frame-options','DENY');
  res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');
  if(IS_PROD)res.setHeader('strict-transport-security','max-age=31536000');
  const url=new URL(req.url||'/', 'http://localhost');
  const path=decodeURIComponent(url.pathname);
  if(req.method==='GET'&&serveStatic(res,path))return;
  if(!path.startsWith('/api/')){res.writeHead(404);res.end('Not found');return;}
  try{
    const user=sessionUser(req),method=req.method;
    if(path==='/api/health'&&method==='GET')return json(res,200,{ok:true});
    if(path==='/api/login'&&method==='POST'){
      const body=await readJson(req);
      const email=check(body.email,'email',{required:true,max:255,kind:'email'}).toLowerCase();
      const password=String(body.password||'');
      if(password.length>256)throw fail(400,'Invalid password');
      const key=getClientKey(req,'login:'+email);
      limitLogin(key);
      const account=db.prepare('SELECT * FROM staff WHERE email=?').get(email);
      // Verify even when absent to avoid cheap user enumeration.
      const fake='scrypt$000000000000000000000000000000000000000000000000$'+'0'.repeat(128);
      const valid=verifyPassword(password,account?.password_hash||fake);
      if(!account||!account.active||!valid)throw fail(401,'Invalid credentials');
      clearAttempts(key);
      const csrfToken=issueSession(res,account);
      audit(db,account,'login','staff',account.id);
      return json(res,200,{user:{id:account.id,email:account.email,name:account.name,role:account.role,change_password:!!account.change_password},csrf:csrfToken,permissions:permissionMap(db,account)});
    }
    if(path==='/api/inquiry'&&method==='POST'){
      const body=await readJson(req);
      if(body.website) return json(res,200,{ok:true}); // honeypot
      limitLogin(getClientKey(req,'inquiry'),5,60*60*1000);
      const fields=sanitize('leads',body);
      const id=uid();
      const values={id,...fields,status:'new',source:'website',created_at:now()};
      const cols=Object.keys(values);
      db.prepare('INSERT INTO leads ('+cols.join(',')+') VALUES ('+cols.map(()=>'?').join(',')+')')
        .run(...Object.values(values));
      audit(db,null,'create','leads',id,'public inquiry');
      return json(res,201,{ok:true,message:'Your request was received. The team will follow up.'});
    }
    protect(req,user,'password');
    if(method!=='GET')csrf(req,user);
    if(path==='/api/session'&&method==='GET'){
      return json(res,200,{user:{id:user.id,email:user.email,name:user.name,role:user.role,change_password:!!user.change_password},csrf:user.csrf,permissions:permissionMap(db,user),roles:ROLES});
    }
    if(path==='/api/logout'&&method==='POST'){clearSession(res,user);return json(res,200,{ok:true});}
    if(path==='/api/password'&&method==='POST'){
      const body=await readJson(req);
      if(!verifyPassword(String(body.current||''),db.prepare('SELECT password_hash FROM staff WHERE id=?').get(user.id).password_hash))throw fail(403,'Current password incorrect');
      const next=check(body.next,'new password',{required:true,max:256});
      if(next.length<12)throw fail(400,'Use at least 12 characters');
      db.prepare('UPDATE staff SET password_hash=?,change_password=0 WHERE id=?').run(hashPassword(next),user.id);
      db.prepare('DELETE FROM sessions WHERE staff_id=? AND token_hash!=?').run(user.id,user.token_hash);
      audit(db,user,'password_changed','staff',user.id);
      return json(res,200,{ok:true});
    }
    if(user.change_password)throw fail(403,'Change temporary password to continue');
    if(path==='/api/overview'&&method==='GET'){
      protect(req,user,'overview');
      const crew=user.role==='crew';
      const results={
        leads:crew?null:db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status NOT IN ('lost','won')").get().n,
        upcoming:crew?db.prepare("SELECT COUNT(*) AS n FROM jobs j JOIN assignments a ON a.job_id=j.id WHERE a.staff_id=? AND j.status='scheduled'").get(user.id).n:
          db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='scheduled'").get().n,
        active:crew?db.prepare("SELECT COUNT(*) AS n FROM jobs j JOIN assignments a ON a.job_id=j.id WHERE a.staff_id=? AND j.status='in_progress'").get(user.id).n:
          db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='in_progress'").get().n,
        pendingLeave:can(db,user,'leave','approve')?db.prepare("SELECT COUNT(*) AS n FROM leave_requests WHERE status='pending'").get().n:null,
        receivableCents:can(db,user,'invoices','view')?db.prepare("SELECT COALESCE(SUM(amount_cents-paid_cents),0) AS n FROM invoices WHERE status NOT IN ('void','draft')").get().n:null
      };
      return json(res,200,results);
    }
    if(path==='/api/staff'&&method==='GET'){
      protect(req,user,'staff');return json(res,200,db.prepare('SELECT id,email,name,role,active,change_password,created_at FROM staff ORDER BY created_at DESC').all());
    }
    if(path==='/api/staff'&&method==='POST'){
      const body=await readJson(req);const role=requireStaffEdit(user,body);
      const name=check(body.name,'name',{required:true,max:120}),email=check(body.email,'email',{required:true,max:255,kind:'email'}).toLowerCase();
      const password=check(body.password,'temporary password',{required:true,max:256});
      if(password.length<12)throw fail(400,'Temporary password needs 12+ characters');
      const id=uid();
      db.prepare('INSERT INTO staff(id,email,name,role,password_hash,active,change_password,created_at) VALUES (?,?,?,?,?,1,1,?)')
        .run(id,email,name,role,hashPassword(password),now());
      audit(db,user,'invite','staff',id,role);
      return json(res,201,{id,name,email,role,active:1,change_password:1});
    }
    const staffMatch=path.match(/^\/api\/staff\/([0-9a-f-]{36})$/);
    if(staffMatch&&method==='PATCH'){
      const id=staffMatch[1],existing=db.prepare('SELECT * FROM staff WHERE id=?').get(id);
      if(!existing)throw fail(404,'Employee not found');
      const body=await readJson(req),role=requireStaffEdit(user,body,existing);
      const name='name' in body?check(body.name,'name',{required:true,max:120}):existing.name;
      const active='active' in body?(body.active===true?1:0):existing.active;
      if(body.active!==undefined&&typeof body.active!=='boolean')throw fail(400,'Invalid active flag');
      if(existing.role==='owner'&&active===0){
        const count=db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role='owner' AND active=1 AND id!=?").get(id).n;
        if(!count)throw fail(409,'Cannot disable last owner');
      }
      db.prepare('UPDATE staff SET name=?,role=?,active=? WHERE id=?').run(name,role,active,id);
      if(body.reset_password!==undefined){
        const pw=check(body.reset_password,'new temporary password',{required:true,max:256});
        if(pw.length<12)throw fail(400,'Temporary password needs 12+ characters');
        db.prepare('UPDATE staff SET password_hash=?,change_password=1 WHERE id=?').run(hashPassword(pw),id);
      }
      db.prepare('DELETE FROM sessions WHERE staff_id=?').run(id);
      audit(db,user,'update','staff',id,role);
      return json(res,200,{id,name,email:existing.email,role,active});
    }
    if(path==='/api/permissions'&&method==='GET'){
      protect(req,user,'permissions');return json(res,200,{roles:ROLES,resources:RESOURCES,actions:ACTIONS,rows:db.prepare('SELECT * FROM permissions ORDER BY role,resource,action').all()});
    }
    if(path==='/api/permissions'&&method==='PUT'){
      protect(req,user,'permissions','manage');
      if(user.role!=='owner')throw fail(403,'Only the owner may set role permissions');
      const body=await readJson(req);
      if(!ROLES.includes(body.role)||body.role==='owner'||!RESOURCES.includes(body.resource)||!ACTIONS.includes(body.action)||typeof body.allowed!=='boolean')throw fail(400,'Invalid rule');
      // Prevent role matrix from allowing nonowner to alter permission matrix.
      if(body.resource==='permissions'&&body.allowed)throw fail(403,'Permission administration is owner-only');
      db.prepare('UPDATE permissions SET allowed=? WHERE role=? AND resource=? AND action=?')
        .run(body.allowed?1:0,body.role,body.resource,body.action);
      audit(db,user,'permission_changed','permissions',body.role,body.resource+':'+body.action);
      return json(res,200,{ok:true});
    }
    if(path==='/api/audit'&&method==='GET'){
      protect(req,user,'audit');return json(res,200,db.prepare(
        "SELECT a.*,coalesce(s.name,'System/public') AS actor FROM audit_log a LEFT JOIN staff s ON a.actor_id=s.id ORDER BY a.created_at DESC LIMIT 300").all());
    }
    const records=path.match(/^\/api\/records\/([a-z]+)(?:\/([0-9a-f-]{36}))?$/);
    if(records){
      const resource=records[1],id=records[2];
      if(!SCHEMA[resource])throw fail(404,'Unknown module');
      const action=method==='GET'?'view':method==='POST'?'create':method==='PATCH'?'edit':'none';
      if(action==='none')throw fail(405,'Method not allowed');
      protect(req,user,resource,action);
      if(method==='GET')return json(res,200,id?readRecord(resource,id,user):listRecords(resource,user));
      const body=await readJson(req);
      if(method==='POST'&&!id)return json(res,201,createRecord(resource,body,user));
      if(method==='PATCH'&&id)return json(res,200,patchRecord(resource,id,body,user));
      throw fail(405,'Invalid operation');
    }
    const assign=path.match(/^\/api\/jobs\/([0-9a-f-]{36})\/assign$/);
    if(assign&&method==='POST'){
      protect(req,user,'jobs','assign');
      const jobId=assign[1];if(!exists('jobs',jobId))throw fail(404,'Job not found');
      const body=await readJson(req);
      if(!Array.isArray(body.staff_ids)||body.staff_ids.length>30)throw fail(400,'Invalid crew list');
      const ids=[...new Set(body.staff_ids)];
      for(const id of ids){
        const staff=db.prepare("SELECT role,active FROM staff WHERE id=?").get(id);
        if(!staff||!staff.active)throw fail(400,'Unknown or inactive assignee');
      }
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare('DELETE FROM assignments WHERE job_id=?').run(jobId);
        const insert=db.prepare('INSERT INTO assignments(job_id,staff_id) VALUES (?,?)');
        for(const id of ids)insert.run(jobId,id);
        audit(db,user,'assign','jobs',jobId,String(ids.length)+' employees');
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      return json(res,200,{ok:true,staff_ids:ids});
    }
    const getAssign=path.match(/^\/api\/jobs\/([0-9a-f-]{36})\/assignments$/);
    if(getAssign&&method==='GET'){
      protect(req,user,'jobs');
      readRecord('jobs',getAssign[1],user);
      return json(res,200,db.prepare('SELECT staff_id FROM assignments WHERE job_id=?').all(getAssign[1]).map(r=>r.staff_id));
    }
    if(path==='/api/time/start'&&method==='POST'){
      protect(req,user,'time','create');
      const body=await readJson(req);const jobId=body.job_id||null;
      if(jobId){
        readRecord('jobs',jobId,user);
      }
      if(db.prepare('SELECT 1 FROM time_entries WHERE staff_id=? AND ended_at IS NULL').get(user.id))throw fail(409,'Clock out first');
      const id=uid(),stamp=now();
      db.prepare('INSERT INTO time_entries(id,staff_id,job_id,started_at,status,created_at) VALUES (?,?,?,?,?,?)')
        .run(id,user.id,jobId,stamp,'pending',stamp);
      audit(db,user,'clock_in','time',id);
      return json(res,201,{id,started_at:stamp});
    }
    const clockOut=path.match(/^\/api\/time\/([0-9a-f-]{36})\/stop$/);
    if(clockOut&&method==='POST'){
      protect(req,user,'time','edit');
      const row=readRecord('time',clockOut[1],user);
      if(row.staff_id!==user.id)throw fail(403,'Only the employee can stop their clock');
      if(row.ended_at)throw fail(409,'Already clocked out');
      db.prepare('UPDATE time_entries SET ended_at=? WHERE id=?').run(now(),row.id);
      audit(db,user,'clock_out','time',row.id);
      return json(res,200,{ok:true});
    }
    const payment=path.match(/^\/api\/invoices\/([0-9a-f-]{36})\/payments$/);
    if(payment){
      protect(req,user,'invoices',method==='GET'?'view':'edit');
      const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(payment[1]);
      if(!invoice)throw fail(404,'Invoice not found');
      if(method==='GET')return json(res,200,db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY created_at DESC').all(invoice.id));
      if(method==='POST'){
        if(invoice.status==='void')throw fail(409,'Voided invoice');
        const body=await readJson(req),amount=safeMoney(body.amount_cents);
        if(!amount||amount+invoice.paid_cents>invoice.amount_cents)throw fail(400,'Payment exceeds outstanding balance');
        const methodName=check(body.method,'method',{required:true,max:50});
        const date=check(body.received_on,'received date',{required:true,kind:'date'});
        const reference=check(body.reference,'reference',{max:100});
        db.exec('BEGIN IMMEDIATE');
        try{
          db.prepare('INSERT INTO payments(id,invoice_id,amount_cents,method,reference,received_on,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
            .run(uid(),invoice.id,amount,methodName,reference,date,user.id,now());
          const paid=invoice.paid_cents+amount;
          db.prepare('UPDATE invoices SET paid_cents=?,status=? WHERE id=?').run(paid,paid===invoice.amount_cents?'paid':'sent',invoice.id);
          audit(db,user,'payment_recorded','invoices',invoice.id,String(amount)+' cents');
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        return json(res,201,{ok:true,paid_cents:invoice.paid_cents+amount});
      }
      throw fail(405,'Method not allowed');
    }
    if(path==='/api/reports/export'&&method==='GET'){
      protect(req,user,'reports','export');
      const table=url.searchParams.get('table');
      if(!['leads','customers','jobs','expenses','invoices','time_entries','leave_requests'].includes(table))throw fail(400,'Invalid export');
      const resource=table==='time_entries'?'time':table==='leave_requests'?'leave':table;
      protect(req,user,resource,'view');
      const records=listRecords(resource,user);
      const cols=records.length?Object.keys(records[0]):db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name);
      const contents=[cols.map(csvEscape).join(','),...records.map(row=>cols.map(c=>csvEscape(row[c])).join(','))].join('\r\n');
      audit(db,user,'export',resource,table,String(records.length)+' rows');
      res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="'+table+'.csv"','cache-control':'no-store'});
      return res.end(contents);
    }
    throw fail(404,'Route not found');
  }catch(err){
    if(err.code==='SQLITE_CONSTRAINT_UNIQUE'||err.code==='SQLITE_CONSTRAINT_PRIMARYKEY')return json(res,409,{error:'Duplicate record or email'});
    if(err.code?.startsWith('SQLITE_CONSTRAINT'))return json(res,400,{error:'Database rejected this record: check linked IDs and amounts'});
    const code=err.status||500;
    if(code===500)console.error('Request failed:',err);
    if(!res.headersSent)json(res,code,{error:code===500?'Internal server error':err.message});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=http.createServer(handle);
  server.listen(PORT,HOST,()=>console.log('Rescue 1: http://'+HOST+':'+PORT+'  (DB: '+DATA_DIR+')'));
}
