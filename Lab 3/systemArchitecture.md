# PlugPlan SG — System Architecture

## 1. Architectural style

PlugPlan SG uses a **layered client–server architecture** with five layers. Each layer calls only the layer below it.

| Layer | Responsibility | Code |
|---|---|---|
| **Presentation** | Browser UI: views, forms, map, client-side state | `src/components/plugplan-app.tsx`, `journey-map.tsx`, `src/app/page.tsx` |
| **Application / Control** | Single API entry point, authentication, role gates, input validation, use-case coordination | `src/app/api/app/route.ts`, `src/lib/server/service.ts`, `supabase.ts`, `errors.ts` |
| **Domain** | Pure charging-plan calculation (feasibility, energy, cost, ranking), shared schemas, demo fixtures | `src/lib/domain/engine.ts`, `validation.ts`, `fixtures.ts`, `src/lib/types.ts` |
| **Integration / Data access** | Repositories over Supabase tables and RPCs; gateway to external government APIs with timeout and cache | `src/lib/server/db.ts`, `src/lib/server/providers.ts` |
| **Persistence / External services** | Postgres with RLS and stored procedures, Auth, private Storage; LTA DataMall; OneMap | `supabase/migrations/*.sql`; third-party HTTPS APIs |



## 2. Layered architecture diagram

```mermaid
flowchart TB
    subgraph P["Presentation layer (browser)"]
        direction LR
        UI["PlugPlanApp<br/>views: plan · vehicle · saved · results<br/>compare · reports · moderator"]
        AUTHUI["AuthScreen"]
        MAP["JourneyMap<br/>(Leaflet + OneMap tiles)"]
        PICK["PlacePicker"]
        APIC["ApiClient<br/>api(action, payload)"]
        SBC["Supabase JS client<br/>(Auth session, Storage upload)"]
    end

    subgraph A["Application / Control layer (Next.js route handler, Node.js runtime)"]
        direction LR
        RH["RouteHandler<br/>POST /api/app<br/>JSON + 1 MiB limit"]
        AG["AuthGuard<br/>requireUser / requireDriver / requireModerator"]
        SH["ServiceHandler<br/>handleAction(): action dispatch"]
        EM["ErrorMapper<br/>ApiError → HTTP status"]
        RC["RouteCache<br/>(in-memory, 5–10 min TTL)"]
        HC["GET /api/health"]
    end

    subgraph D["Domain layer (pure, no I/O)"]
        direction LR
        PE["PlanEngine<br/>calculatePlan()"]
        VS["ValidationSchemas<br/>(zod)"]
        DF["DemoFixtures"]
    end

    subgraph I["Integration / Data-access layer"]
        direction LR
        PR["PlanRepository"]
        RR["ReportRepository"]
        BR["BootstrapRepository"]
        PG["ProviderGateway<br/>Deadline ≈ 3.9 s"]
        PC["ProviderCache<br/>.cache/lta-public.json"]
    end

    subgraph S["Persistence & external services"]
        direction LR
        DB[("Supabase Postgres<br/>tables + RLS + RPCs")]
        AUTH["Supabase Auth<br/>(email/password, OAuth PKCE)"]
        ST[("Supabase Storage<br/>private bucket issue-images")]
        LTA["LTA DataMall<br/>EVCBatch · EVChargingPoints"]
        OM["OneMap<br/>search · routing · map tiles"]
    end

    %% invisible links keep the five layers stacked top to bottom
    P ~~~ A
    A ~~~ D
    D ~~~ I
    I ~~~ S

    UI --> AUTHUI & MAP & PICK
    UI --> APIC
    AUTHUI --> SBC
    UI -- "report image upload" --> SBC
    APIC -- "HTTPS POST + Bearer JWT" --> RH

    RH --> AG
    RH --> SH
    RH --> EM
    SH --> RC
    SH --> PE & VS & DF
    SH --> PR & RR & BR
    SH --> PG
    AG -- "getUser · is_current_session_active · app_users" --> DB

    PG --> PC
    PG --> LTA
    PG --> OM
    PR & RR & BR -- "user JWT, RLS applies" --> DB
    RR -- "signed URL" --> ST

    SBC --> AUTH
    SBC --> ST
    MAP -- "tiles" --> OM
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

    BR -- "HTTPS" --> NX
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
flowchart TD
    A["Driver clicks 'Find charging options'"] --> B["ApiClient: POST /api/app<br/>{action: 'plan.create', input, mode}"]
    B --> C{"AuthGuard<br/>valid JWT, active session,<br/>active DRIVER?"}
    C -- no --> X1["401 / 403 via ErrorMapper"]
    C -- yes --> D{"ValidationSchemas<br/>planInputSchema + saved profile"}
    D -- invalid --> X2["400 with field errors"]
    D -- valid --> E["ReportRepository.getActiveFaults()"]
    E --> F{"mode?"}
    F -- DEMO_FIXTURE --> G["DemoFixtures.createDemoScenario()"]
    F -- LIVE --> H["ProviderGateway.getLiveSnapshot()<br/>LTA batch → nearby postals → connector details"]
    H --> I["ProviderGateway.getRoutes()<br/>OneMap direct + via-station routes"]
    H -- "provider failure" --> H2{"cached snapshot?"}
    H2 -- yes --> I2["mark STALE, reuse cached data"]
    H2 -- no --> X3["503 / 504, nothing saved"]
    G --> J
    I --> J
    I2 --> J
    J["PlanEngine.calculatePlan()<br/>feasibility → energy/time/cost → strategy ranking<br/>→ exclude verified faults → top 3"]
    J --> K["PlanRepository.savePlanVersion()<br/>RPC save_plan_version (CREATE)"]
    K --> L["RouteCache.remember()"]
    L --> M["200 {plan} → results view + JourneyMap"]
```


