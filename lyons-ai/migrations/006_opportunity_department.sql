-- Opportunity Intelligence Department (blueprint v1.0).
-- Extends the v0.2 engine; nothing is dropped.

-- New category for the AI & technology department; new terminal status for low scores.
ALTER TABLE opportunities DROP CONSTRAINT opportunities_category_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_category_check CHECK (category IN
  ('contracts', 'grants_financing', 'real_estate', 'business_ideas', 'development', 'personal', 'operations', 'technology'));
ALTER TABLE opportunities DROP CONSTRAINT opportunities_status_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_status_check CHECK (status IN
  ('discovered', 'verified', 'qualified', 'approved', 'in_progress', 'closed', 'rejected', 'archived'));

ALTER TABLE opportunities
  ADD COLUMN department text,
  ADD COLUMN source_registry_id text,
  -- open_solicitation | forecast (projected, not yet open) | program | listing | idea | resource
  ADD COLUMN opportunity_type text NOT NULL DEFAULT 'open_solicitation',
  -- grant | loan | reimbursement | paid_program | tax_incentive | contract | free | unknown
  ADD COLUMN funding_type text NOT NULL DEFAULT 'unknown',
  ADD COLUMN priority_band text CHECK (priority_band IN ('high', 'investigate', 'watchlist', 'archive')),
  ADD COLUMN capital_required_usd numeric,
  ADD COLUMN estimated_cost text,
  ADD COLUMN assigned_owner text NOT NULL DEFAULT 'owner',
  ADD COLUMN retrieved_at timestamptz,
  ADD COLUMN verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('verified', 'unverified', 'failed'));

-- Configurable source registry with health tracking.
CREATE TABLE research_sources (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  department            text NOT NULL CHECK (department IN ('contracts', 'grants', 'ventures', 'real_estate', 'personal_growth', 'technology')),
  kind                  text NOT NULL CHECK (kind IN ('grants_gov', 'sam_gov', 'github', 'email_alerts', 'web_research')),
  url                   text NOT NULL,
  domains               text[] NOT NULL DEFAULT '{}',
  priority              text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  opportunity_type      text NOT NULL DEFAULT 'open_solicitation',
  enabled               boolean NOT NULL DEFAULT true,
  config                jsonb NOT NULL DEFAULT '{}'::jsonb,
  access_notes          text,
  max_requests_per_run  int NOT NULL DEFAULT 30,
  max_requests_per_day  int NOT NULL DEFAULT 200,
  last_run_at           timestamptz,
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  last_error            text,
  consecutive_failures  int NOT NULL DEFAULT 0,
  disabled_reason       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Runs: cycle/source bookkeeping, checkpoints and dead letters.
ALTER TABLE research_runs DROP CONSTRAINT research_runs_status_check;
ALTER TABLE research_runs ADD CONSTRAINT research_runs_status_check CHECK (status IN ('running', 'succeeded', 'failed', 'skipped', 'dead_letter'));
ALTER TABLE research_runs
  ADD COLUMN source_id text REFERENCES research_sources(id) ON DELETE SET NULL,
  ADD COLUMN cycle text,
  ADD COLUMN checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN api_calls int NOT NULL DEFAULT 0;

-- Every piece of evidence behind an opportunity.
CREATE TABLE opportunity_evidence (
  id              bigserial PRIMARY KEY,
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  url             text NOT NULL,
  method          text NOT NULL,
  published_at    timestamptz,
  retrieved_at    timestamptz NOT NULL DEFAULT now(),
  passed          boolean NOT NULL,
  checks          jsonb NOT NULL,
  excerpt         text
);
CREATE INDEX opportunity_evidence_opp_idx ON opportunity_evidence (opportunity_id, retrieved_at DESC);

-- Score history with explanation (model version recorded for auditability).
CREATE TABLE opportunity_scores (
  id              bigserial PRIMARY KEY,
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT now(),
  model_version   text NOT NULL,
  components      jsonb NOT NULL,
  total           numeric NOT NULL,
  band            text NOT NULL,
  explanation     text NOT NULL
);
CREATE INDEX opportunity_scores_opp_idx ON opportunity_scores (opportunity_id, at DESC);

-- Pipeline stage / status transitions (DISCOVERED → VERIFIED → SCORED → SAVED → REPORTED → ACTION PREPARED …).
CREATE TABLE opportunity_status_history (
  id              bigserial PRIMARY KEY,
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT now(),
  stage           text NOT NULL,
  from_status     text,
  to_status       text,
  actor           text NOT NULL,
  reason          text
);
CREATE INDEX opportunity_status_history_opp_idx ON opportunity_status_history (opportunity_id, at);
CREATE INDEX opportunity_status_history_at_idx ON opportunity_status_history (at);

-- Prepared and executed next steps.
CREATE TABLE opportunity_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('checklist', 'outreach_draft', 'internal_task', 'stayops_task', 'reminder')),
  status          text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'approved', 'done', 'failed', 'cancelled')),
  title           text NOT NULL,
  body            text NOT NULL,
  task_id         uuid REFERENCES tasks(id) ON DELETE SET NULL,
  external_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, kind, title)
);

-- Owner feedback (accepted / rejected / completed + result), used for bounded learning.
CREATE TABLE user_feedback (
  id              bigserial PRIMARY KEY,
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT now(),
  actor           text NOT NULL,
  decision        text NOT NULL CHECK (decision IN ('accepted', 'rejected', 'completed')),
  note            text
);
INSERT INTO user_feedback (opportunity_id, at, actor, decision, note)
  SELECT opportunity_id, at, actor, details->>'decision', details->>'note' FROM opportunity_events WHERE event = 'feedback';

-- Research spend and API usage per run.
CREATE TABLE research_costs (
  id             bigserial PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  run_id         uuid REFERENCES research_runs(id) ON DELETE SET NULL,
  source_id      text,
  department     text,
  kind           text NOT NULL CHECK (kind IN ('llm', 'api_call')),
  model          text,
  input_tokens   int NOT NULL DEFAULT 0,
  output_tokens  int NOT NULL DEFAULT 0,
  requests       int NOT NULL DEFAULT 0,
  cost_usd       numeric(12, 6) NOT NULL DEFAULT 0
);
CREATE INDEX research_costs_at_idx ON research_costs (at);

ALTER TABLE notification_log RENAME TO notification_history;
ALTER TABLE notification_history ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX notification_history_dedupe_idx ON notification_history (dedupe_key) WHERE dedupe_key IS NOT NULL;
