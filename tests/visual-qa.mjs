import { chromium } from 'playwright-core';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../app/server.mjs';
import { hashPassword } from '../app/auth.mjs';

const dir=mkdtempSync(join(tmpdir(),'rescue1-visual-'));
const output=resolve(process.env.VISUAL_OUT||'visual-review');
mkdirSync(output,{recursive:true});
const {server,db}=createServer({dbPath:join(dir,'visual.sqlite')});
const credentials={email:'preview-owner@example.test',password:'Visual-Only-QA-2026-Password!'};
const ownerId=crypto.randomUUID(),crewId=crypto.randomUUID();
const created=new Date().toISOString();
for(const row of [
 {id:ownerId,email:credentials.email,name:'Visual Test Owner',role:'owner',password:credentials.password},
 {id:crewId,email:'preview-crew@example.test',name:'Preview Crew',role:'crew',password:'Visual-Only-Crew-Password!'}
]){
 db.prepare('INSERT INTO staff (id,email,name,role,password_hash,active,change_password,created_at) VALUES (?,?,?,?,?,1,0,?)')
   .run(row.id,row.email,row.name,row.role,hashPassword(row.password),created);
}
const jobId=crypto.randomUUID();
db.prepare('INSERT INTO jobs(id,customer_name,phone,origin,destination,move_date,start_time,status,service,crew_notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(jobId,'Example Customer','(806) 555-0111','Amarillo, TX','Canyon, TX','2026-10-25','08:00','scheduled','residential','Visual test record only',created);
db.prepare('INSERT INTO assignments(job_id,staff_id) VALUES (?,?)').run(jobId,crewId);
db.prepare('INSERT INTO leads(id,customer_name,phone,origin,destination,status,created_at) VALUES (?,?,?,?,?,?,?)')
  .run(crypto.randomUUID(),'Sample Customer','(806) 555-0144','Amarillo','Canyon','new',created);
db.prepare('INSERT INTO invoices(id,customer_name,invoice_number,amount_cents,paid_cents,status,created_at) VALUES (?,?,?,?,?,?,?)')
  .run(crypto.randomUUID(),'Example Customer','QA-1001',48500,15000,'sent',created);
db.prepare('INSERT INTO announcements(id,title,body,priority,author_id,created_at) VALUES (?,?,?,?,?,?)')
  .run(crypto.randomUUID(),'Welcome to Rescue 1','Safety first. Check your move instructions before leaving.', 'normal',ownerId,created);

await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const issues=[],captured=[];
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';

function issue(category,page,message) {
 issues.push({category,page,message:String(message)});
}
async function snap(browser,{name,path='/',width=1440,height=900,action}){
 const context=await browser.newContext({
  viewport:{width,height},deviceScaleFactor:1,
  reducedMotion:'reduce',colorScheme:'light',ignoreHTTPSErrors:false
 });
 const page=await context.newPage();
 const pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 page.on('console',e=>{if(e.type()==='error'&&!e.text().includes('net::ERR'))pageErrors.push('console: '+e.text());});
 const response=await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:20000});
 await page.waitForTimeout(750);
 if(action)await action(page);
 await page.waitForTimeout(350);
 const overflow=await page.evaluate(()=>({
  viewport:window.innerWidth,
  document:document.documentElement.scrollWidth,
  body:document.body.scrollWidth,
  images:[...document.querySelectorAll('main img')].map(el=>({src:el.currentSrc.slice(0,120),ok:el.complete&&el.naturalWidth>0}))
 }));
 if(overflow.document>overflow.viewport+3)issue('horizontal-overflow',name,overflow);
 if(overflow.images.some(x=>!x.ok))issue('unloaded-images',name,overflow.images.filter(x=>!x.ok));
 for(const e of pageErrors)issue('browser-error',name,e);
 const file=name+'.png';
 await page.screenshot({path:join(output,file),fullPage:true,animations:'disabled'});
 captured.push({name,file,width,height,pathname:path,http:response?.status(),overflow});
 await context.close();
}
let browser;
try{
 browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const screens=[
  ['homepage-desktop','/',1440,900],
  ['homepage-tablet','/',768,1024],
  ['homepage-mobile','/',390,844],
  ['services-desktop','/services/residential-moving.html',1440,900],
  ['services-mobile','/services/apartment-moving.html',390,844],
  ['moving-guide-mobile','/moving-guide.html',390,844],
  ['staff-signin-desktop','/staff',1440,900],
  ['staff-signin-mobile','/staff',390,844]
 ];
 for(const [name,path,width,height] of screens)await snap(browser,{name,path,width,height});
 const login=async(page,email,password)=>{
  await page.locator('#login-form input[name=email]').fill(email);
  await page.locator('#login-form input[name=password]').fill(password);
  const resultPromise=page.waitForResponse(response=>response.url().endsWith('/api/auth/login'),{timeout:15000});
  await page.locator('#login-form button[type=submit]').click();
  const response=await resultPromise;
  const body=await response.text();
  console.log('VISUAL LOGIN:',response.status(),body.slice(0,280).replace(/"csrf":"[^"]+"/g,'"csrf":"[redacted]"'));
  try{
   await page.locator('#workspace').waitFor({state:'visible',timeout:8000});
  }catch(e){
   const warning=await page.locator('#toast').innerText().catch(()=>'(none)');
   const current=await page.locator('#auth-heading').innerText().catch(()=>'(not found)');
   console.error('VISUAL SIGN-IN DIAG:',JSON.stringify({heading:current,warning,visible:await page.locator('#workspace').isVisible()}));
   await page.screenshot({path:join(output,'staff-login-failure.png'),fullPage:true});
   throw e;
  }
 };
 for(const [name,target,width,height] of [
  ['staff-owner-dashboard','overview',1440,900],
  ['staff-owner-jobs','jobs',1440,900],
  ['staff-owner-permissions','permissions',1440,900],
  ['staff-owner-mobile','overview',390,844],
  ['staff-owner-finance-mobile','invoices',390,844]
 ]){
  await snap(browser,{name,path:'/staff',width,height,action:async(page)=>{
   await login(page,credentials.email,credentials.password);
   if(target!=='overview'){
    if(width<761){
     await page.locator('#sidebar-toggle').click();
     await page.locator('#sidebar.open').waitFor({state:'visible'});
    }
    await page.locator('[data-module="'+target+'"]').click();
    await page.waitForTimeout(500);
   }
  }});
 }
 await snap(browser,{name:'staff-crew-dashboard',path:'/staff',width:390,height:844,action:async(page)=>{
  await login(page,'preview-crew@example.test','Visual-Only-Crew-Password!');
 }});
 await snap(browser,{name:'homepage-mobile-menu',path:'/',width:390,height:844,action:async(page)=>{
  await page.locator('#mobile-toggle').click();
  if(await page.locator('#mobile-menu').isHidden())issue('mobile-menu','homepage-mobile-menu','Mobile menu did not open');
 }});
 await snap(browser,{name:'homepage-mobile-checklist',path:'/',width:390,height:844,action:async(page)=>{
  await page.locator('#planner-form').locator('button[type=submit]').click();
  if(await page.locator('#planner-output').isHidden())issue('move-planner','homepage-mobile-checklist','Planner output remained hidden');
 }});
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
 rmSync(dir,{recursive:true,force:true});
}
const report={capturedAt:new Date().toISOString(),screenshots:captured,issues};
writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log('Visual QA screens:',captured.length,'detected issues:',issues.length);
for(const x of issues)console.log('VISUAL ISSUE:',x.category,x.page,JSON.stringify(x.message).slice(0,500));
// Actual browser navigation, login and interaction errors should block CI.
// Fonts/images may intermittently be blocked by third-party services; report them for review.
if(issues.some(x=>['horizontal-overflow','browser-error','mobile-menu','move-planner'].includes(x.category)))process.exitCode=1;
