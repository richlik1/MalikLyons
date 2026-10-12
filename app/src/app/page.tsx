import Link from "next/link";
import { LandingTracker } from "@/components/LandingTracker";
import { TrackedLink } from "@/components/TrackedLink";
import { WaitlistForm } from "@/components/WaitlistForm";

// Landing page copy deliberately makes no performance claims: TrendSet has no pilot data yet.
const VARIANT = "A";

const steps = [
  { n: "01", title: "Add your products", body: "Upload a clean product photo, price and your store link. Tops, hoodies and jackets first." },
  { n: "02", title: "Shoppers try it on", body: "They upload a photo with explicit consent and get an AI preview of your garment on them." },
  { n: "03", title: "They buy from you", body: "Every preview links straight back to your product page. You see which items get tried on." },
];

export default function LandingPage() {
  return (
    <>
      <LandingTracker variant={VARIANT} />
      <section className="container-page pb-12 pt-12 sm:pt-20">
        <p className="eyebrow">Pilot program · independent streetwear &amp; fashion brands</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
          Let shoppers see your pieces on themselves before they buy.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-soft">
          TrendSet adds AI virtual try-on to your store. We&apos;re looking for a small group of brands to pilot it with us and measure, honestly, whether it moves sales.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <TrackedLink href="#waitlist" className="btn-primary" variant={VARIANT}>Apply for the pilot</TrackedLink>
          <Link href="/try-on" className="btn-ghost">Try it as a shopper</Link>
        </div>
      </section>

      <section className="container-page grid gap-4 py-8 sm:grid-cols-3" aria-label="How it works">
        {steps.map((s) => (
          <div key={s.n} className="card">
            <p className="font-mono text-sm text-ink-muted">{s.n}</p>
            <h2 className="mt-2 text-lg font-bold">{s.title}</h2>
            <p className="mt-1 text-ink-soft">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="container-page grid gap-6 py-10 sm:grid-cols-2">
        <div>
          <p className="eyebrow">What pilot brands get</p>
          <ul className="mt-3 space-y-2 text-ink-soft">
            <li>• Free try-on for up to 20 products during a 6-week pilot</li>
            <li>• A weekly report: try-ons, completion rate, ratings and click-throughs to your product pages</li>
            <li>• Help designing a controlled test, so any effect on sales can be told apart from noise</li>
            <li>• Direct line to the founding team</li>
          </ul>
        </div>
        <div>
          <p className="eyebrow">What we won&apos;t claim</p>
          <ul className="mt-3 space-y-2 text-ink-soft">
            <li>• Previews are AI-generated images, <strong>not</strong> size or fit predictions.</li>
            <li>• We don&apos;t yet have results to quote. The pilot is how we get them.</li>
            <li>• Shopper photos are private, consent-based and auto-deleted.</li>
          </ul>
        </div>
      </section>

      <section id="waitlist" className="container-page scroll-mt-20 py-10">
        <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Apply for the merchant pilot</h2>
        <p className="mb-6 mt-2 text-ink-soft">A few questions about your store.</p>
        <WaitlistForm />
      </section>
    </>
  );
}
