# Security policy

## Scope

Pharmarchy is a **development demonstration**, not a production pharmacy service. Do not submit real patient data, prescription information, payment data, staff credentials, or other sensitive information to a local or preview deployment.

## Reporting a vulnerability

Please do not create a public issue containing exploit details or sensitive data. Report the issue privately to the repository owner through an agreed secure contact channel, or use GitHub private vulnerability reporting if the repository has enabled it.

Include:

- a clear description of the issue and affected component;
- reproducible steps or a minimal proof of concept;
- the potential impact; and
- any suggested mitigation.

## Supported development controls

The repository includes automated dependency auditing, static checks, tests, security headers, input validation, session token hashing, CSRF protection for staff mutations, and rate limiting. These are development safeguards only and do not satisfy the operational, clinical, privacy, identity, or compliance requirements for a live regulated-pharmacy deployment.

See [`IMPLEMENTATION_BACKLOG.md`](IMPLEMENTATION_BACKLOG.md) for mandatory launch gates.
