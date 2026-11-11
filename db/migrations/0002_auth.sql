-- 0002_auth: Better Auth tables, account mapping, and durable sign-in throttling.
ALTER TABLE public.app_users ADD COLUMN auth_user_id text;

CREATE UNIQUE INDEX app_users_auth_user_id_key ON public.app_users (auth_user_id);

CREATE TABLE public."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_email_unique UNIQUE (email)
);

CREATE TABLE public.session (
  id text PRIMARY KEY,
  "expiresAt" timestamp NOT NULL,
  token text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
  CONSTRAINT session_token_unique UNIQUE (token)
);

CREATE INDEX session_user_id_idx ON public.session ("userId");

CREATE TABLE public.account (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp,
  scope text,
  password text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX account_user_id_idx ON public.account ("userId");

CREATE TABLE public.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now(),
  "updatedAt" timestamp DEFAULT now()
);

CREATE INDEX verification_identifier_idx ON public.verification (identifier);

CREATE TABLE public.auth_rate_limits (
  key_hash char(64) PRIMARY KEY,
  window_started_at timestamp with time zone NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1000),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX auth_rate_limits_updated_at_idx ON public.auth_rate_limits (updated_at);

CREATE UNIQUE INDEX user_single_owner_key ON public."user" ((true));

CREATE UNIQUE INDEX app_users_single_owner_key ON public.app_users ((true));
