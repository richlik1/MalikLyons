import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { png } from "../fixtures";

export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const configured = Boolean(URL_ && ANON && SERVICE);

export const admin = () =>
  createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/** Creates a confirmed user through the real Auth API and returns a client signed in as them. */
export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@trendset.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, email, client };
}

export async function deleteUser(u: TestUser | undefined) {
  if (u) await admin().auth.admin.deleteUser(u.id);
}

export const tinyPng = () => {
  // Valid PNG header + IHDR is enough for storage (it does not decode the image).
  return new Blob([png(600, 800)], { type: "image/png" });
};
