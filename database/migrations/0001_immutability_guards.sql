-- Profile versions are an append-only history: forbid UPDATE and DELETE of
-- individual rows. (Cascade deletes from search_profiles are not used: profiles
-- are archived, never deleted, and the FK from agent_runs is RESTRICT.)
CREATE OR REPLACE FUNCTION leadpilot_forbid_profile_version_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'profile_versions rows are immutable' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER profile_versions_immutable
  BEFORE UPDATE OR DELETE ON profile_versions
  FOR EACH ROW EXECUTE FUNCTION leadpilot_forbid_profile_version_change();
--> statement-breakpoint
-- A run's configuration snapshot and profile version are fixed at creation.
CREATE OR REPLACE FUNCTION leadpilot_forbid_run_snapshot_change() RETURNS trigger AS $$
BEGIN
  IF NEW.configuration_snapshot IS DISTINCT FROM OLD.configuration_snapshot
     OR NEW.profile_version_id IS DISTINCT FROM OLD.profile_version_id
     OR NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'agent_runs configuration snapshot is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agent_runs_snapshot_immutable
  BEFORE UPDATE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION leadpilot_forbid_run_snapshot_change();
