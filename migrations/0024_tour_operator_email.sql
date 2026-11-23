-- The tour operator who runs an experience gets a copy of the owner's
-- new-booking email (owner, 23 Nov 2026: Studio Cassio runs both mosaic
-- classes). Empty: only the owner is told. Editable in CRM Tour.
ALTER TABLE tours ADD COLUMN operator_email TEXT;
UPDATE tours SET operator_email = 'studiocassio@gmail.com' WHERE slug IN ('roman-mosaic-class', 'micromosaic-jewelry-class');
-- The micromosaic class runs only at 10:00 (owner, 23 Nov 2026).
UPDATE tours SET times = '["10:00"]' WHERE slug = 'micromosaic-jewelry-class';
