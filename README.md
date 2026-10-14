# SmartBRGY Admin Web

Full desktop administration portal for the SmartBRGY resident mobile app. It shares the same Supabase project but remains a separate Vite website inside the same GitHub repository.

## Run locally

Copy `.env.example` to `.env`, add the Supabase URL and publishable key, then run:

```bash
npm install
npm run dev
```

Open the local address shown by Vite, normally `http://localhost:5173`.

Only a verified Supabase account whose `public.profiles.role` is `admin` can enter. Resident accounts are rejected. Official updates, approvals, attachment review, Help Desk replies, access control, and announcement publishing belong in this web portal; the mobile admin route is monitoring-only.

The browser app uses only the Supabase publishable key with Row Level Security. Never add a service-role key here.
