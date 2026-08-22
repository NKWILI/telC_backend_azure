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

## Migrations

`npm start` runs `prisma migrate deploy`, so any pending migration applies on
first boot after deploy. Read the migration before releasing, and confirm it is
additive. A destructive migration needs its own plan and a rollback path.
