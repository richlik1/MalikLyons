import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Db } from "./pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function findMigrationsDir(): string {
  // Works from both src/db (tsx) and dist/src/db (compiled).
  const candidates = [path.resolve(here, "../../migrations"), path.resolve(here, "../../../migrations")];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`migrations directory not found (looked in ${candidates.join(", ")})`);
  return found;
}

export async function migrate(db: Db, dir = findMigrationsDir()): Promise<string[]> {
  const files = await readdir(dir);
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const file of files.filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const db = createPool(url);
  migrate(db)
    .then((ran) => console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}
