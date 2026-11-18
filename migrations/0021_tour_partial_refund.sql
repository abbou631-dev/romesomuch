-- A middle step in the cancellation policy: cancelling before cancel_hours
-- refunds everything; from then until partial_refund_hours before the start,
-- partial_refund_pct of what was paid; after that, nothing.
-- partial_refund_pct = 0 means no middle step (the old two-step policy).
ALTER TABLE tours ADD COLUMN partial_refund_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tours ADD COLUMN partial_refund_hours INTEGER NOT NULL DEFAULT 0;

-- Private Vatican and Colosseum tours (tickets bought in the guests' names),
-- owner's choice on 18 Nov 2026: free up to 30 days before, 50% back up to
-- 48 hours before, nothing after.
UPDATE tours SET cancel_hours = 720, partial_refund_pct = 50, partial_refund_hours = 48
  WHERE slug IN ('private-vatican-museums-tour', 'private-colosseum-tour');
