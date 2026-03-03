# Care Import

A lightweight plug-in app used to test and demo CSV-based import flows with
[care_fe](https://github.com/ohcnetwork/care_fe).

## What's included

- **Users import** (create users from CSV)
- **Departments import** (multi-level parent/child hierarchy)
- **Link users to departments** (role + department mapping)
- **Charge item definitions import**
- **Location import**
- **Product knowledge import**
- **Specimen definition import**

These screens live under `src/components/pages` and are wired via `src/routes.tsx`.

## Scripts

```bash
npm run start   # builds and serves preview on port 5273
npm run build   # production build
npm run preview # preview the build
```

## Tech stack

- Vite + React
- Tailwind CSS
- TanStack Query
- shadcn/ui components
