import { NextResponse } from "next/server";
import { attributionFromOrder, isValidShopDomain, verifyWebhook } from "@/lib/shopify";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// All Shopify webhooks, including the mandatory privacy (compliance) topics.
// Verify the HMAC over the raw body FIRST; respond 401 on failure.
export async function POST(req: Request) {
  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256"), secret)) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = req.headers.get("x-shopify-shop-domain")?.toLowerCase() ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? "";
  if (!isValidShopDomain(shop) || !webhookId) return NextResponse.json({ error: "bad_headers" }, { status: 400 });

  const svc = createAdminClient();
  // Idempotency: Shopify retries deliveries; process each webhook id once.
  const { error: dupErr } = await svc.from("shopify_webhook_deliveries").insert({ webhook_id: webhookId, topic, shop_domain: shop });
  if (dupErr?.code === "23505") return new NextResponse(null, { status: 200 });

  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch {}
  let error: string | null = null;
  try {
    switch (topic) {
      case "app/uninstalled":
        await svc.from("shopify_installations").update({ uninstalled_at: new Date().toISOString(), access_token_ciphertext: null, updated_at: new Date().toISOString() }).eq("shop_domain", shop);
        break;
      case "orders/create":
      case "orders/paid": {
        const a = attributionFromOrder(payload);
        if (!a) break;
        const { data: inst } = await svc.from("shopify_installations").select("merchant_id").eq("shop_domain", shop).is("uninstalled_at", null).maybeSingle();
        const { data: exp } = await svc.from("experiments").select("id, merchant_id").eq("id", a.experimentId).maybeSingle();
        if (!inst || !exp || exp.merchant_id !== inst.merchant_id) break; // never attribute across tenants
        const { data: asg } = await svc.from("experiment_assignments").select("arm").eq("experiment_id", exp.id).eq("visitor_id", a.visitorId).maybeSingle();
        if (!asg) break;
        const ins = await svc.from("experiment_events").insert({
          experiment_id: exp.id, visitor_id: a.visitorId, arm: asg.arm, event: "purchase", value_cents: a.valueCents, external_order_id: a.orderId, source: "shopify_webhook",
        });
        if (ins.error && ins.error.code !== "23505") throw ins.error;
        break;
      }
      case "customers/data_request":
        // TrendSet stores no Shopify customer records (orders are reduced to an anonymous visitor
        // id, order id and total). Nothing to export; logged for the compliance audit trail.
        break;
      case "customers/redact":
        // No customer-keyed data is stored. Experiment purchase events hold only order id/total.
        break;
      case "shop/redact":
        // 48h after uninstall: remove everything tied to the shop domain.
        await svc.from("shopify_installations").delete().eq("shop_domain", shop);
        await svc.from("shopify_oauth_states").delete().eq("shop_domain", shop);
        break;
      default:
        break;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error("[shopify] webhook failed", topic, error);
  }
  await svc.from("shopify_webhook_deliveries").update({ processed_at: new Date().toISOString(), error }).eq("webhook_id", webhookId);
  // Return 5xx on processing errors so Shopify retries (the dedupe row is removed to allow it).
  if (error) {
    await svc.from("shopify_webhook_deliveries").delete().eq("webhook_id", webhookId);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  return new NextResponse(null, { status: 200 });
}
