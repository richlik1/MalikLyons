-- Gmail Intelligence & Cleanup: plans are proposed first, applied only after
-- approval, and every applied change is recorded per message so it can be reverted.

CREATE TABLE cleanup_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('business', 'personal')),
  query         text NOT NULL,
  status        text NOT NULL DEFAULT 'proposed'
                CHECK (status IN ('proposed', 'applied', 'reverted', 'expired')),
  label_name    text NOT NULL,
  summary       jsonb NOT NULL,
  report        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  applied_at    timestamptz,
  reverted_at   timestamptz
);

CREATE TABLE cleanup_items (
  id               bigserial PRIMARY KEY,
  plan_id          uuid NOT NULL REFERENCES cleanup_plans(id) ON DELETE CASCADE,
  message_id       text NOT NULL,
  thread_id        text,
  sender           text,
  subject          text,
  category         text NOT NULL,
  action           text NOT NULL CHECK (action IN ('archive', 'trash', 'keep')),
  protected_reason text,
  applied_action   text CHECK (applied_action IN ('archive', 'trash')),
  applied_at       timestamptz,
  reverted_at      timestamptz,
  UNIQUE (plan_id, message_id)
);
CREATE INDEX cleanup_items_plan_idx ON cleanup_items (plan_id, action);

CREATE TABLE unsubscribe_candidates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES cleanup_plans(id) ON DELETE CASCADE,
  sender        text NOT NULL,
  message_count int NOT NULL,
  unread_count  int NOT NULL,
  method        text NOT NULL CHECK (method IN ('one_click', 'link', 'mailto', 'none')),
  url           text,
  mailto        text,
  status        text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'unsubscribed', 'failed', 'manual')),
  result        text,
  UNIQUE (plan_id, sender)
);
