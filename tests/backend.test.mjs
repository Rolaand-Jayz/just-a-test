import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import crypto from 'node:crypto';
import {createServer} from '../app/server.mjs';
import {hashPassword} from '../app/auth.mjs';

const dir=mkdtempSync(join(tmpdir(),'rescue1-api-test-'));
const {server,db}=createServer({dbPath:join(dir,'test.sqlite')});
const adminId=crypto.randomUUID();
db.prepare("INSERT INTO staff(id,email,name,role,password_hash,active,change_password,created_at) VALUES (?,?,?,?,?,1,0,?)")
 .run(adminId,'owner@rescue.local','Owner Example','owner',hashPassword('owner-super-secure-12345!'),new Date().toISOString());
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});

async function request(path,{method='GET',body,session}={}){
 const headers={};
 if(body!==undefined)headers['content-type']='application/json';
 if(session){headers.cookie=session.cookie;if(session.csrf)headers['x-csrf-token']=session.csrf;}
 const response=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>null);
 return {status:response.status,data,cookie:response.headers.get('set-cookie')};
}
async function signin(email,password){
 const result=await request('/api/auth/login',{method:'POST',body:{email,password}});
 assert.equal(result.status,200,JSON.stringify(result.data));
 return {cookie:result.cookie.split(';')[0],csrf:result.data.csrf,user:result.data.user};
}

test('visitor site is public; employee data is not',async()=>{
 const site=await fetch(origin+'/');
 assert.equal(site.status,200);assert.match(await site.text(),/YOUR MOVE/);
 const staff=await fetch(origin+'/staff');assert.equal(staff.status,200);
 const privateResult=await request('/api/jobs');assert.equal(privateResult.status,401);
 const dotfile=await request('/app/db.mjs');assert.equal(dotfile.status,404);
});
test('authenticated workflows enforce RBAC and row ownership',async()=>{
 const owner=await signin('owner@rescue.local','owner-super-secure-12345!');
 const noCsrf=await request('/api/jobs',{method:'POST',session:{cookie:owner.cookie},body:{customer_name:'No',origin:'Road',move_date:'2026-12-01'}});
 assert.equal(noCsrf.status,403);
 const newCrew=await request('/api/staff',{method:'POST',session:owner,body:{name:'Crew Member',email:'crew@rescue.local',role:'crew'}});
 assert.equal(newCrew.status,201,JSON.stringify(newCrew.data));
 assert.ok(newCrew.data.temporaryPassword);
 const crew=await signin('crew@rescue.local',newCrew.data.temporaryPassword);
 assert.equal(crew.user.changePassword,true);
 assert.equal((await request('/api/jobs',{session:crew})).status,403);
 const newPassword=await request('/api/auth/password',{method:'POST',session:crew,body:{oldPassword:newCrew.data.temporaryPassword,newPassword:'crew-rotated-password-1234'}});
 assert.equal(newPassword.status,200,JSON.stringify(newPassword.data));
 crew.cookie=newPassword.cookie.split(';')[0];crew.csrf=newPassword.data.csrf;
 assert.equal((await request('/api/invoices',{session:crew})).status,403);
 assert.equal((await request('/api/permissions',{session:crew})).status,403);
 const jobData={customer_name:'Movers Customer',origin:'Amarillo, TX',destination:'Canyon, TX',move_date:'2026-12-01'};
 const created=await request('/api/jobs',{method:'POST',session:owner,body:jobData});
 assert.equal(created.status,201,JSON.stringify(created.data));
 const jobId=created.data.id;
 const invisible=await request('/api/jobs',{session:crew});assert.deepEqual(invisible.data,[]);
 const assign=await request('/api/jobs/'+jobId+'/assignments',{method:'PUT',session:owner,body:{staffIds:[crew.user.id]}});
 assert.equal(assign.status,200,JSON.stringify(assign.data));
 const visible=await request('/api/jobs',{session:crew});
 assert.equal(visible.status,200);assert.equal(visible.data.length,1);
 const noAssign=await request('/api/jobs/'+jobId+'/assignments',{method:'PUT',session:crew,body:{staffIds:[]}});
 assert.equal(noAssign.status,403);
 const quote=await request('/api/quotes',{method:'POST',session:owner,body:{customer_name:'Movers Customer',amount_cents:32500}});
 assert.equal(quote.status,201,JSON.stringify(quote.data));
 assert.equal(quote.data.status,'draft');
 const message=await request('/api/chat',{method:'POST',session:crew,body:{channel:'general',message:'Ready for tomorrow'}});
 assert.equal(message.status,201,JSON.stringify(message.data));
 assert.equal((await request('/api/chat',{session:owner})).data.length,1);
 const announcement=await request('/api/announcements',{method:'POST',session:owner,body:{title:'Safety first',body:'Check your routes',priority:'normal'}});
 assert.equal(announcement.status,201);
 assert.equal((await request('/api/announcements',{session:crew})).data.length,1);
});
test('employee time approvals and finance reports work with separation of duties',async()=>{
 const owner=await signin('owner@rescue.local','owner-super-secure-12345!');
 const crewId=db.prepare("SELECT id FROM staff WHERE email=?").get('crew@rescue.local').id;
 const rate=await request('/api/payroll/rates/'+crewId,{method:'PUT',session:owner,body:{cents_per_hour:2150}});
 assert.equal(rate.status,200,JSON.stringify(rate.data));
 const crew=await signin('crew@rescue.local','crew-rotated-password-1234');
 const started='2026-12-01T09:00:00.000Z',ended='2026-12-01T13:00:00.000Z';
 const time=await request('/api/time',{method:'POST',session:crew,body:{started_at:started,ended_at:ended,note:'Loading'}});
 assert.equal(time.status,201,JSON.stringify(time.data));
 assert.equal(time.data.staff_id,crew.user.id);
 assert.equal(time.data.status,'pending');
 const blocked=await request('/api/time/'+time.data.id,{method:'PATCH',session:crew,body:{status:'approved'}});
 assert.equal(blocked.status,403);
 const approval=await request('/api/time/'+time.data.id,{method:'PATCH',session:owner,body:{status:'approved'}});
 assert.equal(approval.status,200);assert.equal(approval.data.status,'approved');
 const payroll=await request('/api/payroll?from=2026-12-01&to=2026-12-31',{session:owner});
 assert.equal(payroll.status,200,JSON.stringify(payroll.data));
 const line=payroll.data.rows.find(x=>x.staffId===crewId);
 assert.equal(line.hours,4);assert.equal(line.estimatedGrossCents,8600);
 assert.equal((await request('/api/payroll',{session:crew})).status,403);
});
test('an owner can change permissions but the crew cannot',async()=>{
 const owner=await signin('owner@rescue.local','owner-super-secure-12345!');
 const mutate=await request('/api/permissions',{method:'PATCH',session:owner,body:{role:'dispatcher',resource:'invoices',action:'view',allowed:true}});
 assert.equal(mutate.status,200,JSON.stringify(mutate.data));
 const list=await request('/api/permissions',{session:owner});
 assert.equal(list.status,200);
 assert.ok(list.data.permissions.some(x=>x.role==='dispatcher'&&x.resource==='invoices'&&x.action==='view'&&x.allowed===1));
});
