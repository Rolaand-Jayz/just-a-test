import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../app/server.mjs';
import {hashPassword} from '../app/auth.mjs';

const dir=mkdtempSync(join(tmpdir(),'rescue1-roles-'));
const {server,db}=createServer({dbPath:join(dir,'roles.sqlite')});
const ownerId=crypto.randomUUID();
db.prepare("INSERT INTO staff(id,email,name,role,password_hash,active,change_password,created_at) VALUES (?,?,?,?,?,1,0,?)")
 .run(ownerId,'owner@local.test','Business Owner','owner',hashPassword('long-original-owner-password!'),new Date().toISOString());
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
async function call(path,method='GET',data=null,auth=null,origin=null){
 const headers={};
 if(data!==null)headers['Content-Type']='application/json';
 if(auth){headers.cookie=auth.cookie;if(auth.csrf)headers['X-CSRF-Token']=auth.csrf;}
 if(origin)headers.origin=origin;
 const resp=await fetch(url+path,{method,headers,body:data===null?undefined:JSON.stringify(data)});
 return {code:resp.status,body:await resp.json(),cookie:resp.headers.get('set-cookie')};
}
async function login(email,password){
 const r=await call('/api/auth/login','POST',{email,password});
 assert.equal(r.code,200,JSON.stringify(r.body));
 return {cookie:r.cookie.split(';')[0],csrf:r.body.csrf,changePassword:r.body.user.changePassword};
}
async function createRole(owner,role){
 const email=role+'@local.test';
 const invited=await call('/api/staff','POST',{name:role.toUpperCase(),email,role},owner);
 assert.equal(invited.code,201,JSON.stringify(invited.body));
 const initial=await login(email,invited.body.temporaryPassword);
 assert.equal(initial.changePassword,true);
 const next='rotated-'+role+'-secure-password-987';
 const rotated=await call('/api/auth/password','POST',{oldPassword:invited.body.temporaryPassword,newPassword:next},initial);
 assert.equal(rotated.code,200,JSON.stringify(rotated.body));
 return {cookie:rotated.cookie.split(';')[0],csrf:rotated.body.csrf};
}

test('functional separation between finance, HR, dispatch, sales and admin',async()=>{
 const owner=await login('owner@local.test','long-original-owner-password!');
 const finance=await createRole(owner,'finance');
 const hr=await createRole(owner,'hr');
 const dispatcher=await createRole(owner,'dispatcher');
 const sales=await createRole(owner,'sales');
 const admin=await createRole(owner,'admin');
 assert.equal((await call('/api/invoices','GET',null,finance)).code,200);
 assert.equal((await call('/api/payroll','GET',null,finance)).code,200);
 assert.equal((await call('/api/leave','GET',null,finance)).code,403);
 assert.equal((await call('/api/staff','POST',{name:'Someone',email:'person@local.test',role:'crew'},finance)).code,403);
 assert.equal((await call('/api/staff','GET',null,finance)).code,200);
 assert.equal((await call('/api/leave','GET',null,hr)).code,200);
 assert.equal((await call('/api/payroll','GET',null,hr)).code,200);
 assert.equal((await call('/api/invoices','GET',null,hr)).code,403);
 assert.equal((await call('/api/jobs','GET',null,dispatcher)).code,200);
 assert.equal((await call('/api/invoices','GET',null,dispatcher)).code,403);
 assert.equal((await call('/api/staff','GET',null,dispatcher)).code,200);
 assert.equal((await call('/api/quotes','POST',{customer_name:'Customer A',amount_cents:30000},sales)).code,201);
 assert.equal((await call('/api/payroll','GET',null,sales)).code,403);
 assert.equal((await call('/api/permissions','PATCH',{role:'crew',resource:'invoices',action:'view',allowed:true},admin)).code,403);
 assert.equal((await call('/api/permissions','PATCH',{role:'crew',resource:'invoices',action:'view',allowed:true},owner)).code,200);
 assert.equal((await call('/api/invoices','GET',null,admin)).code,200);
});
test('same-origin mutation checks and staff credentials cannot be read through API',async()=>{
 const owner=await login('owner@local.test','long-original-owner-password!');
 const staff=await call('/api/staff','GET',null,owner);
 assert.equal(staff.code,200);
 assert.ok(staff.body.length>=5);
 for(const employee of staff.body) {
  assert.equal(Object.hasOwn(employee,'password_hash'),false);
  assert.equal(Object.hasOwn(employee,'csrf'),false);
 }
 const crossOrigin=await call('/api/chat','POST',{message:'Untrusted source'},owner,'https://attacker.invalid');
 assert.equal(crossOrigin.code,403);
 const noCsrf={cookie:owner.cookie};
 const denied=await call('/api/chat','POST',{message:'Missing CSRF'},noCsrf);
 assert.equal(denied.code,403);
});
