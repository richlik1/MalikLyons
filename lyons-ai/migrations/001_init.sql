-- LYONS AI initial schema.
-- Design notes:
--  * task_messages is append-only: the Claude conversation for a task is replayed
--    verbatim on resume (thinking blocks must not be edited).
--  * tool_calls.tool_use_id is unique, so a tool call is recorded exactly once and
--    its execution state survives crashes. That is what prevents duplicate actions.
--  * audit_log rejects UPDATE/DELETE via trigger.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_task_id   uuid REFERENCES tasks(id),
  title            text NOT NULL,
  input            text NOT NULL,
  agent            text NOT NULL DEFAULT 'chief_of_staff',
  scope            text NOT NULL CHECK (scope IN ('business', 'personal')),
  source           text NOT NULL CHECK (source IN ('telegram', 'schedule', 'webhook', 'system')),
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  chat_id          bigint,
  result           text,
  error            text,
  turns            int NOT NULL DEFAULT 0,
  cost_usd         numeric(12, 6) NOT NULL DEFAULT 0,
  attempts         int NOT NULL DEFAULT 0,
  lease_owner      text,
  lease_expires_at timestamptz,
  deadline_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz
);
CREATE INDEX tasks_status_idx ON tasks (status, created_at);

CREATE TABLE task_messages (
  id          bigserial PRIMARY KEY,
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq         int NOT NULL,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, seq)
);

CREATE TABLE tool_calls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tool_use_id   text NOT NULL UNIQUE,
  tool_name     text NOT NULL,
  input         jsonb NOT NULL,
  risk          text NOT NULL,
  decision      text NOT NULL CHECK (decision IN ('allow', 'require_approval', 'deny')),
  status        text NOT NULL
                CHECK (status IN ('pending', 'awaiting_approval', 'approved', 'rejected', 'denied',
                                  'running', 'succeeded', 'failed', 'outcome_unknown')),
  output        jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz
);
CREATE INDEX tool_calls_task_idx ON tool_calls (task_id);

CREATE TABLE approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tool_call_id        uuid NOT NULL UNIQUE REFERENCES tool_calls(id) ON DELETE CASCADE,
  summary             text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  telegram_chat_id    bigint,
  telegram_message_id bigint,
  decided_by          text,
  decided_at          timestamptz,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  actor    text NOT NULL,
  event    text NOT NULL,
  task_id  uuid,
  details  jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_task_idx ON audit_log (task_id, at);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TABLE memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('client', 'project', 'goal', 'preference', 'person', 'fact')),
  subject     text NOT NULL,
  content     text NOT NULL,
  scope       text NOT NULL CHECK (scope IN ('business', 'personal')),
  source      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  search      tsvector GENERATED ALWAYS AS (
                to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(content, ''))
              ) STORED,
  UNIQUE (scope, kind, subject)
);
CREATE INDEX memories_search_idx ON memories USING gin (search);

CREATE TABLE oauth_credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL,
  account_label    text NOT NULL CHECK (account_label IN ('business', 'personal')),
  account_email    text,
  scopes           text[] NOT NULL DEFAULT '{}',
  encrypted_tokens text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, account_label)
);

CREATE TABLE oauth_states (
  state          text PRIMARY KEY,
  provider       text NOT NULL,
  account_label  text NOT NULL,
  expires_at     timestamptz NOT NULL
);

CREATE TABLE spend_ledger (
  id                 bigserial PRIMARY KEY,
  task_id            uuid REFERENCES tasks(id) ON DELETE SET NULL,
  at                 timestamptz NOT NULL DEFAULT now(),
  model              text NOT NULL,
  input_tokens       int NOT NULL,
  output_tokens      int NOT NULL,
  cache_read_tokens  int NOT NULL DEFAULT 0,
  cache_write_tokens int NOT NULL DEFAULT 0,
  cost_usd           numeric(12, 6) NOT NULL
);
CREATE INDEX spend_ledger_at_idx ON spend_ledger (at);

CREATE TABLE browser_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  workflow     text NOT NULL,
  url          text NOT NULL,
  status       text NOT NULL CHECK (status IN ('running', 'succeeded', 'stopped', 'failed')),
  screenshots  text[] NOT NULL DEFAULT '{}',
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

-- Idempotency for scheduled runs, e.g. ('briefing', 'morning:2026-10-14').
CREATE TABLE scheduled_runs (
  kind       text NOT NULL,
  run_key    text NOT NULL,
  task_id    uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, run_key)
);
