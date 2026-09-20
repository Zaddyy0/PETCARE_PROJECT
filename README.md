# 🐾 Pawsitive

> Every tail deserves a happy ending.

A one-stop pet care platform: pet parents book and track care for their animals,
veterinarians run their calendars and write clinical notes, clinic admins manage
staff and clients, and super admins oversee the whole platform.

---

## Status

**Phase 3 of 5 complete** — the API is feature-complete, and the web client
has its shell, store and design system.

| Phase | Scope | State |
| ----- | ----- | ----- |
| 1 | Monorepo, shared types, models, auth primitives, middleware | ✅ Done |
| 2 | Services, controllers, 70 routes, realtime, jobs, 155 tests | ✅ Done |
| 3 | Design system, Redux + RTK Query, auth flow, app shell | ✅ Done |
| 4 | Role dashboards, pet & booking screens, realtime client | ⏳ Next |
| 5 | Deployment, CI, documentation | — |

~27,300 lines across 166 files. `npm test` runs 155 tests against a real
ephemeral MongoDB replica set — not a mock, because the guarantees this
codebase leans on (partial unique indexes, duplicate-key errors, TTL
behaviour) are database behaviours.

---

## Architecture

```
pawsitive/
├── packages/
│   └── shared/          @pawsitive/shared — the contract between both sides
│       ├── enums.ts         roles, statuses, the appointment state machine
│       ├── permissions.ts   the RBAC matrix, used to enforce AND to render
│       ├── errors.ts        stable machine-readable error codes
│       ├── constants.ts     business rules (booking windows, limits)
│       ├── types/           wire types — no credentials are representable
│       ├── schemas/         Zod contracts, shared by API validation and web forms
│       └── utils/           pure domain logic (slot generation, state machine)
│
└── apps/
    ├── api/             @pawsitive/api — Express + Mongoose + Socket.IO
    │   ├── config/          env (validated at boot), database, logger
    │   ├── models/          Mongoose schemas and indexes
    │   ├── services/        business logic — the layer that owns the rules
    │   ├── controllers/     HTTP in, HTTP out, nothing else
    │   ├── routes/          wiring plus route-level authorization
    │   ├── middleware/      auth, RBAC, validation, errors, rate limiting
    │   └── utils/           errors, responses, pagination, crypto
    │
    └── web/             @pawsitive/web — React + Redux + Tailwind + Framer Motion
        ├── styles/          design tokens (light/dark), global layer
        ├── design/          the component library — Button, Field, Card, Modal…
        ├── app/
        │   ├── api/         RTK Query — one slice per resource, tag-based cache
        │   ├── slices/      auth (token in memory), ui (theme), toast
        │   └── store.ts     store + the central error→toast middleware
        ├── components/      shell pieces — Sidebar, TopBar, NotificationBell
        ├── layouts/         authenticated shell, auth split layout
        ├── routes/          route table + capability guards
        └── features/        one folder per screen
```

The shared package has exactly one runtime dependency (Zod) and imports neither
Mongoose nor React, which is what keeps it usable from both sides.

### Roles

```
super_admin  →  every clinic, every user, impersonation, audit log
    admin    →  their clinic: manage doctors and clients, moderate, analytics
    doctor   →  their calendar, their patients, clinical records
    client   →  their pets, their bookings, their reviews
```

Authorization is two layers, and both are required:

1. **Capability** — "may this role ever do X?" Answered statically from the
   shared permission matrix, on the route.
2. **Ownership** — "may this *user* do X to *this row*?" Answered in the service,
   which has the document in hand.

A doctor holds `medical_record:write`, but only for a pet they are treating.
Layer 1 alone is never sufficient.

---

## Getting started

**Requirements:** Node ≥ 20.11, MongoDB (local or an Atlas connection string).

```bash
npm install
cp .env.example .env      # then fill in the values
npm run build:shared      # the API and web app both import the built output
npm run seed              # a clinic, 3 doctors, 3 clients, 6 pets, 10 appointments
npm run dev               # API on :5000
```

Every seeded account uses the password `Pawsitive123!`:

| Email | Role |
| ----- | ---- |
| `super@pawsitive.test` | Super admin |
| `admin@pawsitive.test` | Clinic admin |
| `neha@pawsitive.test` | Doctor (internal medicine, 30-min slots) |
| `vikram@pawsitive.test` | Doctor (surgery, 60-min slots, Mon/Wed/Fri) |
| `ananya@pawsitive.test` | Doctor (dermatology, 20-min slots, incl. Saturday) |
| `priya@pawsitive.test` | Client, 2 pets |
| `rahul@pawsitive.test` | Client, 2 pets |
| `sana@pawsitive.test` | Client, 2 pets |

The three doctors have deliberately different slot lengths and working
patterns, so the booking grid is exercised rather than merely populated.

Useful scripts:

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Both apps, together |
| `npm run dev:api` | API only |
| `npm run build` | Build everything, in dependency order |
| `npm test` | Run every workspace's tests |
| `npm run typecheck` | Typecheck without emitting |
| `npm run lint` | Lint everything |

### API surface

70 routes under `/api/v1`. Authorization sits on the route definition, so
access control can be audited by reading the route files alone.

| Prefix | What it covers |
| ------ | -------------- |
| `/auth` | Register, sign in, refresh, logout, password reset, invitations, impersonation |
| `/users` | Admin user management, role changes, suspension, self-service profile |
| `/pets` | Client pet CRUD, archive and restore |
| `/doctors` | Directory, profiles, availability rules, **bookable slot grid** |
| `/appointments` | Booking, rescheduling, the status lifecycle, calendar |
| `/medical` | Clinical records with an amendment trail, vaccinations, schedules |
| `/reviews` | Verified reviews, doctor replies, moderation, rating summaries |
| `/notifications` | Cursor-paginated feed, unread counts |
| `/analytics` | One endpoint, four role-scoped dashboards |
| `/uploads` | Pet photos and avatars via Cloudinary |

### Health endpoints

| Route | Answers |
| ----- | ------- |
| `GET /health` | Liveness — is the process responsive? |
| `GET /ready` | Readiness — can it serve a request *right now*? Checks the database. |
| `GET /metrics` | Operational summary (authenticated) |

Liveness and readiness are deliberately separate: a brief database blip should
pull an instance out of rotation, not trigger a platform-wide restart loop.

---

## Notable engineering decisions

**Double-booking is impossible, not unlikely.** Two partial unique indexes make
the database reject a clashing appointment atomically. A check-then-insert
cannot work — both requests pass the check before either writes. Proven under
real concurrency in `apps/api/tests/booking-concurrency.test.ts`: 20 parallel
bookings for one slot produce exactly one winner.

**Availability is stored as rules, not slots.** A weekly pattern plus dated
overrides, expanded on demand. Materialising a year of slots per doctor would be
millions of rows that go stale the moment anyone changes their hours. Slot
generation is a pure function in the shared package, so the picker the user sees
and the grid the server validates against are the same code.

**Passwords use `crypto.scrypt`, not bcrypt.** Pure-JS bcrypt blocks the event
loop for the whole hash, so every sign-in stalls every other request. scrypt is
in Node core (no native build step), runs on the thread pool, and is memory-hard.

**Access tokens live in memory; refresh tokens in an httpOnly cookie.** Refresh
tokens rotate on every use, and a reused token revokes its entire family — the
standard defence against a stolen token granting indefinite access.

**Error messages are never echoed from unexpected errors.** Only errors we
constructed deliberately have their text returned; everything else becomes a
generic 500 while the detail goes to the logs, correlated by request id.

**Every list endpoint is paginated, with a hard page-size cap.** An uncapped
`?limit=` is a denial of service against your own database. Feeds that grow at
the head (notifications, audit) use cursor paging instead, because offset
paging double-serves and skips rows as new items arrive mid-scroll.

**Clinical records are append-only in spirit.** A clinician may correct their
own notes freely for 24 hours; after that the record locks and further changes
append to an amendment trail with a mandatory reason, preserving the prior
text. There is no unlock route and no delete route — the value of the lock is
that the person it constrains cannot undo it.

**Authorization is enforced twice, deliberately.** The route checks capability
("may this role ever?") and the service checks ownership ("may this user, to
this row?"). Every doctor holds `medical_record:write`; only the treating
clinician may use it on a given patient, and only the authoring clinician may
amend a note. A passed route check is never treated as authorization.

**The access token never touches browser storage.** It lives in Redux, in
memory, so there is nothing at rest for an XSS payload to read. The refresh
token is an httpOnly cookie the page cannot access at all, and the app
exchanges it for a fresh access token once on boot — which is what keeps a
reload signed in. Concurrent 401s share a single refresh through a mutex in
`app/api/baseApi.ts`: without it, several expiring queries each fire their own
refresh, and because refresh tokens are single-use the server correctly reads
that as token theft and signs the user out of every device.

**Dark mode is a token swap, not a per-component audit.** Components reference
semantic tokens (`bg-surface`, `text-content-muted`) and never raw colours —
there is deliberately no `violet-500` in the Tailwind palette. The theme is
also resolved by an inline script before first paint, so dark-mode users never
see a white flash.

**The navigation is derived from the permission matrix.** `lib/nav.ts` declares
what each item needs and filters against the signed-in user's resolved
permissions, so the sidebar reshapes itself per role from the same table the
API enforces with. A `switch (role)` returning four hardcoded arrays drifts the
moment a permission changes.

**Two subtle bugs worth knowing about**, both found by running the code rather
than reading it, and both now pinned by regression tests:

- `sparse: true` on a unique index skips documents where the field is *missing*
  but **not** where it is explicitly `null`. Three fields here default to
  `null`, so the second row ever inserted collided. The symptom was memorable:
  the second user registration on a fresh database failed with "duplicate key
  on `inviteTokenHash: null`" — on a route with nothing to do with invitations.
  The fix is `partialFilterExpression: { field: { $type: 'string' } }`.
- `mongoose.set('sanitizeFilter', true)` rewrites *every* object-valued filter
  as `$eq`, including query operators we write ourselves. `{ $gt: date }`
  became `{ $eq: { $gt: date } }` and failed to cast, which broke the
  session-liveness check and therefore **every authenticated request**, while
  every unauthenticated path kept working. Zod already makes the injection it
  guards against impossible, so it is off — see `config/database.ts`.

---

## Licence

UNLICENSED — private project.
