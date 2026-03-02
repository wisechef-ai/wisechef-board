# Contributing

## Branching Model (O3DE-style)

- **`main`** — Stable, tagged releases only. Never commit directly.
- **`development`** — Active work. All feature branches merge here.
- **`stabilization/YY.MM`** — Pre-release branch cut from development when preparing a release.

## Versioning: CalVer

Format: `YY.MM.PATCH` (e.g., v26.03.0, v26.03.1)

## Workflow

1. Branch from `development` for your feature/fix
2. Test on staging (docker-01) — **never test in production**
3. PR → `development`
4. When ready for release: cut `stabilization/YY.MM` → test → merge to `main` → tag

## Daily Habit

Ship one improvement per day. Small, tested, promoted.
