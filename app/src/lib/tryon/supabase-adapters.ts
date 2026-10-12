import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlobStore, GenerationPatch, NewGeneration, PhotoRecord, ProductRecord, TryOnRepo } from "./service";
import type { UsageSnapshot } from "../limits";

export class SupabaseTryOnRepo implements TryOnRepo {
  constructor(private readonly admin: SupabaseClient) {}

  async getPhoto(userId: string, photoId: string): Promise<PhotoRecord | null> {
    const { data, error } = await this.admin
      .from("person_photos")
      .select("id, storage_path, mime_type, expires_at, deleted_at")
      .eq("id", photoId)
      .eq("user_id", userId) // ownership enforced explicitly because this client bypasses RLS
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      storagePath: data.storage_path,
      mimeType: data.mime_type,
      expiresAt: new Date(data.expires_at),
      deletedAt: data.deleted_at ? new Date(data.deleted_at) : null,
    };
  }

  async getProduct(productId: string): Promise<ProductRecord | null> {
    const { data, error } = await this.admin
      .from("products")
      .select("id, merchant_id, name, category, image_path, purchase_url, is_active")
      .eq("id", productId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      merchantId: data.merchant_id,
      name: data.name,
      category: data.category,
      imagePath: data.image_path,
      purchaseUrl: data.purchase_url,
      isActive: data.is_active,
    };
  }

  async getUsage(userId: string, merchantId: string, now: Date): Promise<UsageSnapshot> {
    const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
    const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
    const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

    const countSince = async (since: string) => {
      const { count, error } = await this.admin
        .from("generations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("status", "failed") // provider failures don't count against the shopper
        .gte("created_at", since);
      if (error) throw error;
      return count ?? 0;
    };

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const [userLastMinute, userLastDay, spend, merchant, merchantUsed] = await Promise.all([
      countSince(minuteAgo),
      countSince(dayAgo),
      this.admin.from("generations").select("cost_usd").gte("created_at", utcMidnight),
      this.admin
        .from("merchants")
        .select("status, monthly_generation_quota, plans(included_generations, hard_cap)")
        .eq("id", merchantId)
        .maybeSingle(),
      this.admin
        .from("generations")
        .select("id", { count: "exact", head: true })
        .eq("merchant_id", merchantId)
        .in("status", ["pending", "succeeded"])
        .gte("created_at", monthStart),
    ]);
    if (spend.error) throw spend.error;
    if (merchant.error) throw merchant.error;
    if (merchantUsed.error) throw merchantUsed.error;
    const globalSpendTodayUsd = (spend.data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
    const plan = merchant.data?.plans as unknown as { included_generations: number; hard_cap: boolean } | null;
    return {
      userLastMinute,
      userLastDay,
      globalSpendTodayUsd,
      merchant: merchant.data
        ? {
            used: merchantUsed.count ?? 0,
            included: merchant.data.monthly_generation_quota ?? plan?.included_generations ?? 0,
            hardCap: plan?.hard_cap ?? true,
            status: merchant.data.status === "suspended" ? "suspended" : "active",
          }
        : undefined,
    };
  }

  async createGeneration(row: NewGeneration): Promise<string> {
    const { data, error } = await this.admin
      .from("generations")
      .insert({
        user_id: row.userId,
        merchant_id: row.merchantId,
        product_id: row.productId,
        person_photo_id: row.personPhotoId,
        provider: row.provider,
        model: row.model,
        status: "pending",
        cost_usd: row.reservedCostUsd,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async recordUsage(row: { merchantId: string; generationId: string; unitCostUsd: number; billingPeriod: string }): Promise<void> {
    const { error } = await this.admin.from("usage_events").upsert(
      { merchant_id: row.merchantId, generation_id: row.generationId, unit_cost_usd: row.unitCostUsd, billing_period: row.billingPeriod },
      { onConflict: "generation_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  async completeGeneration(id: string, patch: GenerationPatch): Promise<void> {
    const { error } = await this.admin
      .from("generations")
      .update({
        status: patch.status,
        result_path: patch.resultPath ?? null,
        latency_ms: patch.latencyMs,
        cost_usd: patch.costUsd,
        error_code: patch.errorCode ?? null,
        error_message: patch.errorMessage ?? null,
        provider_job_id: patch.providerJobId ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }
}

export class SupabaseBlobStore implements BlobStore {
  constructor(private readonly admin: SupabaseClient) {}

  async download(bucket: string, path: string) {
    const { data, error } = await this.admin.storage.from(bucket).download(path);
    if (error || !data) throw new Error(`storage download failed: ${bucket}/${path}: ${error?.message}`);
    return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType: data.type || "image/jpeg" };
  }

  async upload(bucket: string, path: string, bytes: Uint8Array, mimeType: string) {
    const { error } = await this.admin.storage.from(bucket).upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }

  async signedUrl(bucket: string, path: string, expiresInSeconds: number) {
    const { data, error } = await this.admin.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`signed url failed: ${error?.message}`);
    return data.signedUrl;
  }
}
