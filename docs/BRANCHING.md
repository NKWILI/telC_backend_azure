# Branching and release model

## The rule

`main` is what production runs. Nothing reaches it until it has been proven on
`dev` — built, unit-tested, integration-tested against real Postgres, and
exercised by hand through the Bruno collection.

```
feature/xxx ──┐
feature/yyy ──┼──▶  dev  ──────────────────────▶  main  ──▶ production
fix/zzz ──────┘   integration branch          release branch
```

## Branches

| Branch | Purpose | Who merges into it |
|---|---|---|
| `main` | Mirrors production. Every commit is deployable and has been released, or is about to be. | Only `dev`, at a release. Only `hotfix/*` directly, and only for a live incident. |
| `dev` | Integration. All phases land here and accumulate until a release is cut. May contain work that is finished but not yet shipped. | `feature/*`, `fix/*` |
| `feature/<name>` | One phase or one self-contained change. Branched from `dev`, merged back to `dev`. | — |
| `fix/<name>` | A defect found during development. Same lifecycle as a feature. | — |
| `hotfix/<name>` | A production emergency only. Branched from `main`, merged to **both** `main` and `dev` so the fix is not lost at the next release. | — |

Branch from `dev`, not from `main`. `main` lags behind during development, and
branching from it produces avoidable conflicts.

## The lifecycle of a phase

```bash
git checkout dev && git pull            # start from current integration state
git checkout -b feature/partnership-codes

# ... TDD, incremental commits ...

npm test                                # unit
npm run test:e2e                        # end to end
npm run test:integration                # real Postgres, needs .env.test
npm run build                           # must exit 0 — see the note below
npm run lint

git checkout dev
git merge --no-ff feature/partnership-codes
```

`--no-ff` keeps each phase as one revertible unit. A phase that goes wrong
comes out with a single `git revert -m 1 <merge-sha>`.

## Standing decision: one release, at the end (2026-08-23)

Nothing ships to production until the whole center-subscription initiative
works, Phase 1 through Phase 10. There is no partial rollout and no interim
deploy.

One consequence is deliberate and worth stating plainly, because it is easy to
forget once it is buried in history: **`fix: stop truncating student refresh
tokens at 72 bytes` sits on `dev`, not in production.** Until the release,
spent student refresh tokens remain valid for their full seven-day lifetime,
and replaying one raises no signal. The fix is written and tested; it is
waiting on the release train by choice.

If that calculus changes — a suspected token leak, or the release slipping
further than expected — the hotfix lane below exists to ship it on its own.

## API documentation (decided 2026-08-23)

Two different things get called "Swagger", and they are treated differently.

**Per-endpoint `@Api*` decorators are written with the endpoint, every time.**
They are not a separate document — they sit inline, cost a couple of minutes,
and are what makes `/api-docs` usable while a phase is still being built. The
frontend needs that contract during the phase, not after Phase 10. Deferring
them would mean writing dozens of bare endpoints and then reconstructing every
response shape from memory in one long pass.

**The narrative description in `main.ts` is deferred until after the last
phase.** That one genuinely is a document, it churns on every phase, and
polishing it ten times is waste. It gets one pass at the end, once the API has
stopped moving and everything has been verified end to end.

## Cutting a release

Only when every phase intended for the release is on `dev` and green:

1. Full gate on `dev`: unit, e2e, integration, build, lint — **all by exit code**
2. Manual pass through the Bruno collection against a locally running server
3. Review the diff you are about to ship: `git diff main..dev --stat`
4. Merge and tag:

```bash
git checkout main
git merge --no-ff dev -m "Release: <what is in it>"
git tag -a v<x.y.z> -m "<summary>"
git push origin main --tags
```

5. Deploy, then verify in production before walking away

## Verify builds by exit code, never by grepping output

`nest build` writes ANSI colour codes into its output, so the literal text
`error TS` never appears as a contiguous string — a `grep "error TS"` finds
nothing and reports a broken build as clean. This has already produced two
type errors that reached `main` unnoticed.

```bash
# WRONG — silently passes on a failing build
npm run build 2>&1 | grep -i "error TS"

# RIGHT
npm run build; echo "exit: $?"
```

The same applies in CI: assert on the exit status, not on stdout.

## Databases

| Environment | Database | Set in |
|---|---|---|
| Production | `neondb` | `.env` |
| Integration tests | a disposable Neon branch | `.env.test` (gitignored) |

Integration tests must use `DIRECT_URL`, the non-pooled endpoint. The `-pooler`
host is PgBouncer in transaction mode and multiplexes connections underneath
interactive transactions, so a Serializable test run through it measures the
pooler rather than Postgres. `test/jest-integration-setup.ts` refuses to run if
`DIRECT_URL` points at the production host.

Neon branches expire. Recreate one and update `.env.test` when the suite
cannot connect; nothing is lost when a branch is deleted.

## Running the API for manual testing

`.env` holds the production connection string, and NestJS reads it by default.
Variables already set in the environment take precedence, which is what keeps
manual testing off the real database.

```powershell
npm run start:testdb          # loads .env.test, serves on 3001
```

Windows PowerShell 5.1 has no `&&`, so the bash idiom
`set -a && . ./.env.test && set +a` does not work there. The script exists so
nobody has to remember that. It refuses to start if `.env.test` resolves to the
production host.

Point the Bruno collection at `http://localhost:3001`.

## Migrations

`npm start` runs `prisma migrate deploy`, so any pending migration applies on
first boot after deploy. Read the migration before releasing, and confirm it is
additive. A destructive migration needs its own plan and a rollback path.
