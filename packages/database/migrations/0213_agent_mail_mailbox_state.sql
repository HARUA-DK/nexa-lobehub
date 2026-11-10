CREATE TABLE IF NOT EXISTS "agent_mail_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"account_id" uuid NOT NULL,
	"mode" text DEFAULT 'compose' NOT NULL,
	"source_mail_id" uuid,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"text" text DEFAULT '' NOT NULL,
	"sending_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_mails" ADD COLUMN IF NOT EXISTS "bcc" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_mails" ADD COLUMN IF NOT EXISTS "starred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_mails" ADD COLUMN IF NOT EXISTS "marked_unread_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_mails" ADD COLUMN IF NOT EXISTS "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_mails" ADD COLUMN IF NOT EXISTS "purged_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_mail_drafts_agent_id_agents_id_fk') THEN
    ALTER TABLE "agent_mail_drafts" ADD CONSTRAINT "agent_mail_drafts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_mail_drafts_user_id_users_id_fk') THEN
    ALTER TABLE "agent_mail_drafts" ADD CONSTRAINT "agent_mail_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_mail_drafts_workspace_id_workspaces_id_fk') THEN
    ALTER TABLE "agent_mail_drafts" ADD CONSTRAINT "agent_mail_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_mail_drafts_account_id_agent_accounts_id_fk') THEN
    ALTER TABLE "agent_mail_drafts" ADD CONSTRAINT "agent_mail_drafts_account_id_agent_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_mail_drafts_source_mail_id_agent_mails_id_fk') THEN
    ALTER TABLE "agent_mail_drafts" ADD CONSTRAINT "agent_mail_drafts_source_mail_id_agent_mails_id_fk" FOREIGN KEY ("source_mail_id") REFERENCES "public"."agent_mails"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_mail_drafts_account_source_mode_unique" ON "agent_mail_drafts" USING btree ("account_id","source_mail_id","mode") WHERE "agent_mail_drafts"."source_mail_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mail_drafts_account_updated_at_idx" ON "agent_mail_drafts" USING btree ("account_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mail_drafts_agent_updated_at_idx" ON "agent_mail_drafts" USING btree ("agent_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mail_drafts_user_id_idx" ON "agent_mail_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mails_account_folder_idx" ON "agent_mails" USING btree ("account_id","direction","delivered_at") WHERE "agent_mails"."trashed_at" is null and "agent_mails"."purged_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mails_workspace_agent_folder_idx" ON "agent_mails" USING btree ("workspace_id","agent_id","direction","delivered_at") WHERE "agent_mails"."trashed_at" is null and "agent_mails"."purged_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mails_account_trashed_idx" ON "agent_mails" USING btree ("account_id","trashed_at") WHERE "agent_mails"."trashed_at" is not null and "agent_mails"."purged_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mails_account_starred_idx" ON "agent_mails" USING btree ("account_id","delivered_at") WHERE "agent_mails"."starred_at" is not null and "agent_mails"."trashed_at" is null and "agent_mails"."purged_at" is null;--> statement-breakpoint
-- Substring search over subject, sender, recipients and body. Skipped where
-- pg_trgm cannot be installed: the search still works, it just scans the
-- account's mail, so plain self-hosted Postgres can upgrade.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "agent_mails_search_trgm_idx" ON "agent_mails" USING gin (
    (lower(coalesce("subject", '') || ' ' || "from_address" || ' ' || coalesce("from_name", '') || ' ' || "to"::text || ' ' || "cc"::text || ' ' || "text")) gin_trgm_ops
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'agent_mails_search_trgm_idx skipped: %', SQLERRM;
END $$;
