#!/usr/bin/env node
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dbPath=resolve(process.env.R1_DB_PATH||join(root,'var','rescue1.sqlite'));
const folder=resolve(process.env.R1_BACKUP_DIR||join(root,'backups'));
mkdirSync(folder,{recursive:true,mode:0o700});
const output=join(folder,'rescue1-'+new Date().toISOString().replaceAll(':','-').replaceAll('.','-')+'.sqlite');
const db=new DatabaseSync(dbPath);
try{
  // VACUUM INTO produces a transactionally consistent backup even in WAL mode.
  db.exec("VACUUM INTO '"+output.replaceAll("'","''")+"'");
  chmodSync(output,0o600);
  console.log('Consistent encrypted-at-rest storage is not provided by this tool. Backup created at:',output);
  console.log('Keep this backup in a private, access-controlled and encrypted backup destination.');
}finally{db.close();}
