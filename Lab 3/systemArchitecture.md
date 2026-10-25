# PlugPlan SG — System Architecture

## 1. Architectural style

PlugPlan SG uses a **layered client–server architecture** with five responsibility areas. The server coordinates domain and integration work, while the browser also calls Supabase Auth and Storage directly and requests OneMap map tiles; this implementation therefore has explicit cross-layer service paths.

| Layer | Responsibility | Code |
|---|---|---|
| **Presentation** | Browser UI: views, forms, map, client-side state | `src/components/plugplan-app.tsx`, `journey-map.tsx`, `src/app/page.tsx` |
| **Application / Control** | Single API entry point, authentication, role gates, input validation, use-case coordination | `src/app/api/app/route.ts`, `src/lib/server/service.ts`, `supabase.ts`, `errors.ts` |
| **Domain** | Pure charging-plan calculation (feasibility, energy, cost, ranking), shared schemas, demo fixtures | `src/lib/domain/engine.ts`, `validation.ts`, `fixtures.ts`, `src/lib/types.ts` |
| **Integration / Data access** | Repositories over Supabase tables and RPCs; gateway to external government APIs with timeout and cache | `src/lib/server/db.ts`, `src/lib/server/providers.ts` |
| **Persistence / External services** | Postgres with RLS and stored procedures, Auth, private Storage; LTA DataMall; OneMap | `supabase/migrations/*.sql`; third-party HTTPS APIs |



## 2. Layered architecture diagram

```mermaid
---
config:
  layout: elk
---
flowchart TB
    subgraph Browser["Presentation - browser"]
        UI["PlugPlanApp, AuthScreen<br/>PlacePicker and JourneyMap"]
        CLIENT["ApiClient and Supabase JS client"]
    end
    subgraph Server["Application / Control - Next.js Node server"]
        API["RouteHandler and AuthGuard<br/>identity, session and role gates"]
        SERVICE["ServiceHandler<br/>validate and coordinate use cases"]
    end
    subgraph Domain["Domain - pure TypeScript"]
        ENGINE["PlanEngine<br/>feasibility, estimates, rank then fault filter"]
        SCHEMAS["ValidationSchemas and DemoFixtures"]
    end
    subgraph Integration["Integration / Data access"]
        REPO["Profile / Plan / Report / Bootstrap<br/>repository functions in db.ts"]
        PROVIDER["ProviderGateway<br/>deadline and labelled cache"]
    end
    subgraph Services["Persistence and external services"]
        AUTH["Supabase Auth"]
        DB[("PostgreSQL<br/>RLS, transactions and audit")]
        STORAGE[("Private issue-image Storage")]
        LTA["LTA DataMall<br/>station / connector snapshots"]
        OM["OneMap<br/>place search, routes and tiles"]
    end
    UI --> CLIENT
    CLIENT -->|"POST /api/app; bearer JWT"| API
    API --> SERVICE
    API --> AUTH
    API --> DB
    SERVICE --> ENGINE
    SERVICE --> SCHEMAS
    SERVICE --> REPO
    SERVICE --> PROVIDER
    REPO -->|"user JWT"| DB
    REPO -->|"authorized signed URL"| STORAGE
    PROVIDER --> LTA
    PROVIDER --> OM
    CLIENT -->|"sign-in / sign-up"| AUTH
    CLIENT -->|"owner image upload"| STORAGE
    UI -->|"map tiles"| OM
```

## 3. Deployment view

```mermaid
flowchart LR
    subgraph Client["User device"]
        BR["Web browser<br/>React SPA bundle"]
    end
    subgraph Host["Node.js host (≥ 22.12)"]
        NX["Next.js server<br/>static page + /api/app + /api/health"]
        FS[("Writable app dir<br/>.cache/ provider cache")]
        ENV["credentials.env<br/>(server-only keys)"]
    end
    subgraph Cloud["Supabase project (Tokyo)"]
        SA["Auth"]
        SP[("Postgres")]
        SS[("Storage")]
    end
    LTA["LTA DataMall API"]
    OM["OneMap API"]

    BR -- "HTTP locally; HTTPS at deployment" --> NX
    BR -- "HTTPS: sign-in / sign-up" --> SA
    BR -- "HTTPS: report image upload" --> SS
    BR -- "map tiles" --> OM
    NX --> FS
    NX --> ENV
    NX -- "HTTPS (user JWT)" --> SA & SP & SS
    NX -- "HTTPS (AccountKey)" --> LTA
    NX -- "HTTPS (token)" --> OM
```

- LTA and OneMap credentials exist only on the server. The browser receives only the Supabase URL and the public (publishable) key.
- The server never holds a Supabase service-role key. Every database call carries the end user's JWT, so database policies always apply.
- The current delivery is a local demonstration on `127.0.0.1:3000`. A production deployment needs HTTPS at the host or reverse proxy.

## 4. Request flow: create a charging plan (UC-03)

```mermaid
flowchart TB
    A["POST /api/app<br/>plan.create with input and mode"] --> B{"Authenticated active Driver?"}
    B -->|"No"| AUTHERR["401 / 403; nothing saved"]
    B -->|"Yes"| C["Validate saved profile and journey inputs;<br/>load active verified fault evidence"]
    C -->|"Invalid input / missing profile"| VALIDERR["400 with field errors"]
    C -->|"Valid"| MODE{"Data mode"}
    MODE -->|"Demo Fixture"| DEMO["Create labelled synthetic scenario"]
    MODE -->|"Live"| LIVE["Obtain usable LTA snapshot<br/>and OneMap direct / via-station routes"]
    LIVE -->|"No usable provider evidence"| PROVIDERERR["503 / 504; retain draft"]
    DEMO --> CALC["calculatePlan()<br/>feasibility, estimates, ranking,<br/>verified-fault filter, top three"]
    LIVE --> CALC
    CALC --> SAVE["save_plan_version(CREATE)<br/>atomically save plan and version 1"]
    SAVE --> RETURN["rememberRoutes(); return saved plan<br/>D-03 results and JourneyMap"]
```

For UC-03 plan creation, an LTA cache fallback does not skip OneMap: the route lookup must succeed before the plan is saved. Existing-plan refresh has a separate recovery path that may reuse a recent saved route after a provider failure and labels the result with a warning.





