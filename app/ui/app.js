/* Rescue 1 Command Center — secure, no-framework employee interface.
   Actual writes are performed by the server and subject to server-side RBAC. */
(() => {
 'use strict';
 const $=(s,r=document)=>r.querySelector(s);
 const $$=(s,r=document)=>[...r.querySelectorAll(s)];
 const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const money=n=>'$'+((Number(n)||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const friendly=s=>String(s||'').replaceAll('_',' ').replace(/\b[a-z]/g,x=>x.toUpperCase());
 const date=s=>s?String(s).slice(0,10):'—';
 const $auth=$('#auth-screen'),$workspace=$('#workspace'),$screen=$('#screen'),$nav=$('#nav');
 let user=null,csrf='',grants={},module='overview',records=[],staff=[],toastTimer=null,refreshTimer=null;
 const MODULES=[
  ['overview','⌂','Admin home','THE BIG PICTURE','COMMAND OVERVIEW.','A clear view of the work that matters.'],
  ['leads','◎','Leads','FROM FIRST CALL','LEAD PIPELINE.','New customers and upcoming opportunities.'],
  ['quotes','▤','Quotes','PUT IT IN WRITING','QUOTES.','Prepare, issue, and track moving estimates.'],
  ['jobs','▣','Jobs','MOVES ON THE BOARD','JOBS.','Track moves from scheduled to complete.'],
  ['dispatch','⇥','Dispatch','CREW IN MOTION','DISPATCH.','Assign your people to scheduled moves.'],
  ['customers','♧','Customers','PEOPLE FIRST','CUSTOMERS.','Your customer directory.'],
  ['announcements','◈','Announcements','TEAM UPDATES','ANNOUNCEMENTS.','Make sure important news reaches the crew.'],
  ['chat','▱','Crew chat','STAY CONNECTED','CREW CHAT.','Messages for the whole crew.'],
  ['time','◷','Timekeeping','HOURS THAT COUNT','TIME CLOCK.','Time entries and approvals.'],
  ['leave','◇','Time off','WORK / LIFE','TIME OFF.','Request and approve leave.'],
  ['expenses','$','Expenses','TRACK THE COSTS','EXPENSES.','Record and review business expenses.'],
  ['invoices','▤','Invoices','GET THE BOOKS RIGHT','INVOICES.','Track billed amounts and payments received.'],
  ['payroll','$','Payroll review','HOURS / RATES','PAYROLL REVIEW.','Estimated gross pay from approved hours.'],
  ['staff','♙','Employees','YOUR MOST VALUABLE ASSET','THE CREW.','Manage employees and access roles.'],
  ['reports','▥','Reports','KNOW THE BUSINESS','REPORTS.','Operational and financial summaries.'],
  ['permissions','⚙','Role access','SECURITY / CONTROL','ACCESS MATRIX.','Set exactly what each role can do.'],
  ['audit','◷','Activity log','TRACE THE ACTION','AUDIT TRAIL.','Changes and actions recorded by the system.']
 ];
 const SPECS={
  customers:[['name','Customer name','text',true],['phone','Phone','tel'],['email','Email','email'],['notes','Notes','textarea']],
  leads:[['customer_name','Customer name','text',true],['phone','Phone','tel',true],['email','Email','email'],['origin','Moving from','text',true],['destination','Moving to','text'],['requested_date','Target date','date'],['service','Service','select',false,['residential','apartment','commercial','long-distance','packing/labor']],['source','Source','text'],['status','Status','select',false,['new','contacted','quoted','won','lost']],['notes','Notes','textarea']],
  quotes:[['customer_name','Customer name','text',true],['amount_cents','Quoted amount ($)','money',true],['lead_id','Linked lead ID (optional)','text'],['description','Quote description','textarea'],['valid_until','Valid until','date'],['status','Status','select',false,['draft','sent','accepted','declined']]],
  jobs:[['customer_name','Customer name','text',true],['phone','Phone','tel'],['origin','Pickup address','text',true],['destination','Drop-off address','text'],['move_date','Move date','date',true],['start_time','Start time','time'],['service','Move type','select',false,['residential','apartment','commercial','long-distance','packing/labor']],['status','Status','select',false,['scheduled','in_progress','completed','cancelled']],['crew_notes','Crew notes','textarea'],['lead_id','Lead ID (optional)','text']],
  announcements:[['title','Headline','text',true],['body','Message','textarea',true],['priority','Priority','select',false,['normal','urgent']]],
  time:[['started_at','Clock in','datetime-local',true],['ended_at','Clock out','datetime-local'],['job_id','Job ID (optional)','text'],['note','Note','textarea'],['status','Approval status','select',false,['pending','approved','rejected']]],
  leave:[['start_date','First day','date',true],['end_date','Last day','date',true],['leave_type','Leave type','select',false,['personal','vacation','sick','unpaid']],['note','Reason / notes','textarea'],['status','Decision','select',false,['pending','approved','denied']]],
  expenses:[['vendor','Vendor','text',true],['category','Category','select',true,['fuel','supplies','vehicle','lodging','equipment','other']],['amount_cents','Amount ($)','money',true],['incurred_on','Date','date',true],['job_id','Related job ID','text'],['memo','Details','textarea'],['status','Status','select',false,['pending','approved','rejected']]],
  invoices:[['customer_name','Customer','text',true],['invoice_number','Invoice number','text',true],['job_id','Related job ID','text'],['amount_cents','Total billed ($)','money',true],['due_date','Due date','date'],['status','Status','select',false,['draft','sent','paid','void']],['memo','Details','textarea']]
 };
 const COLS={
  leads:['customer_name','phone','service','origin','requested_date','status'],
  quotes:['customer_name','amount_cents','valid_until','status'],
  jobs:['customer_name','origin','destination','move_date','status'],
  customers:['name','phone','email'],
  announcements:['title','priority','created_at'],
  time:['started_at','ended_at','note','status'],
  leave:['start_date','end_date','leave_type','status'],
  expenses:['vendor','category','amount_cents','incurred_on','status'],
  invoices:['invoice_number','customer_name','amount_cents','paid_cents','status'],
  staff:['name','email','role','active']
 };
 const allowed=(r,a='view')=>Boolean(user&&(user.role==='owner'||grants[r]?.[a]));
 function toast(message,isError=false){
  const el=$('#toast');if(!el)return;
  el.textContent=message;el.classList.toggle('error',isError);el.classList.add('active');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('active'),5200);
 }
 async function api(path,{method='GET',data}={}){
  const headers={'Accept':'application/json'};
  if(method!=='GET'){headers['Content-Type']='application/json';if(csrf)headers['X-CSRF-Token']=csrf;}
  let response;
  try{response=await fetch(path,{method,headers,credentials:'same-origin',cache:'no-store',body:data===undefined?undefined:JSON.stringify(data)});}
  catch{throw new Error('Cannot reach the server. Check your connection.');}
  let result;
  try{result=await response.json();}catch{throw new Error('Server returned an unexpected response');}
  if(!response.ok){
   if(response.status===401&&user){user=null;loginView();}
   throw new Error(result.error||'Request failed');
  }
  return result;
 }
 async function refreshAuth(){
  try{const response=await api('/api/auth/session');user=response.user;csrf=response.csrf;grants=response.permissions||{};
   if(user.changePassword)passwordView();else workspaceView();
  }catch{loginView();}
 }
 function loginView(){
  clearInterval(refreshTimer);$auth.hidden=false;$workspace.hidden=true;
  $('#auth-heading').innerHTML='REPORTING<br>FOR DUTY<span class="accent">.</span>';
  $('#auth-description').textContent='Sign in with your company email and password.';
  $('#login-form').hidden=false;$('#password-form').hidden=true;
 }
 function passwordView(){
  clearInterval(refreshTimer);$auth.hidden=false;$workspace.hidden=true;
  $('#auth-heading').innerHTML='SECURE<br>YOUR ACCOUNT<span class="accent">.</span>';
  $('#auth-description').textContent='Your temporary password must be changed before using the portal.';
  $('#login-form').hidden=true;$('#password-form').hidden=false;
 }
 function workspaceView(){
  $auth.hidden=true;$workspace.hidden=false;
  $('#current-name').textContent=user.name;
  $('#current-role').textContent=friendly(user.role);
  $('#avatar').textContent=(user.name||'R').charAt(0).toUpperCase();
  $('#top-avatar').textContent=(user.name||'R').charAt(0).toUpperCase();
  renderNav();navigate('overview');
  clearInterval(refreshTimer);
  refreshTimer=setInterval(()=>{if(module==='chat'&&!$('#chat-input:focus'))renderModule('chat',true).catch(()=>{});},15000);
 }
 function renderNav(){
  const active=module;
  $nav.innerHTML=MODULES.filter(([key])=>allowed(key==='dispatch'?'jobs':key))
   .map(([key,icon,label])=>'<button class="nav-item '+(key===active?'active':'')+'" data-module="'+esc(key)+'"><span class="nav-symbol">'+esc(icon)+'</span>'+esc(label)+'</button>').join('');
  $$('[data-module]',$nav).forEach(item=>item.addEventListener('click',()=>navigate(item.dataset.module)));
 }
 async function navigate(next){
  if(!MODULES.some(x=>x[0]===next)||!allowed(next==='dispatch'?'jobs':next))next='overview';
  module=next;renderNav();
  $('#sidebar').classList.remove('open');
  $('#crumb-current').textContent=next.toUpperCase();
  const definition=MODULES.find(x=>x[0]===next);
  $('#module-kicker').textContent=definition[3];
  $('#module-heading').textContent=definition[4];
  $('#module-subtitle').textContent=definition[5];
  try{await renderModule(next);}catch(e){toast(e.message,true);$screen.innerHTML='<div class="notice">'+esc(e.message)+'</div>';}
 }
 const panel=(name,body)=>'<section class="data-panel"><div class="dash-panel-head"><h2>'+esc(name)+'</h2></div>'+body+'</section>';
 function cell(key,val){
  if(key==='amount_cents'||key==='paid_cents')return esc(money(val));
  if(key==='status'||key==='priority'||key==='role')return '<span class="status">'+esc(friendly(val))+'</span>';
  if(key==='active')return val?'ACTIVE':'INACTIVE';
  if(key.includes('date')||key==='created_at'||key==='started_at'||key==='ended_at')return esc(date(val));
  return esc(val==null||val===''?'—':val);
 }
 function table(rows,cols,kind,{rowActions=true}={}){
  if(!rows.length)return '<div class="empty-state"><strong>NOTHING ON THE BOARD YET.</strong><p>Use the available actions above to add your first record.</p></div>';
  const heads=cols.map(c=>'<th>'+esc(friendly(c))+'</th>').join('');
  return '<div class="table-scroll"><table class="data-table"><thead><tr>'+heads+(rowActions?'<th>ACTIONS</th>':'')+'</tr></thead><tbody>'+
   rows.map(row=>'<tr>'+cols.map(k=>'<td>'+cell(k,row[k])+'</td>').join('')+
    (rowActions?'<td><div class="table-actions">'+rowButtons(kind,row)+'</div></td>':'')+'</tr>').join('')+'</tbody></table></div>';
 }
 function rowButtons(kind,row){
  const buttons=[];
  if(allowed(kind,'edit')&&kind!=='chat')buttons.push('<button class="small-action" data-do="edit" data-id="'+esc(row.id)+'">EDIT</button>');
  if(kind==='jobs'&&allowed('jobs','assign'))buttons.push('<button class="small-action" data-do="assign" data-id="'+esc(row.id)+'">ASSIGN</button>');
  if(kind==='invoices'&&allowed('invoices','edit')&&row.status!=='void'&&row.paid_cents<row.amount_cents)buttons.push('<button class="small-action" data-do="payment" data-id="'+esc(row.id)+'">PAYMENT</button>');
  if(kind==='staff'&&allowed('staff','edit'))buttons.push('<button class="small-action" data-do="edit-staff" data-id="'+esc(row.id)+'">MANAGE</button>');
  return buttons.join('');
 }
 function bindTableActions(kind,rows){
  $$('[data-do]',$screen).forEach(button=>button.addEventListener('click',async()=>{
   const row=rows.find(x=>x.id===button.dataset.id);
   if(!row)return;
   try{
    if(button.dataset.do==='edit')return editRecord(kind,row);
    if(button.dataset.do==='edit-staff')return employeeForm(row);
    if(button.dataset.do==='payment')return paymentForm(row);
    if(button.dataset.do==='assign')return assignmentForm(row);
   }catch(e){toast(e.message,true);}
  }));
 }
 async function renderModule(key,background=false){
  if(!background)$screen.innerHTML='<div class="notice">LOADING LIVE DATA…</div>';
  if(key==='overview')return overview();
  if(key==='reports')return reports();
  if(key==='payroll')return payroll();
  if(key==='permissions')return permissions();
  if(key==='audit'){
   const list=await api('/api/audit');
   $screen.innerHTML=panel('RECENT ACTIVITY',table(list,['created_at','action','resource','record_id'],key,{rowActions:false}));
   return;
  }
  if(key==='staff'){
   staff=await api('/api/staff');
   const button=allowed('staff','create')?'<button class="primary" id="new-record">+ ADD EMPLOYEE</button>':'';
   $('#head-actions').innerHTML=button;
   $screen.innerHTML=panel('EMPLOYEE DIRECTORY',table(staff,COLS.staff,'staff'));
   $('#new-record')?.addEventListener('click',()=>employeeForm());
   bindTableActions('staff',staff);return;
  }
  if(key==='dispatch')return dispatch();
  if(key==='chat')return chat(background);
  const items=await api('/api/'+key);
  records=items;
  const button=allowed(key,'create')?'<button class="primary" id="new-record">+ NEW '+esc(friendly(key.slice(0,-1)))+'</button>':'';
  $('#head-actions').innerHTML=button;
  const cols=COLS[key]||Object.keys(items[0]||{}).slice(0,5);
  $screen.innerHTML='<div class="records-toolbar"><input class="search-box" type="search" id="record-search" placeholder="Search '+esc(key)+'..." aria-label="Search records"><span class="records-count">'+items.length+' RECORDS</span></div>'+panel(friendly(key)+' / LIVE RECORDS',table(items,cols,key));
  $('#new-record')?.addEventListener('click',()=>editRecord(key));
  const filter=$('#record-search');
  filter?.addEventListener('input',()=>{
   const term=filter.value.toLowerCase();
   const rows=items.filter(item=>cols.some(c=>String(item[c]??'').toLowerCase().includes(term)));
   const host=$('.table-scroll',$screen)||$('.empty-state',$screen);
   if(host)host.outerHTML=table(rows,cols,key);
   bindTableActions(key,rows);
  });
  bindTableActions(key,items);
 }
 async function overview(){
  const data=await api('/api/overview');
  $('#head-actions').innerHTML='<button class="secondary" id="overview-refresh">↻ REFRESH</button>';
  const stats=Object.entries(data).filter(([k,v])=>v!==null).map(([k,v])=>
   '<article class="stat-card"><span class="stat-label">'+esc(friendly(k))+'</span><strong class="stat-value">'+esc(v)+'</strong><span class="stat-caption">LIVE DATABASE / RESCUE 1</span></article>').join('');
  const quick=MODULES.filter(([k])=>k!=='overview'&&k!=='permissions'&&k!=='audit'&&allowed(k==='dispatch'?'jobs':k)).slice(0,8);
  $screen.innerHTML='<div class="dashboard-stats">'+stats+'</div><div class="dashboard-grid"><section class="dash-panel"><div class="dash-panel-head"><h2>GET TO WORK</h2></div><div class="quick-grid">'+quick.map(([k,icon,label])=>'<button class="quick-action" data-go="'+esc(k)+'"><span class="quick-icon">'+esc(icon)+'</span><strong>'+esc(label)+'</strong><span>OPEN MODULE ↗</span></button>').join('')+'</div></section><section class="dash-panel"><div class="dash-panel-head"><h2>YOUR ACCESS</h2></div><p class="notice">SIGNED IN AS <strong>'+esc(user.name)+'</strong><br>ROLE: '+esc(friendly(user.role))+'<br>Authorized sections are based on server-side permissions. Contact the owner for changes.</p></section></div>';
  $('#overview-refresh')?.addEventListener('click',()=>overview().catch(e=>toast(e.message,true)));
  $$('[data-go]',$screen).forEach(x=>x.addEventListener('click',()=>navigate(x.dataset.go)));
 }
 async function dispatch(){
  const [jobs,employees]=await Promise.all([api('/api/jobs'),api('/api/staff')]);
  staff=employees.filter(x=>x.active);
  $('#head-actions').innerHTML=allowed('jobs','create')?'<button class="primary" id="new-record">+ NEW JOB</button>':'';
  $screen.innerHTML=panel('SCHEDULED MOVES & CREW ASSIGNMENTS',table(jobs,['customer_name','move_date','origin','status'],'jobs'));
  $('#new-record')?.addEventListener('click',()=>editRecord('jobs'));
  bindTableActions('jobs',jobs);
 }
 async function chat(background){
  const rows=await api('/api/chat?channel=general&limit=80');
  $('#head-actions').innerHTML='<button class="secondary" id="refresh-chat">↻ REFRESH</button>';
  const ordered=[...rows].reverse();
  const messages=ordered.map(x=>'<div class="chat-message"><strong>'+esc(x.author_name||'Team member')+'</strong><small>'+esc((x.created_at||'').replace('T',' ').slice(0,16))+'</small><p>'+esc(x.message)+'</p></div>').join('');
  $screen.innerHTML=panel('CREW CHANNEL / GENERAL','<div class="chat-stream" id="chat-stream" aria-live="polite">'+(messages||'<p class="notice">Start the conversation.</p>')+'</div>'+(allowed('chat','create')?'<form class="chat-compose" id="chat-form"><label for="chat-input">MESSAGE THE TEAM</label><textarea name="message" id="chat-input" rows="3" maxlength="2500" required placeholder="Update the crew..."></textarea><button class="primary">SEND MESSAGE ↗</button></form>':''));
  $('#chat-stream').scrollTop=$('#chat-stream').scrollHeight;
  $('#refresh-chat')?.addEventListener('click',()=>chat().catch(e=>toast(e.message,true)));
  $('#chat-form')?.addEventListener('submit',async e=>{
   e.preventDefault();const message=$('#chat-input').value.trim();if(!message)return;
   try{await api('/api/chat',{method:'POST',data:{channel:'general',message}});await chat();}catch(err){toast(err.message,true);}
  });
 }
 async function payroll(){
  const start=new Date(),year=start.getFullYear(),month=String(start.getMonth()+1).padStart(2,'0');
  const from=$('#payroll-from')?.value||year+'-'+month+'-01';
  const to=$('#payroll-to')?.value||new Date().toISOString().slice(0,10);
  const data=await api('/api/payroll?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));
  $('#head-actions').innerHTML='';
  $screen.innerHTML='<div class="records-toolbar"><label>FROM <input id="payroll-from" type="date" value="'+esc(from)+'"></label><label>TO <input id="payroll-to" type="date" value="'+esc(to)+'"></label><button class="secondary" id="payroll-load">UPDATE REPORT</button></div>'+
   panel('APPROVED HOURS / ESTIMATED GROSS',table(data.rows.map(x=>({...x,hours:x.hours.toFixed(2),rateCents:x.rateCents===null?'NOT SET':money(x.rateCents),estimatedGrossCents:x.estimatedGrossCents===null?'NOT SET':money(x.estimatedGrossCents)})),['name','role','hours','rateCents','estimatedGrossCents'],'payroll',{rowActions:false}))+ '<p class="footnote">'+esc(data.disclaimer)+'</p>'+
   (allowed('payroll','manage')?'<button class="secondary" id="set-rate">SET HOURLY RATE</button>':'');
  $('#payroll-load')?.addEventListener('click',()=>payroll().catch(e=>toast(e.message,true)));
  $('#set-rate')?.addEventListener('click',()=>rateForm());
 }
 async function rateForm(){
  const list=await api('/api/staff');
  const body='<label>EMPLOYEE<select name="staffId" required>'+list.filter(x=>x.active).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label><label>HOURLY RATE (USD)<input type="number" name="amount" step="0.01" min="0" max="10000" required></label><p class="table-note">Rate changes affect future estimated payroll reports. Previously paid wages are not processed here.</p>';
  dialog('SET HOURLY RATE',body,async data=>{
   const amount=Number(data.get('amount'));if(!Number.isFinite(amount)||amount<0)throw new Error('Invalid rate');
   await api('/api/payroll/rates/'+encodeURIComponent(data.get('staffId')),{method:'PUT',data:{cents_per_hour:Math.round(amount*100)}});
   toast('Hourly rate updated');await payroll();
  });
 }
 async function reports(){
  const data=await api('/api/reports');
  $('#head-actions').innerHTML='';
  let out='<div class="report-grid">';
  for(const [name,value] of Object.entries(data)){
   const lines=Array.isArray(value)?value.map(x=>'<p>'+esc(friendly(x.label))+': <strong>'+esc(x.n)+'</strong></p>').join(''):
     Object.entries(value).map(([k,v])=>'<p>'+esc(friendly(k))+': <strong>'+money(v)+'</strong></p>').join('');
   out+='<div class="report-card"><h2>'+esc(friendly(name))+'</h2>'+lines+'</div>';
  }
  $screen.innerHTML=out+'</div><p class="footnote">Reports summarize data entered into this application, not automatically imported from SmartMoving or a bank.</p>';
 }
 async function permissions(){
  const data=await api('/api/permissions');
  const roles=data.roles.filter(x=>x!=='owner');
  const role=($('#select-role')?.value)||roles[0];
  const rows=data.permissions.filter(x=>x.role===role);
  $('#head-actions').innerHTML='';
  let html='<div class="records-toolbar"><label>ROLE TO REVIEW <select id="select-role">'+roles.map(x=>'<option value="'+esc(x)+'" '+(role===x?'selected':'')+'>'+esc(friendly(x))+'</option>').join('')+'</select></label></div>';
  html+='<p class="notice">These rules are enforced by the server. The owner retains complete access. Only the owner may change role permissions.</p>';
  html+='<div class="table-scroll"><table class="data-table permission-table"><thead><tr><th>RESOURCE</th>'+data.actions.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>';
  for(const resource of data.resources){
   html+='<tr><th>'+esc(friendly(resource))+'</th>'+data.actions.map(action=>{
    const item=rows.find(x=>x.resource===resource&&x.action===action);
    return '<td><input class="matrix-check" type="checkbox" data-resource="'+esc(resource)+'" data-action="'+esc(action)+'" '+(item?.allowed?'checked':'')+' '+(!allowed('permissions','manage')?'disabled':'')+' aria-label="'+esc(role+' '+resource+' '+action)+'"></td>';
   }).join('')+'</tr>';
  }
  html+='</tbody></table></div>';
  $screen.innerHTML=html;
  $('#select-role')?.addEventListener('change',()=>permissions().catch(e=>toast(e.message,true)));
  $$('.matrix-check').forEach(box=>box.addEventListener('change',async()=>{
   try{await api('/api/permissions',{method:'PATCH',data:{role,resource:box.dataset.resource,action:box.dataset.action,allowed:box.checked}});toast('Role permission updated');}
   catch(e){box.checked=!box.checked;toast(e.message,true);}
  }));
 }
 function inputMarkup([key,label,type,required,options],value){
  if(key==='status'&&!value)return ''; // All new records start in the correct workflow state.
  if((key==='status'&&['chat','announcements'].includes(module)))return '';
  const actual=type==='money'&&value!==undefined?(Number(value)/100).toFixed(2):type==='datetime-local'&&value?String(value).slice(0,16):value??'';
  const req=required&&!value?'required':'';
  if(type==='textarea')return '<label class="full">'+esc(label)+'<textarea name="'+esc(key)+'" rows="4" '+req+'>'+esc(actual)+'</textarea></label>';
  if(type==='select')return '<label>'+esc(label)+'<select name="'+esc(key)+'" '+req+'>'+options.map(x=>'<option value="'+esc(x)+'" '+(x===actual?'selected':'')+'>'+esc(friendly(x))+'</option>').join('')+'</select></label>';
  return '<label>'+esc(label)+'<input name="'+esc(key)+'" type="'+(type==='money'?'number':esc(type))+'" '+(type==='money'?'step="0.01" min="0"':'')+' value="'+esc(actual)+'" '+req+'></label>';
 }
 function dialog(title,body,submit){
  $('#dialog-title').textContent=title;
  $('#dialog-body').innerHTML=body;
  const backdrop=$('#dialog-backdrop');
  backdrop.hidden=false;
  const form=$('#record-form');
  form.onsubmit=async event=>{
   event.preventDefault();const btn=$('#save-dialog');btn.disabled=true;
   try{await submit(new FormData(form));closeDialog();}catch(e){toast(e.message,true);}
   finally{btn.disabled=false;}
  };
  $('#close-dialog').onclick=closeDialog;
  $('#cancel-dialog').onclick=closeDialog;
  backdrop.onclick=e=>{if(e.target===backdrop)closeDialog();};
  document.addEventListener('keydown',closeEsc);
  $('.dialog',backdrop)?.focus();
 }
 function closeEsc(e){if(e.key==='Escape')closeDialog();}
 function closeDialog(){ $('#dialog-backdrop').hidden=true;$('#record-form').onsubmit=null;document.removeEventListener('keydown',closeEsc);}
 function editRecord(kind,row=null){
  const spec=SPECS[kind];if(!spec)return;
  const canApprove=allowed(kind,'approve');
  const fields=spec.filter(([key])=>{
   if(key==='status'&&['time','leave','expenses'].includes(kind)&&!canApprove)return false;
   if(row&&kind==='time'&&!canApprove)return key==='ended_at'||key==='note';
   if(row&&kind==='leave'&&!canApprove)return false;
   return true;
  });
  const body='<div class="form-grid">'+fields.map(field=>inputMarkup(field,row?.[field[0]])).join('')+'</div>';
  dialog((row?'EDIT ':'NEW ')+friendly(kind),body,async data=>{
   const payload={};
   for(const [k,val] of data){
    if(k==='amount_cents'){
      const amount=Number(val);if(!Number.isFinite(amount)||amount<0)throw new Error('Invalid amount');
      payload[k]=Math.round(amount*100);
    } else if(['started_at','ended_at'].includes(k))payload[k]=val?new Date(val).toISOString():'';
    else payload[k]=val;
   }
   if(!row&&kind==='time'&&!payload.started_at)payload.started_at=new Date().toISOString();
   const path='/api/'+kind+(row?'/'+encodeURIComponent(row.id):'');
   await api(path,{method:row?'PATCH':'POST',data:payload});
   toast(row?'Record updated':'Record created');
   await renderModule(module);
  });
 }
 async function assignmentForm(job){
  const list=await api('/api/staff');
  const old=Array.isArray(job.assigned_staff)?job.assigned_staff.map(x=>x.id):[];
  const body='<p class="table-note">'+esc(job.customer_name)+' / '+esc(job.move_date)+'</p><div class="chip-group">'+list.filter(x=>x.active).map(x=>'<label class="checklabel"><input type="checkbox" name="person" value="'+esc(x.id)+'" '+(old.includes(x.id)?'checked':'')+'>'+esc(x.name)+' <small>'+esc(friendly(x.role))+'</small></label>').join('')+'</div>';
  dialog('ASSIGN CREW',body,async data=>{
   await api('/api/jobs/'+encodeURIComponent(job.id)+'/assignments',{method:'PUT',data:{staffIds:data.getAll('person')}});
   toast('Crew assignment saved');await renderModule(module);
  });
 }
 function employeeForm(row=null){
  const body='<div class="form-grid"><label>NAME<input name="name" value="'+esc(row?.name||'')+'" required></label>'+
   (!row?'<label>WORK EMAIL<input name="email" type="email" required></label>':'')+
   '<label>ROLE<select name="role">'+['crew','sales','dispatcher','operations','hr','finance','admin','owner'].filter(role=>{
      if(user.role==='owner')return true;
      if(user.role==='hr')return role==='crew';
      return !['owner','admin','hr','finance'].includes(role);
   }).map(role=>'<option value="'+role+'" '+(row?.role===role?'selected':'')+'>'+esc(friendly(role))+'</option>').join('')+'</select></label>'+
   (row?'<label>STATUS<select name="active"><option value="true" '+(row.active?'selected':'')+'>Active</option><option value="false" '+(!row.active?'selected':'')+'>Inactive</option></select></label>'+
   '<label class="checklabel"><input type="checkbox" name="resetPassword" value="yes"> Reset password (generates one-time temporary password)</label>':'')+'</div>';
  dialog(row?'MANAGE EMPLOYEE':'ADD EMPLOYEE',body,async data=>{
   const payload={name:data.get('name'),role:data.get('role')};
   if(!row)payload.email=data.get('email');
   if(row){payload.active=data.get('active')==='true';if(data.get('resetPassword'))payload.resetPassword=true;}
   const response=await api('/api/staff'+(row?'/'+encodeURIComponent(row.id):''),{method:row?'PATCH':'POST',data:payload});
   if(response.temporaryPassword){
    // One-time temporary password is shown only on success, not persisted in the UI.
    window.prompt('Copy this temporary password and deliver it securely to the employee. It will not be shown again:',response.temporaryPassword);
   }
   toast('Employee record saved');await renderModule('staff');
  });
 }
 function paymentForm(row){
  const body='<div class="notice">UNPAID BALANCE: '+esc(money(row.amount_cents-row.paid_cents))+'</div><div class="form-grid"><label>AMOUNT RECEIVED (USD)<input name="amount" type="number" min="0.01" max="'+((row.amount_cents-row.paid_cents)/100).toFixed(2)+'" step="0.01" required></label><label>METHOD<select name="method"><option>cash</option><option>card</option><option>check</option><option>transfer</option><option>other</option></select></label><label>DATE<input type="date" name="received_on" value="'+new Date().toISOString().slice(0,10)+'"></label><label>REFERENCE<input name="reference" maxlength="150"></label></div><p class="table-note">Only record payments already received. This does not charge a card or transfer funds.</p>';
  dialog('RECORD PAYMENT',body,async data=>{
   const amount=Number(data.get('amount'));
   if(!Number.isFinite(amount)||amount<=0)throw new Error('Invalid amount');
   await api('/api/invoices/'+encodeURIComponent(row.id)+'/payments',{method:'POST',data:{amount_cents:Math.round(amount*100),method:data.get('method'),received_on:data.get('received_on'),reference:data.get('reference')}});
   toast('Payment recorded');await renderModule(module);
  });
 }
 $('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('#login-form button');btn.disabled=true;
  try{
   const data=new FormData(e.currentTarget);
   const result=await api('/api/auth/login',{method:'POST',data:{email:data.get('email'),password:data.get('password')}});
   e.currentTarget.reset();user=result.user;csrf=result.csrf;grants=result.permissions||{};
   if(user.changePassword)passwordView();else workspaceView();
  }catch(err){toast(err.message,true);}finally{btn.disabled=false;}
 });
 $('#password-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const data=new FormData(e.currentTarget);
  try{
   const result=await api('/api/auth/password',{method:'POST',data:{oldPassword:data.get('current'),newPassword:data.get('next')}});
   e.currentTarget.reset();user=result.user;csrf=result.csrf;grants=result.permissions;workspaceView();toast('Password updated');
  }catch(err){toast(err.message,true);}
 });
 $('#logout').addEventListener('click',async()=>{
  try{await api('/api/auth/logout',{method:'POST'});}catch{}
  user=null;csrf='';grants={};loginView();
 });
 $('#sidebar-toggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
 refreshAuth();
})();
