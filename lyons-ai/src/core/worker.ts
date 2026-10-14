import type { Logger } from "pino";
import type { Store } from "../db/store.js";
import type { Notifier } from "./notifier.js";
import type { TaskRunner } from "./runner.js";

/**
 * Polls Postgres for runnable tasks. Because claiming uses FOR UPDATE SKIP
 * LOCKED and leases, several workers (or a restarted worker) can run safely;
 * a task whose worker died is re-claimed after its lease expires.
 */
export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly d: {
      store: Store;
      runner: TaskRunner;
      notifier: Notifier;
      log: Logger;
      workerId: string;
      concurrency: number;
      taskTimeoutMs: number;
      leaseMs?: number;
      pollMs?: number;
    },
  ) {}

  start(): void {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.tick();
      } catch (err) {
        this.d.log.error({ err }, "worker tick failed");
      }
      if (!this.stopped) this.timer = setTimeout(tick, this.d.pollMs ?? 2000);
    };
    void tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.inflight]);
  }

  /** One scheduling pass. Exposed for tests. */
  async tick(): Promise<number> {
    const { store, notifier } = this.d;
    for (const a of await store.expireApprovals()) {
      await notifier.send(a.telegram_chat_id ? Number(a.telegram_chat_id) : null, `⌛ Approval expired: ${a.summary}`);
    }
    if (await store.isPaused()) return 0;
    let started = 0;
    while (this.inflight.size < this.d.concurrency) {
      const task = await store.claimNextTask(this.d.workerId, this.d.leaseMs ?? 60_000, this.d.taskTimeoutMs);
      if (!task) break;
      const p = this.d.runner.run(task).finally(() => this.inflight.delete(p));
      this.inflight.add(p);
      started++;
    }
    return started;
  }

  /** Wait for currently running tasks (tests). */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }
}
