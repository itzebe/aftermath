# Duplicate Vercel project — classification and cleanup recommendation

**Verified:** 2026-11-03 via the Vercel API and by fetching the live URL.
**Status:** still exists. **Not deleted, not disconnected** (mission constraint).

## The two projects

| | Correct production | Duplicate |
| --- | --- | --- |
| Project name | `aftermath-7tij` | `aftermath` |
| Project id | `prj_GWK9nkfkYHm269zFh7zLCjpEYiO5` | `prj_ooGX5Kq71COfGvXUdN49HbzvkgIe` |
| Production alias | `aftermath-7tij.vercel.app` | `aftermath-theta.vercel.app` |
| Git | `itzebe/aftermath` @ `master` | `itzebe/aftermath` @ `master` |
| Framework | Next.js | Next.js |
| Latest deployment | tracks `master` (currently `964988f`) | tracks `master` (currently `964988f`) |

Both projects deploy the same repository on every push to `master`; the
duplicate is a second, independent Vercel project, not a preview of the first.

## What the duplicate actually serves (fetched 2026-11-03)

- `GET /api/config` → `memory.backend = "simulated"`, `isLive = false`
  ("Walrus Memory credentials are not configured (`MEMWAL_PRIVATE_KEY` missing)").
- `GET /api/overview` → `memoryStatus.state = "SIMULATED_BACKEND"`,
  `reachable: false`; `counts` all zero.
- `persistence` → `sqlite` at `/tmp/aftermath/aftermath.db`, `durable: false`
  ("a per-instance temporary location").
- `publicSubmission.available = false` ("Public submission is disabled").

## Classification

**Obsolete and inert, but publicly reachable.** It holds no unique data (0
records, 0 writes), shares no configuration with production (no
`MEMWAL_PRIVATE_KEY`, no `DATABASE_URL`, no public-submission flag), and does
not receive traffic that matters. Its only real problem is presentational: a
visitor who lands on `aftermath-theta.vercel.app` sees simulated output with no
live memory, which could be mistaken for the product's true state.

## Cleanup recommendation (for the operator — not executed here)

1. Delete or rename the `aftermath` project in the Vercel dashboard (team
   `marvinsjones06-1839`), or
2. If it must be kept, disable its production alias (`aftermath-theta.vercel.app`)
   and remove its Git integration so it stops deploying, or
3. Repoint its production alias to the `aftermath-7tij` project.

Preferred: option 1. It is safe — the project has no data worth preserving and
nothing depends on its URL. This mission deliberately took no action on it.
