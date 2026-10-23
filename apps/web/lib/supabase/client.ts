import { createBrowserClient } from "@supabase/ssr";

// This client runs in the browser (used inside "use client" components/pages).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
