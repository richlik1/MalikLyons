// Public developer reference (quick start). Full machine-readable spec: /api/v1/openapi.json
export default function DevelopersPage() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://YOUR-TRENDSET-HOST";
  const Code = ({ children }: { children: string }) => <pre className="overflow-x-auto rounded-xl bg-paper-sunken p-4 text-xs leading-relaxed">{children}</pre>;
  return (
    <article className="container-page max-w-3xl space-y-8 py-12">
      <header>
        <p className="eyebrow">Developers</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">TrendSet API</h1>
        <p className="mt-3 text-ink-soft">Add AI virtual try-on to any store. Two ways to integrate: a two-line website widget, or a REST API for your own apps.</p>
        <p className="notice mt-4">Previews are AI-generated images for visual reference only. They are not size or fit predictions. You must have your shopper&apos;s consent to process their photo.</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">1 · Website widget (no backend needed)</h2>
        <p className="text-ink-soft">Create a <strong>publishable key</strong> in Studio → Website widget &amp; API keys, listing your site&apos;s address. Then paste on your product page:</p>
        <Code>{`<script src="${base}/widget.js" data-key="ts_pk_…" defer></script>
<button data-trendset-product="PRODUCT_ID">See it on you</button>`}</Code>
        <p className="text-sm text-ink-muted">Clicking opens the try-on for that product in a new window. Shoppers don&apos;t need an account; their photos are private and auto-deleted.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">2 · REST API (server-to-server)</h2>
        <p className="text-ink-soft">Use a <strong>secret key</strong> from your server only. Requests from browsers with a secret key are rejected.</p>
        <Code>{`curl -X POST ${base}/api/v1/try-ons \\
  -H "Authorization: Bearer ts_sk_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "person_image_url": "https://cdn.yourstore.com/uploads/shopper.jpg",
    "product_id": "PRODUCT_ID",
    "external_ref": "session_123"
  }'`}</Code>
        <Code>{`201 Created
{
  "id": "6f1c…", "object": "try_on", "status": "succeeded",
  "result_url": "https://…/signed…", "result_url_expires_at": "…",
  "latency_ms": 9800, "product_id": "PRODUCT_ID", "external_ref": "session_123"
}`}</Code>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Instead of <code>product_id</code>, send <code>garment_image_url</code> or <code>garment_image_base64</code> plus <code>category</code> (<code>tops</code>, <code>bottoms</code>, <code>one-pieces</code>).</li>
          <li>Images: JPEG/PNG/WebP, ≤ 8 MB, public https URLs without redirects, or base64. Person photo shortest side ≥ 512 px.</li>
          <li><code>GET /api/v1/try-ons/:id</code> returns a fresh result URL (valid 1 hour). Results are deleted after 30 days.</li>
          <li><code>GET /api/v1/products</code> · <code>GET /api/v1/usage</code></li>
          <li>Errors: <code>{`{"error":{"code","message"}}`}</code>. 429 means the rate limit (30/min per key) or monthly allowance was reached; respect <code>Retry-After</code>. Failed generations are not billed.</li>
        </ul>
        <p className="text-sm">Machine-readable spec: <a className="underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a></p>
      </section>
    </article>
  );
}
