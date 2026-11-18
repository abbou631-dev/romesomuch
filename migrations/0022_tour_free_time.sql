-- An experience with no fixed start times (times = '[]'): the guest picks a
-- day and writes the start time they would like; tour_bookings.time holds it,
-- and the owner confirms or changes it. Capacity then counts per day.
-- Private Vatican and Colosseum tours work this way (owner, 18 Nov 2026).
UPDATE tours SET times = '[]' WHERE slug IN ('private-vatican-museums-tour', 'private-colosseum-tour');
