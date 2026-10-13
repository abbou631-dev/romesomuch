-- What the person says is their venue, asked on the invite page so the
-- agency can check it matches the invite before approving.
ALTER TABLE client_users ADD COLUMN venue TEXT;
