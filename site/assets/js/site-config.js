/*
 * Vintage Que — site settings: shows, booking form and mailing list.
 *
 * SHOWS: add only confirmed dates with a real ticket link. Leave the list
 * empty and the Shows page says no dates are announced (never invent dates).
 *   { date: "2026-11-21", city: "Detroit, MI", venue: "Venue name",
 *     tickets: "https://…" }   // tickets optional
 *
 * FORMS: paste the endpoint of a form service (for example Formspree:
 * https://formspree.io/f/<id>) that delivers to the approved booking inbox.
 * Until an endpoint is set, the forms stay visible but cannot be submitted
 * and say so, so no inquiry is silently lost.
 */
window.VQ_SHOWS = [];

window.VQ_FORMS = {
  booking: "",     // booking / press / partnership inquiries
  newsletter: ""   // fan mailing list (opt-in)
};
