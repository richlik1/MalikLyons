-- Opportunity Intelligence pipeline.
-- Confirmed facts (from the source/authoritative re-fetch) are stored separately
-- from estimates, and every item carries its verification record.

CREATE TABLE opportunities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL,
  source_id             text NOT NULL,
  fingerprint           text NOT NULL UNIQUE,
  category              text NOT NULL CHECK (category IN
                          ('contracts', 'grants_financing', 'real_estate', 'business_ideas',
                           'development', 'personal', 'operations')),
  title                 text NOT NULL,
  organization          text,
  url                   text NOT NULL,
  summary               text,
  location              text,
  amount_min            numeric,          -- confirmed by source
  amount_max            numeric,          -- confirmed by source
  estimated_value       numeric,          -- our estimate, never presented as fact
  estimate_basis        text,
  posted_at             timestamptz,
  deadline_at           timestamptz,
  deadline_confirmed    boolean NOT NULL DEFAULT false,
  eligibility           text CHECK (eligibility IN ('eligible', 'likely', 'unclear', 'ineligible')),
  eligibility_notes     text,
  prerequisites         text[] NOT NULL DEFAULT '{}',
  required_documents    text[] NOT NULL DEFAULT '{}',
  required_investment   text,
  effort                text,
  risks                 text[] NOT NULL DEFAULT '{}',
  next_action           text,
  why_fit               text,
  score                 numeric,
  score_breakdown       jsonb,
  confidence            text CHECK (confidence IN ('high', 'medium', 'low')),
  status                text NOT NULL DEFAULT 'discovered' CHECK (status IN
                          ('discovered', 'verified', 'qualified', 'approved', 'in_progress', 'closed', 'rejected')),
  rejection_reason      text,
  verification          jsonb,
  raw                   jsonb,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_verified_at      timestamptz,
  notified_at           timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX opportunities_status_idx ON opportunities (status, score DESC);
CREATE INDEX opportunities_deadline_idx ON opportunities (deadline_at);

-- History: status changes, verification results, owner feedback, reports.
CREATE TABLE opportunity_events (
  id              bigserial PRIMARY KEY,
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT now(),
  actor           text NOT NULL,
  event           text NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX opportunity_events_opp_idx ON opportunity_events (opportunity_id, at);
CREATE INDEX opportunity_events_event_idx ON opportunity_events (event, at);

-- Background job runs (discovery, rechecks, reports) with retry bookkeeping.
CREATE TABLE research_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job          text NOT NULL,
  slot         text NOT NULL,
  attempt      int NOT NULL DEFAULT 1,
  status       text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX research_runs_job_idx ON research_runs (job, slot, started_at DESC);

-- Every proactive notification, for anti-flood caps and "already told you" checks.
CREATE TABLE notification_log (
  id               bigserial PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  module           text NOT NULL,
  kind             text NOT NULL,
  opportunity_ids  uuid[] NOT NULL DEFAULT '{}',
  text             text NOT NULL
);
CREATE INDEX notification_log_idx ON notification_log (module, kind, at);

-- Label LLM spend by purpose so per-module budgets (e.g. opportunity research) can be enforced.
ALTER TABLE spend_ledger ADD COLUMN label text;
CREATE INDEX spend_ledger_label_idx ON spend_ledger (label, at);
