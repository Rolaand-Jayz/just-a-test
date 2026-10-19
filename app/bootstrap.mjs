import crypto from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase,audit} from './db.mjs';
import {hashPassword} from './auth.mjs';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const db=openDatabase(process.env.R1_DB_PATH||join(ROOT,'var','rescue1.sqlite'));
try{
 const existing=db.prepare('SELECT COUNT(*) AS count FROM staff').get().count;
 if(existing) {
  console.error('Initialization refused: employee accounts already exist. Use the owner portal for account management.');
  process.exitCode=1;
 }else{
  const name=(process.env.R1_OWNER_NAME||'').trim();
  const email=(process.env.R1_OWNER_EMAIL||'').trim().toLowerCase();
  const password=process.env.R1_OWNER_PASSWORD||'';
  if(!name||name.length>140||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>256){
   console.error('Set R1_OWNER_NAME, R1_OWNER_EMAIL, and a strong R1_OWNER_PASSWORD (12–256 characters). Do not include passwords in command arguments.');
   process.exitCode=1;
  }else{
   const id=crypto.randomUUID();
   db.prepare('INSERT INTO staff(id,email,name,role,password_hash,active,change_password,created_at) VALUES (?,?,?,?,?,1,0,?)')
    .run(id,email,name,'owner',hashPassword(password),new Date().toISOString());
   audit(db,{id},'initialize','staff',id,'First owner account created');
   console.log('Owner account created for '+email+'. No default or demo accounts were created.');
  }
 }
}finally{db.close();}
