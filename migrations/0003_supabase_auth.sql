-- Switch the external identity identifier from Firebase Auth to Supabase Auth.
-- Existing rows keep their old provider ID; the auth middleware can safely relink
-- an existing account by email only after Supabase confirms that email is verified.
ALTER TABLE users RENAME COLUMN firebase_uid TO supabase_uid;
