# Duplicate Vercel project — `aftermath` (`aftermath-theta.vercel.app`)

**Re-verified:** 2026-11-04 via the Vercel API and by probing the live URL.
**Status:** classified as an obsolete duplicate; **not deleted or disconnected**
(this mission forbids it).

## The two projects

| | Correct production | Duplicate |
| --- | --- | --- |
| Project name | `aftermath-7tij` | `aftermath` |
| Project id | `prj_GWK9nkfkYHm269zFh7zLCjpEYiO5` | `prj_ooGX5Kq71COfGvXUdN49HbzvkgIe` |
| Alias | `aftermath-7tij.vercel.app` | `aftermath-theta.vercel.app` |
| Git repo | `itzebe/aftermath` (`master`) | `itzebe/aftermath` (`master`) |
| Latest production deployment | READY, commit `8d499fb06a` | READY, commit `7d0daff73d` |
| HTTP status | 200 | 200 |

Both projects deploy the **same repository**. The duplicate is one commit behind
only because it was observed mid-deploy; it builds from the same `master`.

## Configuration difference (why it is not the product)

| Env key | `aftermath-7tij` | `aftermath` |
| --- | --- | --- |
| `AFTERMATH_ADMIN_TOKEN` | set | set |
| `AFTERMATH_AI_VERIFY_TOKEN` | set | — |
| `AFTERMATH_PUBLIC_SUBMISSION_ENABLED` | set | — |
| `DATABASE_URL` | set | — |
| `GROQ_API_KEY` | set | — |
| `MEMWAL_ACCOUNT_ID` | set | set |
| `MEMWAL_PRIVATE_KEY` | set | — |
| `TATUM_API_KEY` | set | — |

Probing `https://aftermath-theta.vercel.app/api/config` (2026-11-04):

- `memory.backend: "simulated"`, `isLive: false` — no Walrus Mainnet write.
- `tatum.configured: false` — no on-chain verification.
- `persistence.backend: "sqlite"`, `durable: false` — per-instance `/tmp` file.
- `ai.configured: false`.

`/api/overview` on the duplicate reports every counter at **0** (0 records, 0
writes, 0 incidents). It holds **no unique data** and serves no real traffic of
consequence.

## Risk assessment

- **Security:** no secret is exposed beyond what the correct project already
  exposes; the admin token is present on both. No additional attack surface.
- **Integrity:** the duplicate presents the **simulated** backend as if it were
  the product, which could mislead a visitor who reaches `aftermath-theta`
  instead of `aftermath-7tij`. This is the main reason to retire it.
- **Cost:** a second Vercel project on the same account; negligible.

## Cleanup recommendation

Retire the duplicate, in this order, **when the owner authorises it**:

1. Confirm `aftermath-7tij` is the intended canonical project (it is: it is the
   one with the live Walrus/Tatum/Postgres configuration and all the records).
2. Remove the `aftermath-theta.vercel.app` alias, or disconnect the duplicate
   project's Git integration so it stops building on every push to `master`.
3. Optionally delete the project `prj_ooGX5Kq71COfGvXUdN49HbzvkgIe` after
   confirming no domain or external dependency points at it.

Do **not** delete it while any judge-facing material might still link to
`aftermath-theta`; no such link was found in `artifacts/`.
