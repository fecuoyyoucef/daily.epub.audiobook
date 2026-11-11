-- 0003_durable_jobs: persist upload replacement intent and workflow run IDs.
ALTER TABLE public.uploads ADD COLUMN replace_existing boolean NOT NULL DEFAULT false;

ALTER TABLE public.import_jobs ADD COLUMN workflow_run_id text;

ALTER TABLE public.audio_jobs ADD COLUMN workflow_run_id text;
