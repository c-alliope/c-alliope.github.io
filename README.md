# cal.dev

Portfolio for cal / calliope — resume, works, log. Black `#060607` / blood `#c8102e` / bone `#e8e0d0`.
Astro static site, hosted free on GitHub Pages. Full design spec: `~/projects/cal-dev-specs.md`.

## Commands

| Command       | Action                        |
| ------------- | ----------------------------- |
| `npm install` | Install dependencies          |
| `npm run dev` | Local dev at `localhost:4321` |
| `npm run build` | Static build to `./dist/`   |

## Edit content (no HTML needed)

| File                          | Controls              |
| ----------------------------- | --------------------- |
| `src/data/projects.json`      | Works gallery cards   |
| `src/data/resume.json`        | Resume page           |
| `src/content/blog/*.md`       | Blog — one file = one post |
| `src/pages/library.astro`     | calliope red UI kit   |

## Structure

```
src/
  pages/        index (landing) · projects · resume · blog · library
  layouts/      Base.astro — header, footer, absorb transition, cursor
  components/   SpineConnector · ThornField (off landing)
  data/         projects.json · resume.json
  content/blog/ markdown posts
  styles/       global.css — tokens, ridge/CRT/float/scrollbar
.github/workflows/deploy.yml   pushes dist/ to Pages on every main push
```

## Deploy

Push to `main` → Actions builds → serves at `https://c-alliope.github.io`.
Custom domain (`calliope.red`): add `CNAME`, set `site:` in `astro.config.mjs`, point DNS at Pages.
