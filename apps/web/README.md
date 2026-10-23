# Fantasy Draft Labs — Phase 1

This is Phase 1: sign up / log in, and connect a Sleeper league.

See the setup steps in your chat with Claude — this README is just a
reference. Short version:

1. Upload this whole folder to a new GitHub repo.
2. Import the repo in Vercel.
3. Create a Supabase project, run `supabase-schema.sql` in its SQL Editor.
4. Copy your Supabase URL + anon key into Vercel's Environment Variables
   (see `.env.local.example` for the variable names).
5. Redeploy in Vercel.
