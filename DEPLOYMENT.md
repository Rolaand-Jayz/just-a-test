# Rescue 1 Movers — deployment and operations

This is a **working server application**, not a Figma prototype or browser-only simulation. The public marketing website and its staff Command Center run together on Node.js and SQLite. No paid SaaS account or package installation is required for the core operations system.

## Quick start (local)

Prerequisites: Node.js **22.16 or newer** (22 LTS line), macOS, Windows or Linux, and a terminal.

1. Download the GitHub repository ZIP or the CI deployable artifact, then extract the application to a private folder. Do not host this directory with an unfiltered static server.
2. Open a terminal **inside that folder** and set three environment variables for the first company owner:
   - R1_OWNER_NAME (the owner's display name)
   - R1_OWNER_EMAIL (their work email address)
   - R1_OWNER_PASSWORD (a strong password of at least 12 characters)
3. Run \`node app/bootstrap.mjs\`. The command refuses to create a second initial owner if employees already exist.
4. Run \`node app/server.mjs\`.
5. Open **http://127.0.0.1:8080/** for the public website and **http://127.0.0.1:8080/staff** for employee sign-in.

Example for Linux/macOS shells (substitute your own credentials; avoid pasting passwords into shared terminals or recording them in shell history):

\`\`\`bash
read -r -p 'Owner name: ' R1_OWNER_NAME
read -r -p 'Owner email: ' R1_OWNER_EMAIL
read -rs -p 'Choose initial owner password: ' R1_OWNER_PASSWORD
echo
export R1_OWNER_NAME R1_OWNER_EMAIL R1_OWNER_PASSWORD
node app/bootstrap.mjs
unset R1_OWNER_PASSWORD
node app/server.mjs
\`\`\`

For PowerShell, set environment variables with \`$env:R1_OWNER_NAME='...'\`, \`$env:R1_OWNER_EMAIL='...'\`, and \`$env:R1_OWNER_PASSWORD='...'\`, run bootstrap, and remove the password variable afterward.

The app listens on 127.0.0.1:8080 by default. Set \`PORT\` to override the port. Set \`R1_DB_PATH\` to an **absolute path** in a writable, private directory to store your SQLite database elsewhere. Data defaults to \`var/rescue1.sqlite\`. The \`var/\` and \`backups/\` folders are ignored by Git.

## Production deployment: required controls

Do **not** expose the Node process directly to the Internet or run an employee system over plain HTTP.

- Run Node under a supervised process manager (systemd, Windows service wrapper, container orchestrator).
- Configure a HTTPS-terminating reverse proxy such as Caddy or Nginx, with a trusted certificate, forwarding the original \`Host\` header. Use \`NODE_ENV=production\` so cookies are \`Secure\` and HTTP Strict Transport Security is enabled.
- Expose **only** the reverse proxy publicly. Keep the Node listener on 127.0.0.1 and the database outside any public document directory.
- Use a dedicated restricted OS account, restrictive filesystem permissions, automatic security updates and a firewall.
- Change initial credentials, invite employees individually and deactivate employees immediately on departure.
- Set up encrypted off-host backup retention and a tested restore procedure.
- Add monitoring, alerting, immutable/off-host audit retention, regular penetration testing, and a privacy/retention policy before using real customer or employee records.
- Perform a business-owner acceptance test and validate any legal, labor, payroll and data-protection obligations before production launch. This reference application has **not** undergone an external security audit.
- Authentication uses scrypt-hashed passwords, random server-side sessions, HttpOnly/SameSite cookies, CSRF tokens, request limits, persisted permissions, and an audit trail. It does **not** yet support MFA, enterprise SSO, password-recovery email or encrypted-at-rest databases. Do not call it enterprise-ready without addressing those gaps.

## Business functionality

| Area | Working functionality | Notes |
|---|---|---|
| Public website | Responsive multi-page marketing, moving guide, estimate embed, moving checklist, SEO metadata | Actual SmartMoving form remains with SmartMoving |
| Employee access | Unique invite-only accounts, role assignment, temporary password rotation, deactivation, logout | First owner initialized locally |
| Roles | Owner, admin, operations, dispatcher, sales, finance, HR and crew; owner-editable permission matrix | Authorization checked **on every request** |
| Leads/customers | Create, read and edit customer/contact/moving inquiry records | Manually entered; no automatic SmartMoving sync |
| Quotes | Create, update and track proposed quote amounts and stages | **Not** sent by email or automatically signed |
| Jobs/dispatch | Create jobs, assign and reassign crews, update job status, see scheduled work | Crew job access is scoped to assignments |
| Timekeeping | Employee time entries, approvals and statuses | Not a certified labor compliance product |
| Leave | Employee requests, HR approvals and records | No leave accrual engine |
| Expenses | Record and review operational spending | Not a bank or card integration |
| Invoices/payments | Create invoices, update statuses, record payments already received, track unpaid balance | Does not charge cards or transmit invoices |
| Payroll review | Configure hourly rates; estimate gross compensation from approved completed time | Does not calculate taxes, overtime, benefits, net pay or disburse wages |
| Announcements/chat | Persistent company announcements and internal crew chat | Chat uses periodic refresh, not real-time push or end-to-end encryption |
| Reporting/audit | Operational summaries, permission changes and business-action history | SQLite-based, requires external audit retention |

**Data import:** No legacy Squarespace or SmartMoving records are automatically imported. Obtain authorization, export the company records, and plan a reviewed import/mapping before replacing the existing back-office workflow.

**Legal/business verification:** Service descriptions, team images, physical address, phone number, insurance claims, and review quotes should be verified with the owner before the public redesign goes live.

## Run tests

\`\`\`bash
npm test
\`\`\`

The test suite exercises the actual local HTTP server and SQLite schema. The GitHub Actions \`Rescue 1 — build and security checks\` workflow runs syntax and automated tests and generates a \`rescue1-movers-deployable.tar.gz\` artifact from a passing branch/PR.

## Back up

\`\`\`bash
node scripts/backup.mjs
\`\`\`

The script uses SQLite \`VACUUM INTO\` to create a transactionally consistent SQLite backup. Move backups to restricted, encrypted off-host storage; verify restorations on a separate instance. Configure \`R1_BACKUP_DIR\` for the local output folder.

## Important architecture boundaries

- **Squarespace**: the public site was rebuilt into normal HTML/CSS/JS; it is not a Squarespace editable theme. Switching the domain requires a separately approved deployment/migration.
- **SmartMoving**: the embed is retained, but SmartMoving accounts and CRM data are external. This application cannot read customer quote submissions from SmartMoving without an approved integration/API and business credentials.
- **Private repository**: the original public Squarespace snapshot may contain assets not licensed for redistribution. Confirm that the employer approves the public repository before using site photos/logos outside their current license.
- **Multi-site hosting**: run this as a Node app. GitHub Pages and generic static-only hosting cannot operate the auth, employee permissions, or SQLite modules.
- **Payroll**: treat calculated figures as planning estimates. Have a qualified payroll provider handle all official payroll, reporting and compliance.

## Architecture

\`\`\`text
index.html, styles.css, script.js, services/, moving-guide.html
  Public marketing and interactive moving planner
app/ui/index.html, style.css, app.js
  Employee portal; no private data stored in HTML
app/server.mjs
  HTTP server, secure cookie sessions, CSRF enforcement, static allowlist
app/auth.mjs
  Scrypt passwords, session lifecycle, login throttling, validation
app/api.mjs
  Authenticated business API, record-scoped access, business workflows
app/db.mjs
  Database schema, persisted RBAC rules, audit trail
app/bootstrap.mjs
  One-time creation of initial owner
scripts/backup.mjs
  Consistent database backup
tests/
  Website integrity and HTTP/database integration checks
var/
  Local SQLite database (never commit)
\`\`\`

Staff portal: \`/staff\`. Website: \`/\`. REST endpoints: \`/api/\`.

### Non-goals of this first deployable edition

Do not represent it as a fully integrated SmartMoving CRM, a payment processor, a compliant payroll provider, a tax system, or a legally certified HR system. Those systems require approved vendor APIs, third-party security work and legal/accounting validation. The local records, permission checks, calculation/reporting, chat, and staff workflows above are real.
