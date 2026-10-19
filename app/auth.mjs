import crypto from 'node:crypto';
import { audit } from './db.mjs';

const TTL_MS=7*24*60*60*1000;
const IDLE_MS=12*60*60*1000;
const MAX_BYTES=64*1024;
export const now=()=>new Date().toISOString();
export const id=()=>crypto.randomUUID();

export function hashPassword(password) {
  if(typeof password!=='string'||password.length<12||password.length>256) throw new Error('Password must have between 12 and 256 characters');
  const salt=crypto.randomBytes(16).toString('hex');
  const digest=crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1}).toString('hex');
  return 'scrypt$'+salt+'$'+digest;
}
export function checkPassword(password,encoded) {
  if(typeof password!=='string'||typeof encoded!=='string') return false;
  const parts=encoded.split('$');
  if(parts.length!==3||parts[0]!=='scrypt'||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const expected=Buffer.from(parts[2],'hex');
  try { return crypto.timingSafeEqual(crypto.scryptSync(password,parts[1],64,{N:16384,r:8,p:1}),expected); }
  catch { return false; }
}
function cookieValue(req,name) {
  const cookies=(req.headers.cookie||'').split(';');
  for(const cookie of cookies){const pos=cookie.indexOf('=');if(pos<0)continue;if(cookie.slice(0,pos).trim()===name)return cookie.slice(pos+1).trim();}
  return '';
}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export function sessionFromRequest(db,req) {
  const raw=cookieValue(req,'r1_session');
  if(!/^[a-f0-9]{64}$/.test(raw)) return null;
  const record=db.prepare('SELECT s.token_hash,s.csrf,s.expires_at,s.last_used,st.* FROM sessions s JOIN staff st ON st.id=s.staff_id WHERE s.token_hash=?').get(digest(raw));
  const current=Date.now();
  if(!record||!record.active||record.expires_at<=current||record.last_used+IDLE_MS<=current)return null;
  // Touch no more than once every five minutes to reduce write contention.
  if(current-record.last_used>300000)db.prepare('UPDATE sessions SET last_used=? WHERE token_hash=?').run(current,record.token_hash);
  return {user:publicUser(record),csrf:record.csrf,tokenHash:record.token_hash};
}
export function publicUser(row) {
  return {id:row.id,email:row.email,name:row.name,role:row.role,active:!!row.active,changePassword:!!row.change_password};
}
export function issueSession(db,user,res) {
  const raw=crypto.randomBytes(32).toString('hex');
  const csrf=crypto.randomBytes(24).toString('hex');
  const current=Date.now();
  db.prepare('INSERT INTO sessions(token_hash,staff_id,csrf,expires_at,last_used) VALUES (?,?,?,?,?)')
    .run(digest(raw),user.id,csrf,current+TTL_MS,current);
  const secure=process.env.NODE_ENV==='production'?'; Secure':'';
  res.setHeader('Set-Cookie','r1_session='+raw+'; Path=/; HttpOnly; SameSite=Strict'+secure+'; Max-Age=604800');
  return csrf;
}
export function clearSession(db,session,res) {
  if(session)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.tokenHash);
  const secure=process.env.NODE_ENV==='production'?'; Secure':'';
  res.setHeader('Set-Cookie','r1_session=; Path=/; HttpOnly; SameSite=Strict'+secure+'; Max-Age=0');
}
export function requireCsrf(req,session) {
  const submitted=req.headers['x-csrf-token'];
  if(typeof submitted!=='string'||!session||submitted.length!==session.csrf.length) return false;
  return crypto.timingSafeEqual(Buffer.from(submitted),Buffer.from(session.csrf));
}
export function verifyOrigin(req) {
  const origin=req.headers.origin;
  if(!origin) return true; // CSRF token and JSON content-type are still required.
  try {
    const host=req.headers.host;
    if(!host)return false;
    const originUrl=new URL(origin);
    // Reverse proxies should preserve Host and X-Forwarded-Proto must not be trusted from the public network.
    const scheme=process.env.NODE_ENV==='production'?'https':'http';
    return originUrl.origin===scheme+'://'+host;
  }catch{return false;}
}
export function loginAllowed(db,key) {
  const since=Date.now()-15*60*1000;
  db.prepare('DELETE FROM login_attempts WHERE created_at<?').run(since);
  const count=db.prepare('SELECT count(*) AS total FROM login_attempts WHERE key=? AND created_at>=?').get(key,since).total;
  return count<8;
}
export function registerFailure(db,key) {
  db.prepare('INSERT INTO login_attempts(key,created_at) VALUES (?,?)').run(key,Date.now());
}
export function clearFailures(db,key) {
  db.prepare('DELETE FROM login_attempts WHERE key=?').run(key);
}
export async function readJson(req) {
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw Object.assign(new Error('Content-Type must be application/json'),{status:415});
  let bytes=0,parts=[];
  for await(const part of req){
    bytes+=part.length;
    if(bytes>MAX_BYTES)throw Object.assign(new Error('Request too large'),{status:413});
    parts.push(part);
  }
  let data;
  try {data=JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch {throw Object.assign(new Error('Malformed JSON'),{status:400});}
  if(!data||Array.isArray(data)||typeof data!=='object')throw Object.assign(new Error('Expected a JSON object'),{status:400});
  return data;
}
export function cleanText(value,label,max=500,required=false) {
  if(value===undefined||value===null)value='';
  if(typeof value!=='string')throw Object.assign(new Error(label+' must be text'),{status:400});
  const text=value.trim();
  if(text.length>max||(required&&!text))throw Object.assign(new Error(label+' is invalid (max '+max+' characters)'),{status:400});
  return text;
}
export function cents(value,label='Amount') {
  if(!Number.isSafeInteger(value)||value<0||value>1_000_000_000)throw Object.assign(new Error(label+' must be nonnegative integer cents'),{status:400});
  return value;
}
export function error(status,message) {
  return Object.assign(new Error(message),{status});
}
export function logAction(db,user,action,resource,record='',detail='') {
  audit(db,user,action,resource,record,detail);
}
