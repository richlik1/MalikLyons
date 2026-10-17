import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/openapi";

export function GET(req: Request) {
  return NextResponse.json(openApiSpec(process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin), { headers: { "Access-Control-Allow-Origin": "*" } });
}
