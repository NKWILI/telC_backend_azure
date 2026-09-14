# Phase 6b Plan: Center onboarding flow

Draft. Being assembled one agreed decision at a time with the product owner's
proposed flow (Options C + D combined) as the input.

Nothing here is implemented yet. Work starts only once every point is agreed.

## Settled: no change needed

Recorded so nobody re-opens these.

**The trial clock already starts at student activation.** The product owner's
flow says "trial begins when the student activates", which is what Phase 4
built. No change.

**"Automatically receive a 1-seat trial" is zero backend work.** The
subscription row is created inside the registration transaction, so there is
nothing to grant. A fresh center already reads `TRIAL_PENDING`, meaning trial
granted, clock not running, may add students. The product owner's step is a
screen over existing data.

## Agreed change 1: allow a draft center

**Why:** registration is to be reduced to five fields — `centerName`,
`managerFirstName`, `managerLastName`, `email`, `password`. The backend refuses
that today because three columns are NOT NULL and would have no value:

| Column | Table |
|---|---|
| `country` | `centers` |
| `city` | `centers` |
| `phone` | `center_users` (the manager) |

**Change:** one migration making those three nullable, plus the registration
DTO dropping the four fields it no longer collects.

**Risk:** low. Additive and reversible in effect — every existing center and
manager already holds a value, so there is no backfill and no row is rewritten.
Postgres treats dropping NOT NULL as a catalogue change.

**Consequence to handle elsewhere in this plan:** once these are nullable,
every read must cope with null, and something must decide what "profile
complete" means. Both are covered by later points once agreed.

## Agreed change 2: onboarding state is derived and reported

**Derived, not stored.** No `onboarding_complete` column. Completion is worked
out on read: country, city and manager phone all present.

The same decision was taken twice already in this project — subscription status
is computed from timestamps on every read rather than stored. A stored flag
needs a job or trigger to keep it true, and when that runs late the value is
wrong in the direction that grants access.

**Reported explicitly.** `GET /api/centers/me` gains one block:

```json
"onboarding": {
  "complete": false,
  "missing": ["country", "city", "phone"]
}
```

Each field has a job:

- `complete` — what the frontend redirects on. One boolean, nothing to infer.
- `missing` — what the frontend renders its checklist from, without holding a
  copy of the rules.

Complete looks like `{ "complete": true, "missing": [] }`.

**Why `missing` rather than letting the client compare fields:** a fourth
required field added later updates every checklist with no frontend change, and
the client never has a second, drifting definition of "complete". It also
satisfies the product owner's own constraint that the frontend must never
decide for itself that onboarding is done.

## Agreed change 3: one phone, the manager's

The product owner asked whether `phone` is the manager's personal number or the
center's business number. His setup payload groups it with `country`, `city`
and `logoUrl`, which are all center fields, so the question is real.

**Decided: the manager's.** `CenterUser.phone` becomes nullable and is
collected during onboarding rather than at registration. No `Center.phone`
column.

**Why:** the manager's number is who you actually contact about an account —
a late payment, a locked login, a verification that never arrived. A school's
public enquiry line is a different thing for a different purpose, and nobody
has yet said what the backend would do with it. Adding it now would mean two
phone fields where only one has a stated use, and a second field with no
consumer is a field that goes stale.

Adding `Center.phone` later is additive and cheap, so this is not a door
closing.

## Agreed change 4: logo stays optional

`logo_url` is already nullable. A center completes onboarding without one, and
it never appears in the `missing` list. No work.

## Agreed change 5: the profile gate sits on payment, not on provisioning

The founder's own notes asked for both "the user sees the product before being
asked to pay" and "block student provisioning until profile completion". Those
pull against each other: the second makes a new customer do paperwork before
seeing anything work.

Resolved by asking when each field is genuinely needed.

| Field | Needed for | Needed to run a trial |
|---|---|---|
| `phone` | Chasing money, renewals | No |
| `country` | Currency, tax, regional pricing | No — XAF only today |
| `city` | Sales and support context | No |

Provisioning a student needs the student's name and email. The welcome email
needs the center's name, which registration already collects. Starting a trial
needs nothing else. **None of the three is needed for a trial; all three are
needed to take money.**

**Decided:** profile completeness is required at payment. The trial path
requires nothing beyond registration and a verified email.

```
Register (5 fields) -> verify email -> dashboard, no subscription yet
     -> subscription page
          FREE TRIAL -> add student -> student activates -> trial starts
          PAID       -> profile check -> seats -> quote -> pay
```

Quoting stays open: looking at a price is not a commitment.

The dashboard checklist may still nudge a center to complete its profile. It
must not say "complete this to add students", because that would be a claim
the server does not keep.

**Refusal shape**, matching `requiredSeats` and `subscriptionStatus` so the
client is told what to fix rather than only that it failed:

```json
{
  "error": "CENTER_PROFILE_INCOMPLETE",
  "message": "Complete your centre information before paying.",
  "missing": ["country", "city", "phone"]
}
```

## Agreed change 6: launch price is 4,500 XAF, raised to 4,800 later

4,500 is a launch promotion to attract the first 3-10 centers. 4,800 is the
real price.

**Decided:** change the `unit_price_xaf` default from 4,800 to 4,500 now, and
change it back once those centers are signed.

**Why this needs no promotion machinery:** the price is stamped on each
center's own row at creation, and a Postgres column default only applies to
future inserts. So raising the default later leaves every existing center on
4,500 — grandfathering happens by itself. No coupon system, no expiry dates,
nothing to build or maintain.

Commercially that is also the right outcome: the first centers took a risk on
an unproven product and become the references for everyone after them, and the
difference is 300 XAF a seat.

**Consequence:** partnership codes are not needed for this. Phase 2 was going
to be that mechanism; a launch promotion does not require it.

**Work:** two one-line migrations, one now and one later.

## Agreed change 7: the dashboard is a home, not a gate

The dashboard is the center's permanent space once logged in — comparable to a
Cursor or Vercel account page. It is where they see their plan, their billing,
messages from us, and whatever they have paid for. It is not a checkpoint they
pass through once.

**Consequence for the backend: nothing changes.** `GET /subscription` and
`GET /usage` stay open, as Phase 5 left them. The dashboard needs that data to
render its own state — to say "no subscription yet" it has to be told there is
no subscription.

**Consequence for the frontend:** it owns empty states, locked cards and the
upgrade prompt. Hiding a seat count is a presentation decision, not an
authorization one.

This keeps the Phase 5 principle intact: a center that cannot see what it owes
cannot pay.

## Agreed change 8: no locations endpoint

Country and city say where a school is. Nothing in the code reads them today —
no price changes, no branching. They matter later for invoices and for knowing
the market.

Since they are collected on the payment form (agreed change 5), the country
list is a form concern. The frontend holds it; the backend refuses an invalid
country code when saving.

**Decided: no `GET /api/locations`.** An endpoint returning a fixed list is a
network round trip for data that never changes. Revisit only if country starts
driving something real, such as a second currency.

## Agreed change 9: the free trial is one seat

Trial seats drop from 3 to 1. Founder's decision.

**Work:** change the `seats` default on `center_subscriptions` from 3 to 1.
Existing centers keep whatever they hold, since a column default only applies
to future inserts.

**Consequence, already handled:** a second student attempt is refused with
`SEAT_LIMIT_REACHED`, which the existing seat logic produces without change.
Worth treating as a conversion moment rather than an error — the natural place
for the frontend to offer an upgrade.

**No conflict with paid:** the paid minimum is 10 seats, comfortably above a
one-student trial, so upgrading never trips the
`SEATS_BELOW_STUDENT_COUNT` floor.

## Agreed change 10: abandoning checkout does not cost the trial

A center that clicks Pay, completes its profile, reaches the payment page and
then leaves can still come back and take the free trial.

**Work: none.** This already holds, for two reasons already built:

- an unpaid payment record grants nothing and changes no subscription state;
- the trial clock starts at student activation, so an untouched trial stays
  available indefinitely.

Recorded because it is a product rule someone might otherwise "fix" later by
adding a one-shot flag. Abandoned checkout is the normal behaviour of a person
weighing a price, not an attempt to cheat.

## Agreed change 11: the trial is 14 days, not 30

**Work:** change `TRIAL_DURATION_DAYS` in `student-activation.service.ts` from
30 to 14. Existing trials keep the end date already written to their row.

**Why 14:** it is the common default for business tools, so it will not look
mean. More importantly the clock starts at student activation rather than at
signup, so these are 14 *active* days — worth more than a typical 30-day trial
where the first fortnight goes on forgetting to set the thing up.

A long trial with one student also creates no urgency. Schools postpone the
decision and then forget.

**The asymmetry that settles it:** extending a trial later is easy and feels
generous; shortening one feels like a takeaway. Starting at 14 leaves room to
be generous once there is real data on how long schools actually need.

## Agreed change 12: the trial starts at activation, confirmed

The founder's notes listed this as undecided. It is settled and already built:
the clock starts when a student redeems their activation key, not when the
center creates the student.

**Work: none.**

**The consequence, deliberately accepted:** a school can provision a student on
Monday, hand over the key, and lose no trial days if that student does not sign
in until the following week. The alternative would charge a school for its
student's delay.

## Agreed change 13: paid plans are tiered, and a center may mix them

This supersedes the earlier "seats only, no tiers" recommendation and revises
agreed change 6.

**The catalogue:**

| Tier | Price per student per month | Includes |
|---|---|---|
| Demo | free, 14 days | one seat |
| Start | 4,500 XAF (launch) -> 4,800 later | Speaking AI twice a day |
| Pro | 10,000 XAF | Speaking AI five times, exam module |
| Premium | 20,000 XAF | Everything in Pro, Speaking AI 20 times, AI in every module |

**A center may hold a mix.** Five Start seats, three Pro and two Premium in one
center is a valid arrangement.

**The consequence that matters most: entitlement moves from the center to the
student.** Phase 5 answers one question per center — may this center's students
learn. Tiers require a second, narrower question: what may *this* student do.
Two students in the same center, both fully paid, may now have different
answers.

That is a genuine change of shape, not a new column. Recorded here so the size
is not discovered mid-build.

**What survives unchanged:** the center/student token split, derived
subscription status, idempotent payment creation, the rule that a price never
comes from the client, and the trial/active/grace/blocked policy. None of that
is disturbed by tiers.

**Revision to agreed change 6:** the launch-price mechanism still holds, but it
now applies to the Start tier only. Start launches at 4,500 and rises to 4,800;
Pro and Premium are 10,000 and 20,000.

## Agreed change 14: how seats and prices are stored

**Tier prices are constants in code**, alongside `GRACE_PERIOD_DAYS` and
`TRIAL_DURATION_DAYS`. Not a database table: git then carries a free history of
when each price changed and why, a price change gets a review rather than an
UPDATE someone runs at night, and three tiers changing twice a year does not
justify an admin surface.

**A center's seats live in their own table**, one row per tier held, with the
price copied in at purchase:

```
center_seats
  center | tier    | quantity | unit_price_xaf
  goethe | START   |    10    |     4500
```

A table rather than three columns because a fourth tier then costs no
migration, and pricing has already changed once during planning.

**The stamped price is what gives grandfathering for free.** Raise Start to
4,800 and every existing row still says 4,500, because nothing rewrites it.

**Three layers, three questions:**

| Where | Answers |
|---|---|
| Code constant | what Start costs today |
| `center_seats` row | what this center pays |
| `payments` row | what was charged then |

Payments already snapshot their own price, so the third layer needs no work.

**Where this will need extending, known now:** annual billing needs a period on
the seat row, and mid-month tier changes need pro-rating. Pro-rating is hard in
every billing system and is a separate problem from how seats are stored.

## Agreed change 15: quotas are the product, enforced from launch

Reversed an earlier recommendation to record usage first and enforce in Phase 9.

**Why that was wrong:** 2 / 5 / 20 speaking sessions are not cost controls to be
tuned from data. They are printed on the pricing page and they are the reason
the tiers differ. If a Start student gets unlimited speaking, nobody pays
10,000 for Pro. The quota is what makes a tier worth buying, so it has to work
on the first day.

**The allowances, all per day:**

| Tier | Speaking AI per day | Also |
|---|---|---|
| Start | 2 | |
| Pro | 5 | exam module |
| Premium | 20 | AI in every module |

**Two different mechanisms inside that table:** the exam module is a feature
flag, a yes/no lookup against the student's tier. The session counts are
quotas and need counting.

**The existing records cannot do the counting.** Checked: `ExamSession` has a
nullable `student_id`, `TeilEvaluation` has a nullable `created_at`, and
speaking needs a two-table join where writing does not. Nullable ownership
means some usage cannot be attributed; a nullable timestamp means "how many
today" has no reliable answer; a different shape per module means the counting
logic drifts apart.

**So a single-purpose table**, one row per chargeable AI operation, carrying
student, kind and time. Counting is then the same query for every module.

**The numbers stay changeable.** They are code constants, so a wrong guess is a
one-line edit — and the rows show within weeks whether 2 is too stingy. The
measurement arrives as a side effect of enforcing rather than instead of it.

## Agreed change 16: only a successful AI operation counts

A usage row is written when the AI returns something usable, not when the
student presses start.

**Why:** the alternative charges a student for our own outage. A Gemini failure
would spend one of a Start student's two daily sessions and give them nothing,
and a bad afternoon on our side would cost them the whole day. Metered APIs do
not bill a 500, and neither should this.

**The trade accepted:** a student can retry a failed operation without penalty,
so a genuine fault means we pay Gemini twice for one counted session. That is
the right way round — the cost of our failure lands on us rather than on the
customer.

**Implementation consequence:** the row is written after the call returns, in
the same path that persists the result, never before it.

## Agreed change 17: the refusal is a sales moment, not an error

A student who has spent today's allowance is refused with everything the app
needs to say something useful:

```json
{
  "error": "AI_QUOTA_EXCEEDED",
  "message": "You have used today's speaking sessions.",
  "tier": "START",
  "usedToday": 2,
  "allowedToday": 2,
  "resetsAt": "2026-09-15T00:00:00+01:00"
}
```

Same principle as `requiredSeats` and `subscriptionStatus`: the client is told
what to do, not merely that it failed.

**What each field buys:** `usedToday` and `allowedToday` let the app say "2 of
2" rather than a bare refusal. `tier` is what makes the upgrade prompt specific
— a Start student can be pointed at Pro, a Premium student cannot be upsold and
should not be shown a prompt. `resetsAt` is how the student learns when they can
practise again; without it the app can only say no.

The intended message: **"you have used 2 of 2 today — back tomorrow, or ask
your school about Pro."** That sentence is the reason the fields exist.

## Agreed change 18: a rolling 24 hours, not a calendar day

"Twice per day" is implemented as "twice in any 24-hour period". Count the
student's usage rows newer than `now - 24h` and compare to their tier
allowance.

**Why not a calendar day:** it needs a timezone, and Lerniqo is not only for
Cameroon. UTC midnight is 1am in Douala and 9am in Tokyo, which splits a
student's day in an arbitrary place.

**Why not the student's own timezone:** it would have to be reported by their
device, and a student who changes that setting gets a fresh day and free
sessions. A quota that a client can reset is not a quota.

**What a rolling window buys beyond fairness:** nothing to store, nothing to
configure, and no daylight-saving arithmetic anywhere.

**It also improves the message.** `resetsAt` becomes the oldest counted session
plus 24 hours, so the app can say "your next session unlocks at 14:32" instead
of "come back tomorrow". More precise, and true everywhere on earth.

## Agreed change 19: a trial seat behaves like Start

The 14-day trial seat carries Start's allowance — two speaking sessions per
rolling 24 hours, no exam module.

**Why not something more generous:** a trial exists to show what the entry
price actually buys. A trial that feels like Premium sells Premium and delivers
Start, so every center signs up at 4,500 and is disappointed in week three.
Worse, it trains them to expect more than they pay for, and the complaint
arrives after the money.

**Consequence for the model:** the trial is not a fourth set of allowances to
maintain. It is the Start tier with a 14-day clock and one seat, which means
the quota logic has three cases rather than four.

## Agreed change 20: the center assigns the tier

When a center provisions a student it chooses which tier that student occupies,
from the seats it owns.

**Why not automatic:** a school that bought three Pro seats bought them for
three particular students — the ones sitting the exam. Filling the cheapest
seat first would hand those seats to whoever happened to register earliest, and
the school would have to undo it one student at a time. The center knows who
needs the exam module; the backend cannot.

**API consequence:** `POST /api/centers/me/students` gains a `tier` field, and
the seat check becomes per tier — a center with five Start seats all taken is
refused a sixth Start student even while it has Pro seats free. That refusal
should name the tier, so the dashboard can offer either a free Pro seat or more
Start seats.

## Agreed change 21: a student can be moved between tiers

`PATCH /api/centers/me/students/:id` accepts `tier`, allowed only when the
center holds a free seat in the target tier.

**Why it earns its place:** this is the most common thing a school will do
after buying. A Start student decides to sit the exam and needs Pro. The only
alternative today is remove-and-re-add, which works but invites mistakes on an
account that holds the student's whole history.

**No pro-rating.** The move takes effect immediately for access; the price
difference settles at the next renewal rather than being charged that day.
Pro-rating is hard in every billing system and is deliberately out of scope.

**The consequence, accepted:** a school can move a student from Start to Pro on
day two and get Pro access for most of a month at Start's price. Tolerable at
this scale — and the honest alternative is not "charge them correctly", it is
"build pro-rating", which is a project of its own.

**What still needs deciding when renewals are built:** whether a renewal
charges the tiers a center holds on the renewal date, which is the simple rule
and the one this implies.

## Agreed change 22: what each tier actually unlocks

All three tiers ship. The exam module is the line between Start and Pro.

| | Start | Pro | Premium |
|---|---|---|---|
| Per-skill practice | yes | yes | yes |
| Full exam simulation (`/api/modelltests`) | **no** | yes | yes |
| AI across every module | no | no | yes |
| Speaking AI per rolling 24h | 2 | 5 | 20 |

**Per-skill practice** is `/api/reading`, `/api/listening`, `/api/writing`,
`/api/sprachbausteine` and speaking practice. These work independently of
`/api/modelltests`, so Start is a usable product rather than a stub.

**The exam gate is `/api/modelltests`** — the full timed simulation across
Hören, Lesen, Schreiben and Sprechen, with results afterwards. Pro and Premium
only.

**Noted, not a blocker:** the standalone per-skill content is thin today and
"AI across every module" is not fully built. Pre-launch that is a content
problem rather than a commercial one, and the gates are in the right place
either way — turning Premium's AI on later is a flag, not a rebuild.

An earlier recommendation to launch with Start alone was withdrawn: it rested
on a wrong reading of the code, in which gating `/api/modelltests` would have
left Start with nothing.

## Agreed change 23: the minimum is ten seats in total, mixed freely

Ten seats across all tiers, not ten per tier. Five Start plus five Pro is a
valid purchase.

**Why not ten per tier:** a school with twelve students, two of whom are
sitting the exam, would have to buy ten Pro seats to cover those two. That is
100,000 XAF for two students, and the school would simply decline Pro. The
minimum exists to set a floor on a contract, not to make the middle tier
unreachable.

**Pricing consequence:** the floor check moves from a single seat count to the
sum across tiers. The other floor already built — seats must cover students
already provisioned — becomes per tier, since a Start student cannot sit in a
Pro seat.

## Agreed change 24: quote and payment take a tier mix

This replaces the single-seat-count shape shipped in Phase 6 rather than
extending it.

**Request:**

```json
{ "start": 5, "pro": 3, "premium": 2 }
```

**Response, itemised so the dashboard can show a real cart:**

```json
{
  "lines": [
    { "tier": "START",   "seats": 5, "unitPriceXaf": 4500,  "amountXaf": 22500 },
    { "tier": "PRO",     "seats": 3, "unitPriceXaf": 10000, "amountXaf": 30000 },
    { "tier": "PREMIUM", "seats": 2, "unitPriceXaf": 20000, "amountXaf": 40000 }
  ],
  "totalSeats": 10,
  "totalXaf": 92500
}
```

`POST /api/payments` takes the same mix.

**Why itemise rather than return a total:** a school about to spend 92,500 XAF
needs to see where the number comes from, and a total alone invites the client
to recompute the breakdown itself — which is how a second, drifting pricing
implementation gets born.

**What survives from Phase 6 untouched:** the rule that no price comes from the
client, the idempotency key and its unique index, the payload fingerprint, the
per-center rate limit, and the snapshot of prices onto the payment row. Only
the shape of the request and the response changes.

**What the payment row needs:** a per-tier breakdown rather than one
`seats`/`unit_price_xaf` pair, since a single payment now covers several tiers
at different prices.

## Agreed change 25: a trial is an ordinary seat row priced at zero

A trialling center holds a real `center_seats` row: `tier = START`,
`quantity = 1`, `unit_price_xaf = 0`. The 14-day clock stays where it is, on
`trial_started_at` / `trial_ends_at`.

**Why not special-case it:** seat counting, tier lookup and the quota check
would each need an "unless they are on trial" branch. Three branches, in three
places, all saying the same thing — and the day someone adds a fourth place
they forget one. A trial student and a paid Start student then behave
identically everywhere except the clock, which is the only thing that is
genuinely different about them.

**Where the row comes from:** created with the subscription inside the
registration transaction, so a fresh center is already holding its one trial
seat and nothing has to grant it later. This matches agreed change 2, where
"receiving the trial" was established as a screen rather than an event.

## Agreed change 26: the Phase 6 single-price columns are removed

`Center.unit_price_xaf` and `CenterSubscription.seats` are dropped. Both are
superseded by `center_seats`.

**Why remove rather than leave:** two places would each claim to know a
center's seat count, and the next person reading the code cannot tell which one
is true. A stale number that still looks authoritative is worse than no number,
because it eventually reaches a customer's invoice.

**Safe to drop:** no center is live yet, so nothing needs preserving or
migrating.

**Code that follows them out:** `PricingService` moves from a single
`unitPriceXaf`/`minSeats` pair to tier constants plus the total-seats floor,
and `CenterSubscriptionService.getUsage` counts per tier instead of against one
number.

## Agreed change 27: duplicate center names stay allowed

No unique constraint on `centers.name`. This is the current behaviour,
confirmed rather than changed.

**Why:** chains are real. One school may run branches in Douala and Yaoundé
under the same name, and both are legitimate. The name is a label, not an
identifier — the manager's email already carries uniqueness, and that is the
thing logins and support actually key on.

Blocking duplicates would mean telling an honest customer "that name is taken"
for a name that is genuinely theirs.
