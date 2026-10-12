import { AccountActions, DeletePhotoButton } from "@/components/AccountActions";
import { createUserClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createUserClient();
  const [{ data: photos }, { data: looks }] = await Promise.all([
    supabase.from("person_photos").select("id, storage_path, created_at, expires_at").order("created_at", { ascending: false }),
    supabase
      .from("generations")
      .select("id, result_path, created_at, products(name, purchase_url)")
      .eq("saved", true)
      .not("result_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const signedLooks = await Promise.all(
    (looks ?? []).map(async (l) => ({
      ...l,
      url: (await supabase.storage.from("tryon-results").createSignedUrl(l.result_path!, 600)).data?.signedUrl,
      product: l.products as unknown as { name: string; purchase_url: string } | null,
    })),
  );

  return (
    <div className="container-page space-y-10 py-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Account</h1>
        <p className="mt-1 text-ink-soft">{user.email}</p>
      </div>

      <section>
        <h2 className="eyebrow">Saved looks</h2>
        {signedLooks.length === 0 ? (
          <p className="mt-3 text-ink-soft">No saved looks yet.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {signedLooks.map((l) => (
              <li key={l.id} className="card p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {l.url && <img src={l.url} alt={`Saved look: ${l.product?.name ?? "item"}`} className="w-full rounded-lg" />}
                <p className="mt-2 truncate text-sm font-semibold">{l.product?.name}</p>
                {l.product && <a className="text-sm underline" href={l.product.purchase_url} target="_blank" rel="noopener noreferrer">Shop ↗</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="eyebrow">Your photos</h2>
        {(photos ?? []).length === 0 ? (
          <p className="mt-3 text-ink-soft">No photos stored.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-paper-raised">
            {photos!.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <span>Uploaded {new Date(p.created_at).toLocaleDateString()} · auto-deletes {new Date(p.expires_at).toLocaleDateString()}</span>
                <DeletePhotoButton id={p.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <AccountActions />
    </div>
  );
}
