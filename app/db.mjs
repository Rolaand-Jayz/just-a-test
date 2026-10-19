import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const ROLES = ['owner','admin','operations','dispatcher','sales','finance','hr','crew'];
export const RESOURCES = ['overview','leads','customers','jobs','dispatch','time','leave','expenses','invoices','reports','staff','permissions','audit'];
export const ACTIONS = ['view','create','edit','delete','assign','approve','export','manage'];
const DEFAULT = {
 owner:['*:*'],
 admin:['overview:view','leads:*','customers:*','jobs:*','dispatch:*','time:*','leave:*','expenses:*','invoices:*','reports:*','staff:view','staff:create','staff:edit','audit:view'],
 operations:['overview:view','leads:view','leads:edit','customers:view','jobs:*','dispatch:*','time:view','time:approve','leave:view','reports:view'],
 dispatcher:['overview:view','leads:view','customers:view','jobs:view','jobs:edit','jobs:assign','dispatch:view','dispatch:edit','dispatch:assign','time:view'],
 sales:['overview:view','leads:*','customers:*','jobs:view','reports:view'],
 finance:['overview:view','leads:view','customers:view','jobs:view','time:view','expenses:*','invoices:*','reports:view','reports:export'],
 hr:['overview:view','jobs:view','time:*','leave:*','staff:view','staff:create','staff:edit','reports:view'],
 crew:['overview:view','jobs:view','time:view','time:create','time:edit','leave:view','leave:create']
};
export const STATUSES = {
 leads:['new','contacted','quoted','won','lost'],
 jobs:['scheduled','in_progress','completed','cancelled'],
 leave:['pending','approved','denied'],
 expenses:['pending','approved','rejected'],
 invoices:['draft','sent','paid','void']
};

export function openDatabase(file) {
  mkdirSync(dirname(file), { recursive:true, mode:0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`
  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','admin','operations','dispatcher','sales','finance','hr','crew')),
    password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    change_password INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, last_used INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_staff_idx ON sessions(staff_id);
  CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS attempts_key_idx ON login_attempts(key,created_at);
  CREATE TABLE IF NOT EXISTS permissions (
    role TEXT NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL, allowed INTEGER NOT NULL,
    PRIMARY KEY(role,resource,action)
  );
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '', service TEXT NOT NULL DEFAULT 'residential',
    origin TEXT NOT NULL, destination TEXT NOT NULL DEFAULT '',
    requested_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new',
    source TEXT NOT NULL DEFAULT 'staff', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, lead_id TEXT REFERENCES leads(id),
    customer_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL, destination TEXT NOT NULL DEFAULT '',
    move_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled', service TEXT NOT NULL DEFAULT 'residential',
    crew_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assignments (
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    staff_id TEXT NOT NULL REFERENCES staff(id), PRIMARY KEY(job_id,staff_id)
  );
  CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff(id),
    job_id TEXT REFERENCES jobs(id), started_at TEXT NOT NULL, ended_at TEXT,
    note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff(id),
    start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    leave_type TEXT NOT NULL DEFAULT 'personal', note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT REFERENCES staff(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id), vendor TEXT NOT NULL,
    category TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
    incurred_on TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_by TEXT NOT NULL REFERENCES staff(id), created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id),
    customer_name TEXT NOT NULL, invoice_number TEXT NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), paid_cents INTEGER NOT NULL DEFAULT 0,
    due_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
    memo TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
    amount_cents INTEGER NOT NULL CHECK(amount_cents>0), method TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '', received_on TEXT NOT NULL,
    recorded_by TEXT NOT NULL REFERENCES staff(id), created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, actor_id TEXT REFERENCES staff(id),
    action TEXT NOT NULL, resource TEXT NOT NULL, record_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS leads_date_idx ON leads(created_at);
  CREATE INDEX IF NOT EXISTS jobs_date_idx ON jobs(move_date);
  CREATE INDEX IF NOT EXISTS time_staff_idx ON time_entries(staff_id);
  `);
  if (!db.prepare('SELECT 1 AS ok FROM permissions LIMIT 1').get()) {
    const insert=db.prepare('INSERT INTO permissions(role,resource,action,allowed) VALUES (?,?,?,?)');
    for(const role of ROLES) for(const resource of RESOURCES) for(const action of ACTIONS) {
      const allowed = DEFAULT[role].some(rule => {
        const parts=rule.split(':');
        return (parts[0]==='*'||parts[0]===resource)&&(parts[1]==='*'||parts[1]===action);
      });
      insert.run(role,resource,action,allowed?1:0);
    }
  }
  return db;
}
export function can(db,user,resource,action='view') {
  if(!user||!user.active||!RESOURCES.includes(resource)||!ACTIONS.includes(action)) return false;
  if(user.role==='owner') return true;
  return !!db.prepare('SELECT allowed FROM permissions WHERE role=? AND resource=? AND action=?')
    .get(user.role,resource,action)?.allowed;
}
export function permissionMap(db,user){
  const result=Object.fromEntries(RESOURCES.map(r=>[r,{}]));
  if(!user) return result;
  for(const row of db.prepare('SELECT resource,action,allowed FROM permissions WHERE role=?').all(user.role))
    result[row.resource][row.action] = user.role==='owner'||Boolean(row.allowed);
  return result;
}
export function audit(db,user,action,resource,record='',detail=''){
  db.prepare('INSERT INTO audit_log(id,actor_id,action,resource,record_id,detail,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(),user?.id||null,action,resource,String(record),String(detail).slice(0,200),new Date().toISOString());
}
