# PlugPlan SG

A Singapore EV charging planner built with Next.js, React, TypeScript, and Supabase. It supports driver accounts, vehicle profiles, charging recommendations, saved plan versions, community reports, and report moderation.

## Requirements

- Node.js 22.12 or later
- pnpm 11.25.0

## Run locally

1. Create a Supabase project and apply the SQL files in supabase/migrations/ in filename order. See [Supabase setup](supabase/README.md).
2. Copy the example file, then fill in the service values in credentials.env:

```powershell
Copy-Item .\credentials.env.example .\credentials.env
```

3. Install dependencies and start the development server:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). After setting up the database, create or sign in to a Driver account. Configure the Supabase Auth redirect URL for the local address if your project requires it.

For a production build, run pnpm build and then pnpm start.

## Environment variables

| Variable | Purpose |
|---|---|
| SUPABASE_URL | Supabase project URL |
| SUPABASE_PUBLISHABLE_KEY | Supabase public application key; database access is controlled by RLS |
| LTA_Datamall_API | LTA DataMall key for live station data |
| OneMap_API | OneMap token for live address and route data |

The Supabase settings are needed for accounts and saved data. The LTA and OneMap credentials are needed for live data; the application also includes explicitly labelled demo fixtures. Keep provider credentials in credentials.env, which is ignored by Git. Never commit real credentials.
