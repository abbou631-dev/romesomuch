-- The UGC page is the owner's; the owner can open it to single team members
-- from the Team page.
ALTER TABLE team_members ADD COLUMN can_ugc INTEGER NOT NULL DEFAULT 0;
