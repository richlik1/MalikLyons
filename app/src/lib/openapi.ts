// OpenAPI 3.1 description of the public TrendSet API (v1). Served at /api/v1/openapi.json.
export function openApiSpec(serverUrl: string) {
  const err = { $ref: "#/components/schemas/Error" };
  const tryOn = { $ref: "#/components/schemas/TryOn" };
  return {
    openapi: "3.1.0",
    info: {
      title: "TrendSet API",
      version: "1.0.0",
      description:
        "AI virtual try-on for fashion retailers. Server-to-server API authenticated with secret keys (ts_sk_…). " +
        "For websites, use the widget with a publishable key (ts_pk_…). Previews are AI-generated images for visual reference only, not size or fit predictions. " +
        "You must have your shopper's consent to process their photo.",
    },
    servers: [{ url: serverUrl }],
    security: [{ secretKey: [] }],
    components: {
      securitySchemes: { secretKey: { type: "http", scheme: "bearer", description: "Secret key ts_sk_… — server-side only." } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } }, required: ["code", "message"] } } },
        TryOn: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" }, object: { const: "try_on" },
            status: { enum: ["pending", "succeeded", "failed", "rejected"] },
            result_url: { type: ["string", "null"], description: "Signed URL, valid for 1 hour. Fetch GET /try-ons/{id} for a fresh one." },
            result_url_expires_at: { type: ["string", "null"], format: "date-time" },
            latency_ms: { type: ["integer", "null"] }, product_id: { type: ["string", "null"] }, external_ref: { type: ["string", "null"] },
          },
        },
      },
    },
    paths: {
      "/api/v1/try-ons": {
        post: {
          summary: "Create a try-on",
          description: "Synchronous: returns when the image is ready (usually well under the 120 s request limit). Failed generations are not billed. Rate limit: 30/min per key (default).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    person_image_url: { type: "string", format: "uri", description: "Public https URL (no redirects). One of person_image_url / person_image_base64." },
                    person_image_base64: { type: "string", description: "JPEG/PNG/WebP, ≤ 8 MB, shortest side ≥ 512 px." },
                    product_id: { type: "string", format: "uuid", description: "A product in your TrendSet catalog. One of product_id / garment_image_url / garment_image_base64." },
                    garment_image_url: { type: "string", format: "uri" },
                    garment_image_base64: { type: "string" },
                    category: { enum: ["tops", "bottoms", "one-pieces"], description: "Required unless product_id is given." },
                    external_ref: { type: "string", maxLength: 200, description: "Your own reference (order, session…)." },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: tryOn } } },
            "400": { description: "Invalid request", content: { "application/json": { schema: err } } },
            "401": { description: "Missing/invalid key", content: { "application/json": { schema: err } } },
            "404": { description: "Product not found", content: { "application/json": { schema: err } } },
            "422": { description: "Image unusable or rejected by safety filter", content: { "application/json": { schema: err } } },
            "429": { description: "Rate limit or monthly allowance reached (see Retry-After)", content: { "application/json": { schema: err } } },
            "503": { description: "Generation temporarily unavailable", content: { "application/json": { schema: err } } },
          },
        },
      },
      "/api/v1/try-ons/{id}": {
        get: {
          summary: "Retrieve a try-on",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: tryOn } } }, "404": { description: "Not found", content: { "application/json": { schema: err } } } },
        },
      },
      "/api/v1/products": { get: { summary: "List your products", responses: { "200": { description: "OK" } } } },
      "/api/v1/usage": { get: { summary: "Usage and estimated charges this billing period", responses: { "200": { description: "OK" } } } },
    },
  };
}
