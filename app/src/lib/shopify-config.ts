import "server-only";

export function shopifyConfig() {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const scopes = process.env.SHOPIFY_SCOPES; // e.g. "read_products,read_orders"
  const encKey = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!apiKey || !apiSecret || !scopes || !encKey || !site) return null;
  return { apiKey, apiSecret, scopes, encKey, redirectUri: new URL("/api/shopify/callback", site).toString() };
}
