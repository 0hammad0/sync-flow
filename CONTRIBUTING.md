# Contributing to SyncFlow

Thanks for your interest in improving SyncFlow! This guide covers the basics.

## Getting started

1. Fork and clone the repo.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env.local` and fill in your Firebase + Cloudflare R2
   credentials (see the [README](README.md#quick-start) for setup). The
   `OPENROUTER_API_KEY` is optional — without it the app runs fine and simply
   hides the AI features.
4. Start the dev server: `npm run dev`.

## Before opening a pull request

Please make sure the following pass locally:

```bash
npm run typecheck   # No TypeScript errors
npm run lint        # No ESLint errors
npm run build       # Production build succeeds
```

These same checks run automatically in CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) on every pull request —
lint, type check, and build must all be green before merging.

## Project layout

The codebase is organized by feature. See
[Project Structure](README.md#project-structure) in the README for the full map.
In short:

- `src/features/<feature>/` — feature-scoped components and libraries
  (`ai`, `chat`, `files`).
- `src/shared/` — cross-cutting UI (`components/`) and infrastructure (`lib/`,
  including `firebase/`).
- `src/app/` — Next.js routes only; keep route files thin and push logic into
  `features/` or `shared/`.

All imports use the `@/` path alias (`@/* → src/*`), so files are
location-independent — moving a module only requires updating the imports that
reference it.

## Conventions

- **TypeScript strict mode** is on; avoid `any` and prefer explicit types at
  module boundaries.
- **Match the surrounding style** — comment density, naming, and idioms.
  Comments should explain *why*, not *what*.
- **Server secrets stay server-side.** Never expose API keys or the Firebase
  Admin SDK to the client. The OpenRouter key is only used from `/api/ai`.
- **Never commit secrets.** `.env.local` is gitignored; keep it that way.

## Reporting bugs & requesting features

Open a GitHub issue with clear reproduction steps (for bugs) or a description of
the use case (for features). Screenshots and console/network output help a lot.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
