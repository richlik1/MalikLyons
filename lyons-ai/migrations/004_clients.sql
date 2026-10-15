-- Client relationships & communications hub.

CREATE TABLE clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  company     text,
  scope       text NOT NULL DEFAULT 'business' CHECK (scope IN ('business', 'personal')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('prospect', 'active', 'inactive')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_name_idx ON clients (lower(name));

-- One identifier (email, phone, domain, external id) belongs to at most one client.
CREATE TABLE client_identities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('email', 'phone', 'domain', 'stayops_id', 'google_contact', 'imessage_handle')),
  value             text NOT NULL,
  source            text NOT NULL,
  confidence        numeric(3, 2) NOT NULL,
  verified_by_owner boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

-- Matches that weren't certain enough to link automatically wait for the owner.
CREATE TABLE identity_suggestions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text NOT NULL,
  value               text NOT NULL,
  display_name        text,
  source              text NOT NULL,
  candidate_client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  confidence          numeric(3, 2) NOT NULL,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value, candidate_client_id)
);

CREATE TABLE client_events (
  id                 bigserial PRIMARY KEY,
  client_id          uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  at                 timestamptz NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('email', 'meeting', 'proposal', 'invoice', 'stayops_job', 'note', 'message', 'call')),
  direction          text CHECK (direction IN ('in', 'out')),
  channel            text,
  source             text NOT NULL,
  external_id        text,
  summary            text NOT NULL,
  requires_response  boolean NOT NULL DEFAULT false,
  responded_at       timestamptz,
  due_at             timestamptz,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source, external_id)
);
CREATE INDEX client_events_client_idx ON client_events (client_id, at DESC);
CREATE INDEX client_events_open_idx ON client_events (requires_response, responded_at);

-- What LYONS AI drafted or sent, when, and what happened.
CREATE TABLE outbound_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES clients(id) ON DELETE SET NULL,
  channel      text NOT NULL CHECK (channel IN ('email', 'imessage', 'sms', 'whatsapp', 'slack')),
  to_address   text NOT NULL,
  subject      text,
  body         text NOT NULL,
  status       text NOT NULL CHECK (status IN ('draft', 'queued', 'sent', 'failed', 'replied', 'cancelled')),
  external_id  text,
  policy_id    uuid,
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  replied_at   timestamptz,
  result       text
);
CREATE INDEX outbound_status_idx ON outbound_messages (channel, status);

-- Narrowly scoped automation: lets a specific kind of message skip per-message
-- approval only after the owner explicitly activates the policy.
CREATE TABLE automation_policies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  channel      text NOT NULL,
  description  text NOT NULL,
  rules        jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'revoked')),
  approved_by  text,
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
