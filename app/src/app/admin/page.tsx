import { notFound } from "next/navigation";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Admin dashboard. All reads go through the user client, so RLS (is_admin) gates the data.
export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createUserClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") notFound();

  const [conv, gen, recent, waitlist, feedback, merchants] = await Promise.all([
    supabase.from("landing_conversion_daily").select("*").limit(14),
    supabase.from("generation_stats_daily").select("*").limit(14),
    supabase.from("generations").select("id, created_at, provider, model, status, latency_ms, cost_usd, error_code, error_message").order("created_at", { ascending: false }).limit(25),
    supabase.from("waitlist_signups").select("id", { count: "exact", head: true }),
    supabase.from("feedback").select("rating"),
    supabase.from("merchants").select("id, name, plan, status, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const ratings = (feedback.data ?? []).map((r) => r.rating);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : "—";

  return (
    <div className="container-page space-y-10 py-8">
      <h1 className="text-3xl font-black tracking-tight">Admin</h1>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat k="Waitlist signups" v={waitlist.count ?? 0} />
        <Stat k="Merchants" v={merchants.data?.length ?? 0} />
        <Stat k="Feedback responses" v={ratings.length} />
        <Stat k="Avg. rating (1–5)" v={avg} />
      </dl>
      <Table title="Landing conversion (daily)" rows={conv.data ?? []} cols={["day", "visitors", "signups", "conversion_pct"]} />
      <Table title="Generations & cost (daily)" rows={gen.data ?? []} cols={["day", "provider", "attempts", "succeeded", "failed", "completion_pct", "median_latency_ms", "cost_usd", "cost_per_success_usd"]} />
      <Table title="Recent generation log" rows={recent.data ?? []} cols={["created_at", "provider", "model", "status", "latency_ms", "cost_usd", "error_code", "error_message"]} />
      <Table title="Merchants" rows={merchants.data ?? []} cols={["name", "plan", "status", "created_at"]} />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return <div className="card p-4"><dt className="text-xs text-ink-muted">{k}</dt><dd className="mt-1 text-2xl font-black tabular-nums">{v}</dd></div>;
}

function Table({ title, rows, cols }: { title: string; rows: Record<string, unknown>[]; cols: string[] }) {
  return (
    <section>
      <h2 className="eyebrow mb-3">{title}</h2>
      {rows.length === 0 ? <p className="text-ink-soft">No data yet.</p> : (
        <div className="overflow-x-auto rounded-card border border-line bg-paper-raised">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line text-ink-muted"><tr>{cols.map((c) => <th key={c} className="whitespace-nowrap p-2">{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {cols.map((c) => <td key={c} className="max-w-[280px] truncate whitespace-nowrap p-2 tabular-nums">{r[c] == null ? "—" : String(r[c])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
