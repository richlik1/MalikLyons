import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { ToolDefinition } from "../core/types.js";
import type { Store } from "../db/store.js";
import { verifyWebhook } from "../security/webhook-auth.js";

/**
 * Apple device & storage assistant (server side). The Mac bridge scans folders
 * the owner chooses, uploads a duplicate/large-file report, and executes only
 * owner-approved "move to Trash" actions (Finder's Trash keeps Put Back). It
 * re-checks file hashes before moving anything; nothing is permanently deleted.
 */

const Report = z.object({
  device: z.string().min(1).max(100),
  summary: z.object({
    scanned_files: z.number().int().min(0),
    scanned_bytes: z.number().min(0),
    duplicate_groups: z.number().int().min(0),
    reclaimable_bytes: z.number().min(0),
    roots: z.array(z.string()).max(20),
  }),
  groups: z
    .array(z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().min(0), paths: z.array(z.string().max(1024)).min(2).max(50) }))
    .max(2000),
  large_files: z.array(z.object({ path: z.string().max(1024), size: z.number() })).max(200).default([]),
});

const Ack = z.object({ id: z.string().uuid(), moved: z.array(z.string()), skipped: z.array(z.object({ path: z.string(), reason: z.string() })) });

export function formatBytes(n: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function registerStorageBridge(app: FastifyInstance, d: { config: Config; store: Store }): void {
  const { config, store } = d;
  const auth = (req: FastifyRequest) =>
    config.MAC_BRIDGE_SECRET
      ? verifyWebhook({
          secret: config.MAC_BRIDGE_SECRET,
          timestampHeader: req.headers["x-lyons-timestamp"] as string | undefined,
          signatureHeader: req.headers["x-lyons-signature"] as string | undefined,
          rawBody: (req.body as { raw?: string } | undefined)?.raw ?? "",
        })
      : { ok: false as const, reason: "bridge disabled" };

  app.post("/bridge/storage/report", async (req, res) => {
    const a = auth(req);
    if (!a.ok) return res.code(401).send({ error: a.reason });
    const r = Report.safeParse((req.body as { json: unknown }).json);
    if (!r.success) return res.code(400).send({ error: r.error.issues });
    const row = await store.db.query<{ id: string }>("INSERT INTO storage_reports (device, summary, groups) VALUES ($1, $2, $3) RETURNING id", [
      r.data.device,
      JSON.stringify({ ...r.data.summary, large_files: r.data.large_files }),
      JSON.stringify(r.data.groups),
    ]);
    await store.audit("mac_bridge", "storage.report", null, { reportId: row.rows[0]!.id, ...r.data.summary });
    return { id: row.rows[0]!.id };
  });

  app.get("/bridge/storage/actions", async (req, res) => {
    const a = auth(req);
    if (!a.ok) return res.code(401).send({ error: a.reason });
    if ((await store.isPaused()) || (await store.isModulePaused("device_storage"))) return { actions: [] };
    const r = await store.db.query<{ id: string; group_hash: string; keep_path: string; trash_paths: string[] }>(
      "SELECT id, group_hash, keep_path, trash_paths FROM storage_actions WHERE status = 'queued' ORDER BY created_at LIMIT 20",
    );
    return { actions: r.rows };
  });

  app.post("/bridge/storage/ack", async (req, res) => {
    const a = auth(req);
    if (!a.ok) return res.code(401).send({ error: a.reason });
    const r = Ack.safeParse((req.body as { json: unknown }).json);
    if (!r.success) return res.code(400).send({ error: r.error.issues });
    const status = r.data.skipped.length === 0 ? "done" : r.data.moved.length ? "partial" : "failed";
    await store.db.query("UPDATE storage_actions SET status = $2, result = $3, done_at = now() WHERE id = $1 AND status = 'queued'", [
      r.data.id,
      status,
      JSON.stringify(r.data),
    ]);
    await store.audit("mac_bridge", "storage.trashed", null, { actionId: r.data.id, moved: r.data.moved.length, skipped: r.data.skipped });
    return { ok: true };
  });
}

export function storageTools(store: Store): ToolDefinition[] {
  const common = { module: "device_storage" as const, dataClasses: ["personal" as const] };

  const reportInput = z.object({ limit: z.number().int().min(1).max(30).default(10) });
  const report: ToolDefinition<z.infer<typeof reportInput>> = {
    ...common,
    name: "storage_report",
    description: "Show the latest Mac storage scan: duplicate file groups (largest waste first), reclaimable space, and large files.",
    input: reportInput,
    risk: "read",
    idempotent: true,
    describeAction: () => "Show storage report",
    async run(i) {
      const r = await store.db.query<{ id: string; device: string; created_at: Date; summary: any; groups: { hash: string; size: number; paths: string[] }[] }>(
        "SELECT * FROM storage_reports ORDER BY created_at DESC LIMIT 1",
      );
      const rep = r.rows[0];
      if (!rep) return { content: "No storage report yet. Run the storage scan on the Mac (deploy/macos-bridge/lyons_storage_scan.py)." };
      const groups = [...rep.groups].sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1)).slice(0, i.limit);
      const lines = [
        `Storage report ${rep.id.slice(0, 8)} from ${rep.device} (${rep.created_at.toISOString().slice(0, 16)} UTC)`,
        `Scanned ${rep.summary.scanned_files} files (${formatBytes(rep.summary.scanned_bytes)}) in ${rep.summary.roots.join(", ")}`,
        `Duplicates: ${rep.summary.duplicate_groups} groups, ${formatBytes(rep.summary.reclaimable_bytes)} reclaimable`,
        "",
        ...groups.map((g) => `- ${g.hash.slice(0, 12)}: ${g.paths.length} copies × ${formatBytes(g.size)} — keep ${g.paths[0]}; extra: ${g.paths.slice(1).join(" | ")}`),
      ];
      if (rep.summary.large_files?.length) lines.push("", "Largest files:", ...rep.summary.large_files.slice(0, 10).map((f: { path: string; size: number }) => `- ${formatBytes(f.size)} ${f.path}`));
      return { content: lines.join("\n") };
    },
  };

  const trashInput = z.object({
    report_id: z.string().uuid(),
    group_hash: z.string().regex(/^[0-9a-f]{64}$/),
    keep_path: z.string().max(1024),
    trash_paths: z.array(z.string().max(1024)).min(1).max(49),
  });
  const trash: ToolDefinition<z.infer<typeof trashInput>> = {
    ...common,
    name: "storage_trash_duplicates",
    description: "Ask the Mac bridge to move extra copies of ONE duplicate group to the Trash (recoverable with Put Back), keeping one copy. Requires owner approval; hashes are re-checked on the Mac first.",
    input: trashInput,
    risk: "destructive",
    idempotent: true,
    describeAction: (i) => `Move ${i.trash_paths.length} duplicate file(s) to the Mac Trash, keeping ${i.keep_path}: ${i.trash_paths.join(", ")}`,
    async run(i) {
      const r = await store.db.query<{ groups: { hash: string; paths: string[] }[] }>("SELECT groups FROM storage_reports WHERE id = $1", [i.report_id]);
      const group = r.rows[0]?.groups.find((g) => g.hash === i.group_hash);
      if (!group) return { content: "That duplicate group isn't in the report.", isError: true };
      const all = new Set(group.paths);
      if (!all.has(i.keep_path) || i.trash_paths.some((p) => !all.has(p) || p === i.keep_path)) {
        return { content: "Paths don't match the reported duplicate group; nothing queued.", isError: true };
      }
      await store.db.query(
        "INSERT INTO storage_actions (report_id, group_hash, keep_path, trash_paths) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [i.report_id, i.group_hash, i.keep_path, i.trash_paths],
      );
      return { content: `Queued: the Mac bridge will move ${i.trash_paths.length} file(s) to the Trash after re-checking they're identical to ${i.keep_path}.` };
    },
  };
  return [report, trash];
}
