import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {openDatabase,permissionMap,audit} from './db.mjs';
import {hashPassword,checkPassword,publicUser,sessionFromRequest,issueSession,clearSession,requireCsrf,verifyOrigin,readJson,error,loginAllowed,registerFailure,clearFailures} from './auth.mjs';
import {routeAPI} from './api.mjs';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const ALLOWED=new Set([
 '/','/index.html','/styles.css','/script.js','/favicon.svg','/robots.txt',
 '/sitemap.xml','/404.html','/moving-guide.html','/staff','/staff/',
 '/staff/app.js','/staff/style.css','/services/residential-moving.html',
 '/services/apartment-moving.html','/services/office-moving.html',
 '/services/long-distance-moving.html','/services/packing-moving-labor.html'
]);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
 '.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml',
 '.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
const DUMMY=hashPassword(crypto.randomBytes(18).toString('base64url'));
const isProduction=process.env.NODE_ENV==='production';
const dbDefault=join(ROOT,'var','rescue1.sqlite');
function send(res,status,body){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 res.end(JSON.stringify(body));
}
function headers(res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Content-Security-Policy',[
  "default-src 'self'","script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' https://images.squarespace-cdn.com data:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'","frame-src https://portal.smartmoving.com",
  "object-src 'none'","base-uri 'self'","frame-ancestors 'none'","form-action 'self'"
 ].join('; '));
 if(isProduction)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
async function staticResponse(req,res,path){
 if(!ALLOWED.has(path))return send(res,404,{error:'Not found'});
 const filename=path==='/'?'index.html':path==='/staff'||path==='/staff/'?'app/ui/index.html':path.startsWith('/staff/')?'app/ui/'+path.slice(7):path.slice(1);
 try{
  const file=join(ROOT,filename);
  if(!(await stat(file)).isFile())return send(res,404,{error:'Not found'});
  const content=await readFile(file);
  const type=MIME[filename.slice(filename.lastIndexOf('.'))]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':path.startsWith('/staff')?'no-store':'public, max-age=300'});
  if(req.method==='HEAD')res.end();else res.end(content);
 }catch {send(res,404,{error:'Not found'});}
}
export function createServer({dbPath=process.env.R1_DB_PATH||dbDefault}={}){
 const db=openDatabase(dbPath);
 const server=http.createServer(async(req,res)=>{
  headers(res);
  try {
   const url=new URL(req.url||'/','http://localhost'),path=url.pathname,method=req.method;
   if(!path.startsWith('/api/')){
    if(method!=='GET'&&method!=='HEAD')throw error(405,'Method not allowed');
    return await staticResponse(req,res,path);
   }
   if(path==='/api/health'&&method==='GET')return send(res,200,{ok:true});
   if(!verifyOrigin(req)&&!['GET','HEAD'].includes(method))throw error(403,'Origin mismatch');
   if(path==='/api/auth/login'&&method==='POST'){
    const body=await readJson(req);
    const email=typeof body.email==='string'?body.email.trim().toLowerCase().slice(0,180):'';
    const password=typeof body.password==='string'?body.password:'';
    const ip='ip:'+(req.socket.remoteAddress||'unknown'),account='account:'+email;
    if(!loginAllowed(db,ip)||!loginAllowed(db,account))throw error(429,'Too many attempts; try again in 15 minutes');
    const row=email?db.prepare('SELECT * FROM staff WHERE email=?').get(email):null;
    const valid=checkPassword(password,row?.password_hash||DUMMY);
    if(!row||!row.active||!valid){
     registerFailure(db,ip);registerFailure(db,account);
     throw error(401,'Invalid email or password');
    }
    clearFailures(db,ip);clearFailures(db,account);
    const csrf=issueSession(db,row,res);
    audit(db,row,'login','staff',row.id);
    return send(res,200,{user:publicUser(row),csrf,permissions:permissionMap(db,row)});
   }
   const session=sessionFromRequest(db,req);
   if(!session)throw error(401,'Please sign in');
   if(['POST','PATCH','PUT','DELETE'].includes(method)&&!requireCsrf(req,session))throw error(403,'Invalid security token; sign in again');
   if(path==='/api/auth/logout'&&method==='POST'){
    audit(db,session.user,'logout','staff',session.user.id);
    clearSession(db,session,res);return send(res,200,{ok:true});
   }
   if(path==='/api/auth/session'&&method==='GET')
    return send(res,200,{user:session.user,csrf:session.csrf,permissions:permissionMap(db,session.user)});
   if(path==='/api/auth/password'&&method==='POST'){
    const body=await readJson(req);
    if(typeof body.newPassword!=='string'||body.newPassword.length<12||body.newPassword.length>256)throw error(400,'Password must be 12 to 256 characters');
    const record=db.prepare('SELECT password_hash FROM staff WHERE id=?').get(session.user.id);
    if(!checkPassword(body.oldPassword,record.password_hash))throw error(400,'Incorrect current password');
    if(checkPassword(body.newPassword,record.password_hash))throw error(400,'Choose a different password');
    db.prepare('UPDATE staff SET password_hash=?,change_password=0 WHERE id=?').run(hashPassword(body.newPassword),session.user.id);
    db.prepare('DELETE FROM sessions WHERE staff_id=?').run(session.user.id);
    audit(db,session.user,'password-change','staff',session.user.id);
    const user={...session.user,changePassword:false};
    const csrf=issueSession(db,user,res);
    return send(res,200,{user,csrf,permissions:permissionMap(db,user)});
   }
   if(session.user.changePassword)throw error(403,'Change your temporary password first');
   if(!['GET','POST','PATCH','PUT','DELETE'].includes(method))throw error(405,'Method not allowed');
   const body=['POST','PATCH','PUT'].includes(method)?await readJson(req):{};
   const payload=routeAPI(db,session,method,path,url.searchParams,body);
   return send(res,method==='POST'?201:200,payload);
  }catch(e){
   let status=Number.isInteger(e.status)?e.status:500;
   if(e.code==='SQLITE_CONSTRAINT_UNIQUE'||e.code==='SQLITE_CONSTRAINT_PRIMARYKEY')status=409;
   if(e.code==='SQLITE_CONSTRAINT_FOREIGNKEY')status=409;
   if(e.code==='SQLITE_CONSTRAINT_CHECK')status=400;
   if(status===500)console.error('Request failed:',e);
   if(!res.headersSent)send(res,status,{error:status===500?'Unexpected server error':String(e.message)});
  }
 });
 server.on('close',()=>db.close());
 return {server,db};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8080);
 if(isProduction&&host!=='127.0.0.1'&&host!=='::1')console.warn('Bind behind a trusted HTTPS reverse proxy, not directly to the internet');
 const {server}=createServer();
 server.listen(port,host,()=>console.log('Rescue 1 website and employee portal: http://'+host+':'+port));
 const close=()=>server.close(()=>process.exit(0));
 process.on('SIGINT',close);process.on('SIGTERM',close);
}
