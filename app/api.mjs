import crypto from 'node:crypto';
import {ROLES,RESOURCES,ACTIONS,STATUSES,can,permissionMap,audit} from './db.mjs';
import {id,now,cleanText,cents,error,hashPassword,publicUser} from './auth.mjs';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^\d{2}:\d{2}$/;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const F={
  customers:{table:'customers',required:['name'],fields:{name:180,phone:50,email:180,notes:3000}},
  leads:{table:'leads',required:['customer_name','phone','origin'],fields:{customer_name:180,phone:50,email:180,origin:240,destination:240,service:80,requested_date:20,status:30,source:80,notes:3000},status:'leads'},
  quotes:{table:'quotes',required:['customer_name','amount_cents'],fields:{lead_id:40,customer_name:180,amount_cents:'cents',description:3000,valid_until:20,status:30},status:'quotes'},
  jobs:{table:'jobs',required:['customer_name','origin','move_date'],fields:{lead_id:40,customer_name:180,phone:50,origin:240,destination:240,move_date:20,start_time:15,service:80,status:30,crew_notes:3000},status:'jobs'},
  time:{table:'time_entries',required:['started_at'],fields:{job_id:40,started_at:45,ended_at:45,note:1000,status:30}},
  leave:{table:'leave_requests',required:['start_date','end_date'],fields:{start_date:20,end_date:20,leave_type:50,note:1000,status:30},status:'leave'},
  expenses:{table:'expenses',required:['vendor','category','amount_cents','incurred_on'],fields:{job_id:40,vendor:180,category:80,amount_cents:'cents',incurred_on:20,memo:1500,status:30},status:'expenses'},
  invoices:{table:'invoices',required:['customer_name','invoice_number','amount_cents'],fields:{job_id:40,customer_name:180,invoice_number:60,amount_cents:'cents',due_date:20,memo:1500,status:30},status:'invoices'},
  announcements:{table:'announcements',required:['title','body'],fields:{title:180,body:5000,priority:30}},
  chat:{table:'chat_messages',required:['message'],fields:{channel:60,message:2500}}
};
const guard=(db,user,resource,action='view')=>{if(!can(db,user,resource,action))throw error(403,'Permission denied');};
const validDate=(s,label)=>{if(s&&(!DATE.test(s)||Number.isNaN(Date.parse(s+'T12:00:00Z'))))throw error(400,label+' must be YYYY-MM-DD');};
const isSelf=(user,row)=>row.staff_id===user.id;
const isElevated=(db,user,resource,action)=>can(db,user,resource,action);
const queryParams=(u)=>new URL(u,'http://local').searchParams;
const LIMIT=100;

function listRows(db,user,resource,params) {
  const spec=F[resource];
  guard(db,user,resource);
  let where='',values=[];
  if(resource==='jobs'&&!can(db,user,'jobs','edit')) {
    // Crew visibility is limited to jobs they are actually assigned.
    where=' WHERE id IN (SELECT job_id FROM assignments WHERE staff_id=?)';values.push(user.id);
  }
  if(resource==='time'&&!can(db,user,'time','approve')&&!can(db,user,'payroll','view')) {
    where=' WHERE staff_id=?'; values.push(user.id);
  }
  if(resource==='leave'&&!can(db,user,'leave','approve')) {
    where=' WHERE staff_id=?';values.push(user.id);
  }
  if(resource==='chat') {
    where=' WHERE channel=?'; values.push(cleanText(params.get('channel')||'general','Channel',60,true));
  }
  const count=Math.min(LIMIT,Math.max(1,parseInt(params.get('limit')||'50',10)||50));
  const rows=db.prepare('SELECT * FROM '+spec.table+where+' ORDER BY created_at DESC LIMIT ?').all(...values,count);
  if(resource==='chat'||resource==='announcements') {
    for(const row of rows) {
      const author=db.prepare('SELECT name FROM staff WHERE id=?').get(row.author_id);
      row.author_name=author?.name||'Former employee';
    }
  }
  if(resource==='jobs') {
    for(const row of rows) row.assigned_staff=db.prepare('SELECT st.id,st.name,st.role FROM assignments a JOIN staff st ON st.id=a.staff_id WHERE a.job_id=?').all(row.id);
  }
  return rows;
}
function validateFields(spec,body,isCreate) {
  const fields={};
  for(const [key,limit] of Object.entries(spec.fields)) {
    if(!Object.hasOwn(body,key))continue;
    fields[key]=limit==='cents'?cents(body[key],key):cleanText(body[key],key,limit);
  }
  if(isCreate) for(const required of spec.required) {
    if(!Object.hasOwn(fields,required)||(typeof fields[required]==='string'&&!fields[required]))throw error(400,'Missing '+required);
  }
  if(spec.status&&Object.hasOwn(fields,'status')&&!STATUSES[spec.status].includes(fields.status))throw error(400,'Invalid status');
  if(Object.hasOwn(fields,'email')&&fields.email&&!emailPattern.test(fields.email))throw error(400,'Invalid email');
  if(Object.hasOwn(fields,'priority')&&!['normal','urgent'].includes(fields.priority))throw error(400,'Invalid priority');
  for(const key of ['move_date','requested_date','due_date','incurred_on','valid_until','start_date','end_date'])
    if(Object.hasOwn(fields,key))validDate(fields[key],key);
  if(fields.start_time&&!TIME.test(fields.start_time))throw error(400,'Start time must be HH:MM');
  if(fields.start_date&&fields.end_date&&fields.end_date<fields.start_date)throw error(400,'End date precedes start');
  for(const key of ['started_at','ended_at'])
    if(fields[key]&&!Number.isFinite(Date.parse(fields[key])))throw error(400,'Invalid '+key);
  if(fields.started_at&&fields.ended_at&&Date.parse(fields.ended_at)<Date.parse(fields.started_at))throw error(400,'End time precedes start time');
  return fields;
}
function ensureReference(db,table,value,field) {
  if(!value)return;
  if(!db.prepare('SELECT 1 AS yes FROM '+table+' WHERE id=?').get(value))throw error(400,field+' does not exist');
}
function handleRecord(db,user,resource,recordId,method,body) {
  const spec=F[resource];
  const row=db.prepare('SELECT * FROM '+spec.table+' WHERE id=?').get(recordId);
  if(!row)throw error(404,'Record not found');
  if(method==='GET') {
    guard(db,user,resource);
    if(!canSee(db,user,resource,row))throw error(404,'Record not found');
    if(resource==='jobs')row.assigned_staff=db.prepare('SELECT st.id,st.name,st.role FROM assignments a JOIN staff st ON st.id=a.staff_id WHERE a.job_id=?').all(recordId);
    return row;
  }
  const action=method==='DELETE'?'delete':'edit';
  guard(db,user,resource,action);
  if(!canSee(db,user,resource,row))throw error(404,'Record not found');
  if(method==='DELETE') {
    // Finance and job records have audit/financial meaning: don't silently delete linked data.
    if(['jobs','invoices','quotes','expenses','time','leave'].includes(resource))throw error(405,'Use a status change instead of deleting this business record');
    db.prepare('DELETE FROM '+spec.table+' WHERE id=?').run(recordId);
    audit(db,user,'delete',resource,recordId);
    return {deleted:true};
  }
  if(method!=='PATCH')throw error(405,'Method not allowed');
  const fields=validateFields(spec,body,false);
  if(resource==='chat'||resource==='announcements'&&user.id!==row.author_id&&user.role!=='owner'&&user.role!=='admin') {
    if(resource==='chat')throw error(405,'Chat messages cannot be edited after posting');
    throw error(403,'Only the author or administrator may edit this announcement');
  }
  if(resource==='time') {
    if(!can(db,user,'time','approve')) {
      if(!isSelf(user,row)||row.status!=='pending')throw error(403,'Cannot change this time entry');
      delete fields.status;
      delete fields.started_at;delete fields.job_id;
    }
    if(fields.ended_at) {
      const start=fields.started_at||row.started_at;
      if(Date.parse(fields.ended_at)<Date.parse(start))throw error(400,'End precedes start');
    }
    if(fields.status&&!['pending','approved','rejected'].includes(fields.status))throw error(400,'Invalid time status');
  }
  if(resource==='leave') {
    if(!can(db,user,'leave','approve')) {
      if(!isSelf(user,row)||row.status!=='pending')throw error(403,'Cannot edit leave request');
      delete fields.status;
    }
    if(fields.start_date||fields.end_date) {
      if((fields.end_date||row.end_date)<(fields.start_date||row.start_date))throw error(400,'End date precedes start');
    }
  }
  if(resource==='invoices'&&fields.status==='paid')throw error(400,'Record actual payments rather than setting Paid directly');
  if(resource==='invoices'&&fields.amount_cents!==undefined&&fields.amount_cents<row.paid_cents)throw error(400,'Amount cannot be less than payments recorded');
  if(resource==='invoices'&&row.status==='paid'&&fields.status&&!['paid','void'].includes(fields.status))throw error(400,'A paid invoice cannot become outstanding');
  if(fields.lead_id)ensureReference(db,'leads',fields.lead_id,'Lead');
  if(fields.job_id)ensureReference(db,'jobs',fields.job_id,'Job');
  if(!Object.keys(fields).length)throw error(400,'No editable fields');
  const columns=Object.keys(fields);
  db.prepare('UPDATE '+spec.table+' SET '+columns.map(key=>key+'=?').join(',')+' WHERE id=?')
    .run(...columns.map(key=>fields[key]),recordId);
  audit(db,user,'edit',resource,recordId);
  return db.prepare('SELECT * FROM '+spec.table+' WHERE id=?').get(recordId);
}
function canSee(db,user,resource,row){
  if(resource==='jobs'&&!can(db,user,'jobs','edit'))
    return !!db.prepare('SELECT 1 AS ok FROM assignments WHERE job_id=? AND staff_id=?').get(row.id,user.id);
  if(resource==='time'&&!can(db,user,'time','approve')&&!can(db,user,'payroll','view'))return isSelf(user,row);
  if(resource==='leave'&&!can(db,user,'leave','approve'))return isSelf(user,row);
  return true;
}
function createRecord(db,user,resource,body){
  guard(db,user,resource,'create');
  const spec=F[resource];
  const fields=validateFields(spec,body,true);
  const timestamp=now(),recordId=id();
  if(fields.lead_id)ensureReference(db,'leads',fields.lead_id,'Lead');
  if(fields.job_id)ensureReference(db,'jobs',fields.job_id,'Job');
  // Ownership and workflow state are controlled by the server; not submitted by a browser.
  if(resource==='time'){
    fields.staff_id=user.id;fields.status='pending';
    if(!fields.started_at)throw error(400,'Start time required');
  }
  if(resource==='leave'){fields.staff_id=user.id;fields.status='pending';}
  if(resource==='expenses'){fields.submitted_by=user.id;fields.status='pending';}
  if(resource==='announcements')fields.author_id=user.id;
  if(resource==='chat'){fields.author_id=user.id;fields.channel=fields.channel||'general';}
  if(resource==='quotes')fields.status='draft';
  if(resource==='invoices'){fields.status='draft';fields.paid_cents=0;}
  if(resource==='jobs'){fields.status='scheduled';}
  const values={id:recordId,...fields,created_at:timestamp};
  const keys=Object.keys(values);
  db.prepare('INSERT INTO '+spec.table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')')
    .run(...keys.map(k=>values[k]));
  audit(db,user,'create',resource,recordId);
  return db.prepare('SELECT * FROM '+spec.table+' WHERE id=?').get(recordId);
}
function overview(db,user){
  guard(db,user,'overview');
  const count=(query,...args)=>db.prepare(query).get(...args)?.n||0;
  const assigned=can(db,user,'jobs','edit')?'': ' WHERE id IN (SELECT job_id FROM assignments WHERE staff_id=?)';
  const arg=assigned?[user.id]:[];
  const result={
    assignedJobs:count('SELECT count(*) n FROM jobs'+assigned,...arg),
    upcomingJobs:count("SELECT count(*) n FROM jobs WHERE move_date>=date('now') AND status='scheduled'"+(assigned?' AND id IN (SELECT job_id FROM assignments WHERE staff_id=?)':''),...arg),
    announcements:count('SELECT count(*) n FROM announcements')
  };
  if(can(db,user,'leads','view'))result.openLeads=count("SELECT count(*) n FROM leads WHERE status IN ('new','contacted','quoted')");
  if(can(db,user,'quotes','view'))result.pendingQuotes=count("SELECT count(*) n FROM quotes WHERE status IN ('draft','sent')");
  if(can(db,user,'time','view'))result.myPendingTime=count("SELECT count(*) n FROM time_entries WHERE staff_id=? AND status='pending'",user.id);
  if(can(db,user,'invoices','view'))result.openInvoices=count("SELECT count(*) n FROM invoices WHERE status IN ('draft','sent')");
  if(can(db,user,'leave','approve'))result.pendingLeave=count("SELECT count(*) n FROM leave_requests WHERE status='pending'");
  return result;
}
function staffList(db,user){
  guard(db,user,'staff');
  return db.prepare('SELECT id,email,name,role,active,change_password,created_at FROM staff ORDER BY name').all().map(row=>({...row,active:!!row.active}));
}
function staffCreate(db,user,body){
  guard(db,user,'staff','create');
  const name=cleanText(body.name,'Name',140,true);
  const email=cleanText(body.email,'Email',180,true).toLowerCase();
  const role=cleanText(body.role,'Role',25,true);
  if(!emailPattern.test(email)||!ROLES.includes(role))throw error(400,'Invalid email or role');
  if(role==='owner' || (user.role!=='owner'&&['owner','admin','finance','hr'].includes(role)) ||
    (user.role==='hr'&&role!=='crew'))throw error(403,'Cannot create an employee with that role');
  const password=crypto.randomBytes(20).toString('base64url');
  const rec={id:id(),name,email,role};
  db.prepare('INSERT INTO staff(id,email,name,role,password_hash,active,change_password,created_at) VALUES (?,?,?,?,?,1,1,?)')
    .run(rec.id,email,name,role,hashPassword(password),now());
  audit(db,user,'create','staff',rec.id,'Role: '+role);
  return {employee:rec,temporaryPassword:password,warning:'Save and securely deliver this one-time password. It is not emailed. Change required on first sign-in.'};
}
function staffPatch(db,user,staffId,body){
  guard(db,user,'staff','edit');
  const existing=db.prepare('SELECT id,email,name,role,active FROM staff WHERE id=?').get(staffId);
  if(!existing)throw error(404,'Employee not found');
  if(existing.role==='owner'&&user.role!=='owner')throw error(403,'Cannot edit the owner');
  if(existing.role==='owner'&&(body.role&&body.role!=='owner'||body.active===false)){
    const other=db.prepare("SELECT count(*) AS n FROM staff WHERE role='owner' AND active=1 AND id != ?").get(staffId).n;
    if(!other)throw error(409,'Cannot remove the last active owner');
  }
  const changes={};
  if(Object.hasOwn(body,'name'))changes.name=cleanText(body.name,'Name',140,true);
  if(Object.hasOwn(body,'email')){
    changes.email=cleanText(body.email,'Email',180,true).toLowerCase();
    if(!emailPattern.test(changes.email))throw error(400,'Invalid email');
  }
  if(Object.hasOwn(body,'role')){
    const role=cleanText(body.role,'Role',25,true);
    if(!ROLES.includes(role)||role==='owner'&&existing.role!=='owner')throw error(403,'Invalid role change');
    if(user.role!=='owner'&&(['owner','admin','finance','hr'].includes(role)||['owner','admin','finance','hr'].includes(existing.role)))throw error(403,'Owner approval required for elevated roles');
    if(user.role==='hr'&&role!=='crew')throw error(403,'HR can only manage crew roles');
    changes.role=role;
  }
  if(Object.hasOwn(body,'active')){
    if(typeof body.active!=='boolean')throw error(400,'Active must be a boolean');
    if(existing.role==='owner'&&!body.active||user.id===staffId&&!body.active)throw error(403,'Cannot deactivate this account');
    changes.active=body.active?1:0;
  }
  if(body.resetPassword){
    if(existing.role==='owner'&&user.id!==staffId)throw error(403,'Owner password cannot be reset here');
    const password=crypto.randomBytes(20).toString('base64url');
    changes.password_hash=hashPassword(password);changes.change_password=1;
    applyStaff(db,user,staffId,changes);
    return {employee:db.prepare('SELECT id,email,name,role,active FROM staff WHERE id=?').get(staffId),temporaryPassword:password};
  }
  if(!Object.keys(changes).length)throw error(400,'No valid changes');
  applyStaff(db,user,staffId,changes);
  return db.prepare('SELECT id,email,name,role,active,change_password FROM staff WHERE id=?').get(staffId);
}
function applyStaff(db,user,staffId,changes){
  const keys=Object.keys(changes);
  db.prepare('UPDATE staff SET '+keys.map(key=>key+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>changes[k]),staffId);
  db.prepare('DELETE FROM sessions WHERE staff_id=?').run(staffId);
  audit(db,user,'edit','staff',staffId,'Employee account/permissions modified');
}
function assignments(db,user,jobId,body){
  if(!can(db,user,'jobs','assign')&&!can(db,user,'dispatch','assign'))throw error(403,'Cannot assign crews');
  if(!db.prepare('SELECT 1 AS ok FROM jobs WHERE id=?').get(jobId))throw error(404,'Job not found');
  if(!Array.isArray(body.staffIds)||body.staffIds.length>50||!body.staffIds.every(x=>typeof x==='string'))throw error(400,'staffIds must be an array (up to 50)');
  const unique=[...new Set(body.staffIds)];
  for(const staffId of unique){
    const employee=db.prepare('SELECT active FROM staff WHERE id=?').get(staffId);
    if(!employee?.active)throw error(400,'Only active employees may be assigned');
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('DELETE FROM assignments WHERE job_id=?').run(jobId);
    const insert=db.prepare('INSERT INTO assignments(job_id,staff_id) VALUES (?,?)');
    for(const staffId of unique)insert.run(jobId,staffId);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  audit(db,user,'assign','dispatch',jobId,'Crew size: '+unique.length);
  return {jobId,staffIds:unique};
}
function recordPayment(db,user,invoiceId,body){
  guard(db,user,'invoices','edit');
  const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  if(!invoice)throw error(404,'Invoice not found');
  if(invoice.status==='void')throw error(409,'Cannot pay a void invoice');
  const amount=cents(body.amount_cents,'Payment');
  if(amount===0||amount>invoice.amount_cents-invoice.paid_cents)throw error(400,'Payment exceeds outstanding balance');
  const method=cleanText(body.method,'Method',60,true);
  const reference=cleanText(body.reference,'Reference',150);
  const received=cleanText(body.received_on||now().slice(0,10),'Received date',20);
  validDate(received,'Received date');
  const paymentId=id();
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('INSERT INTO payments(id,invoice_id,amount_cents,method,reference,received_on,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(paymentId,invoiceId,amount,method,reference,received,user.id,now());
    const paid=invoice.paid_cents+amount;
    db.prepare('UPDATE invoices SET paid_cents=?,status=? WHERE id=?')
      .run(paid,paid===invoice.amount_cents?'paid':'sent',invoiceId);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  audit(db,user,'payment','invoices',invoiceId,'Payment recorded: '+amount+' cents');
  return {paymentId,paid_cents:invoice.paid_cents+amount,remaining_cents:invoice.amount_cents-invoice.paid_cents-amount};
}
function payroll(db,user,params){
  guard(db,user,'payroll','view');
  const from=params.get('from')||new Date().toISOString().slice(0,7)+'-01';
  const to=params.get('to')||now().slice(0,10);
  validDate(from,'From');validDate(to,'To');
  if(to<from)throw error(400,'Invalid payroll range');
  const rows=db.prepare("SELECT t.staff_id,st.name,st.role,t.id,t.started_at,t.ended_at,r.cents_per_hour FROM time_entries t JOIN staff st ON st.id=t.staff_id LEFT JOIN pay_rates r ON r.staff_id=t.staff_id WHERE t.status='approved' AND substr(t.started_at,1,10)>=? AND substr(t.started_at,1,10)<=? ORDER BY st.name,t.started_at").all(from,to);
  const byStaff=new Map();
  for(const item of rows){
    if(!item.ended_at)continue;
    const hours=Math.max(0,Math.min(24,(Date.parse(item.ended_at)-Date.parse(item.started_at))/3600000));
    if(!Number.isFinite(hours))continue;
    const line=byStaff.get(item.staff_id)||{staffId:item.staff_id,name:item.name,role:item.role,hours:0,rateCents:item.cents_per_hour??null,estimatedGrossCents:null};
    line.hours+=hours;byStaff.set(item.staff_id,line);
  }
  const result=[...byStaff.values()].map(item=>({...item,hours:Math.round(item.hours*100)/100,estimatedGrossCents:item.rateCents===null?null:Math.round(item.hours*item.rateCents)}));
  audit(db,user,'view','payroll','','Range: '+from+'..'+to);
  return {from,to,disclaimer:'Estimated gross wages based on approved recorded hours and configured rates. Not payroll processing, tax withholding, overtime calculations, benefit accounting, or pay disbursement.',rows:result};
}
function rate(db,user,staffId,body){
  guard(db,user,'payroll','manage');
  if(!db.prepare('SELECT 1 AS ok FROM staff WHERE id=?').get(staffId))throw error(404,'Employee not found');
  const rate=cents(body.cents_per_hour,'Hourly rate');
  db.prepare('INSERT INTO pay_rates(staff_id,cents_per_hour,updated_at) VALUES (?,?,?) ON CONFLICT(staff_id) DO UPDATE SET cents_per_hour=excluded.cents_per_hour,updated_at=excluded.updated_at').run(staffId,rate,now());
  audit(db,user,'manage','payroll',staffId,'Hourly rate changed');
  return {staffId,rateCents:rate};
}
function reports(db,user){
  guard(db,user,'reports','view');
  const group=(table,key)=>db.prepare('SELECT '+key+' AS label,count(*) AS n FROM '+table+' GROUP BY '+key).all();
  const result={jobs:group('jobs','status'),leads:group('leads','status'),quotes:group('quotes','status')};
  if(can(db,user,'invoices','view')){
    const sums=db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS invoiced,COALESCE(SUM(paid_cents),0) AS paid FROM invoices WHERE status != ?').get('void');
    result.invoices=sums;
  }
  return result;
}
function permissions(db,user,method,body){
  guard(db,user,'permissions',method==='GET'?'view':'manage');
  if(method==='GET')return {roles:ROLES,resources:RESOURCES,actions:ACTIONS,permissions:db.prepare('SELECT role,resource,action,allowed FROM permissions ORDER BY role,resource,action').all()};
  if(method!=='PATCH')throw error(405,'Method not allowed');
  if(user.role!=='owner')throw error(403,'Only the owner changes the permission matrix');
  const role=cleanText(body.role,'Role',25,true);
  const resource=cleanText(body.resource,'Resource',25,true);
  const action=cleanText(body.action,'Action',25,true);
  if(role==='owner'||!ROLES.includes(role)||!RESOURCES.includes(resource)||!ACTIONS.includes(action)||typeof body.allowed!=='boolean')throw error(400,'Invalid permission');
  db.prepare('UPDATE permissions SET allowed=? WHERE role=? AND resource=? AND action=?').run(body.allowed?1:0,role,resource,action);
  audit(db,user,'manage','permissions',role,resource+':'+action+'='+body.allowed);
  return {role,resource,action,allowed:body.allowed};
}
export function routeAPI(db,session,method,pathname,params,body={}) {
  const user=session.user;
  if(pathname==='/api/me'&&method==='GET')return {user,permissions:permissionMap(db,user)};
  if(pathname==='/api/overview'&&method==='GET')return overview(db,user);
  if(pathname==='/api/reports'&&method==='GET')return reports(db,user);
  if(pathname==='/api/payroll'&&method==='GET')return payroll(db,user,params);
  if(pathname==='/api/staff'&&method==='GET')return staffList(db,user);
  if(pathname==='/api/staff'&&method==='POST')return staffCreate(db,user,body);
  if(pathname==='/api/permissions')return permissions(db,user,method,body);
  const segments=pathname.split('/').filter(Boolean);
  if(segments[0]!=='api')throw error(404,'Not found');
  if(segments[1]==='staff'&&segments.length===3&&method==='PATCH')return staffPatch(db,user,segments[2],body);
  if(segments[1]==='jobs'&&segments.length===4&&segments[3]==='assignments'&&method==='PUT')return assignments(db,user,segments[2],body);
  if(segments[1]==='invoices'&&segments.length===4&&segments[3]==='payments'&&method==='POST')return recordPayment(db,user,segments[2],body);
  if(segments[1]==='invoices'&&segments.length===4&&segments[3]==='payments'&&method==='GET'){
    guard(db,user,'invoices');
    return db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY received_on DESC').all(segments[2]);
  }
  if(segments[1]==='payroll'&&segments[2]==='rates'&&segments.length===4&&method==='PUT')return rate(db,user,segments[3],body);
  if(segments[1]==='audit'&&segments.length===2&&method==='GET'){
    guard(db,user,'audit'); return db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100').all();
  }
  const name=segments[1];
  if(!Object.hasOwn(F,name))throw error(404,'Unknown resource');
  if(segments.length===2){
    if(method==='GET')return listRows(db,user,name,params);
    if(method==='POST')return createRecord(db,user,name,body);
    throw error(405,'Method not allowed');
  }
  if(segments.length===3&&['GET','PATCH','DELETE'].includes(method))return handleRecord(db,user,name,segments[2],method,body);
  throw error(404,'Not found');
}
