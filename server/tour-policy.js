// The cancellation policy of an experience (columns of `tours`), in words and
// as the share of the payment refunded. Shared by the booking box, the guest
// emails and the CRM, so all three say the same thing.

const span = (h) => (h >= 72 && h % 24 === 0 ? `${h / 24} days` : `${h} hours`);

export function cancelPolicy(t) {
  const free = `Free cancellation up to ${span(t.cancel_hours)} before the start`;
  if (!t.partial_refund_pct) return `${free}.`;
  return `${free}; ${t.partial_refund_pct}% refunded up to ${span(t.partial_refund_hours)} before; no refund after that.`;
}

// Percent of what was paid that the policy gives back, `hours` before the start.
export function refundShare(t, hours) {
  if (hours >= t.cancel_hours) return 100;
  if (t.partial_refund_pct && hours >= t.partial_refund_hours) return t.partial_refund_pct;
  return 0;
}
