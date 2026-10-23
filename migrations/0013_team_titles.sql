-- The Titoli video page is the owner's; the owner can open it to single team
-- members from the Team page.
ALTER TABLE team_members ADD COLUMN can_titles INTEGER NOT NULL DEFAULT 0;
