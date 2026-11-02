-- "Accepted" when the creator agreed on the /ugc/ form that RomeSoMuch may
-- share their contacts with partner venues. Only then does the client area
-- show their email, WhatsApp, profiles and message.
ALTER TABLE ugc ADD COLUMN share_contacts TEXT;
