-- Apply manually once reviewed. Safe to rerun against the documented schema.
BEGIN;

ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.account_identities (
  provider text NOT NULL CHECK (provider = 'google'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
);

-- No browser-facing Supabase role should read or write identity mappings.
-- The backend must connect as the owner/BYPASSRLS role, or have an explicit
-- server-only policy installed by the database administrator.
ALTER TABLE public.account_identities ENABLE ROW LEVEL SECURITY;

COMMIT;
