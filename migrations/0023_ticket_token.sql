-- Each booking's ticket page (/ticket/<code>?k=<ticket_token>) is opened with
-- a random key, so a booking code alone shows nothing. Bookings made before
-- this get a key now; new ones get it when they are created (server/tours.js).
ALTER TABLE tour_bookings ADD COLUMN ticket_token TEXT;
UPDATE tour_bookings SET ticket_token = lower(hex(randomblob(16))) WHERE ticket_token IS NULL;
CREATE UNIQUE INDEX tour_bookings_ticket ON tour_bookings(ticket_token);
