import { CONSENT_POINTS, CONSENT_VERSION, FIT_DISCLAIMER } from "@/lib/consent";

export default function PrivacyPage() {
  const days = Number(process.env.PERSON_PHOTO_RETENTION_DAYS) || 30;
  return (
    <article className="container-page max-w-2xl space-y-6 py-12">
      <h1 className="text-3xl font-black tracking-tight">Privacy &amp; photo policy</h1>
      <p className="notice">Draft for the pilot. Have counsel review before public launch.</p>
      <section>
        <h2 className="text-xl font-bold">Your photos</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
          {CONSENT_POINTS.map((p) => <li key={p}>{p}</li>)}
          <li>Photos are deleted automatically after {days} days.</li>
          <li>You can delete any photo, or your whole account, at any time from your Account page. Deletion also removes previews made from that photo.</li>
          <li>TrendSet staff and merchants cannot view your photos. Merchants see only aggregate counts.</li>
        </ul>
      </section>
      <section>
        <h2 className="text-xl font-bold">AI previews</h2>
        <p className="mt-2 text-ink-soft">{FIT_DISCLAIMER}</p>
      </section>
      <p className="text-sm text-ink-muted">Consent version {CONSENT_VERSION}</p>
    </article>
  );
}
