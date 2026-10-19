# Rescue 1 Movers — Premium Website & Command Center

A complete redesign of [rescue1movers.com](https://www.rescue1movers.com/) with a working, persistent employee operations app.

**Status:** Implementation is under review. The live Squarespace domain has **not** been modified or migrated.

## What's included

- Responsive high-impact moving company homepage with the real Rescue 1 brand, team photography and SmartMoving quotation widget.
- Five dedicated moving service pages, local SEO, real moving guide and personalized browser-local moving checklist.
- Employee Command Center at **/staff**, backed by a real SQLite database and Node.js HTTP server.
- Invite-only accounts with owner, admin, operations, dispatcher, sales, finance, HR, crew roles and persistent granular permissions.
- Leads, customers, quotations, moving jobs, crew assignments, employee time, leave, expenses, invoices, payment recording, payroll estimates, announcements, crew chat, reports, audit history.
- Real business data persistence, scrypt passwords, server-side authorization, cookie-based sessions, CSRF protection and login throttling.
- No mandatory paid dependencies for the core application.

## Start

Requires Node.js **22.16+**. Download the repository or a verified CI release artifact, extract it, and follow [DEPLOYMENT.md](DEPLOYMENT.md) to create the first owner account.

\`\`\`bash
node app/bootstrap.mjs   # Requires R1_OWNER_NAME / R1_OWNER_EMAIL / R1_OWNER_PASSWORD
npm start
\`\`\`

Public website: **http://127.0.0.1:8080/**  
Staff Command Center: **http://127.0.0.1:8080/staff**

Run \`npm test\` before publishing. Production requires HTTPS, backup/restore policies, credential management, owner acceptance testing and compliance reviews.

**Important:** Quotes and payments entered in the Command Center are records, not external transactions. Payroll reports are estimates, not payroll processing. The public SmartMoving form still submits to SmartMoving; it is not yet bidirectionally synchronized with this app. No default staff accounts exist.

## Original live-site snapshot

The earlier frontend capture is preserved separately in \`snapshot/\`, with original delivered HTML, downloaded public resources and a machine-readable [manifest](snapshot/manifest.json). It documents the pre-redesign Squarespace technology; **it is not** the application served by \`npm start\`.

## Review and license

This is a proposal for the company's approval, not an authorized replacement of its production Squarespace site. Obtain the business's permission for images/logos and a data-processing agreement before handling live employee, customer or financial information.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full architecture, setup, limitations, security and deployment handoff.
