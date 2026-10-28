import { BadgeCheck, EyeOff, MapPinOff, MessageSquareOff, PencilLine, Printer, ShieldCheck, Sparkles, Trees } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DemoBanner, Logo } from "../components/Layout";
import { ChildPickerModal } from "../components/ModeSwitch";
import { CategoryTile, TrailIllustration } from "../components/ui";
import { CATEGORIES } from "../data/categories";
import { useDemo } from "../state/DemoStore";

const HOW = [
  { icon: Sparkles, title: "Pick a mission", text: "A grown-up and child choose an activity that fits their age and interests." },
  { icon: Trees, title: "Head offline", text: "Put the device down and do the activity for real, with a printed card if you like." },
  { icon: PencilLine, title: "Reflect", text: "Come back and share what you learned — in words, a drawing, or a chat with a grown-up." },
  { icon: BadgeCheck, title: "Celebrate", text: "A parent approves the mission and it joins the child's learning portfolio." },
];

const PROMISES = [
  { icon: EyeOff, text: "No ads, no behavioural tracking, no public profiles." },
  { icon: MessageSquareOff, text: "No chat, messaging, or AI conversations with children." },
  { icon: MapPinOff, text: "No location tracking and no photo uploads." },
  { icon: ShieldCheck, text: "Parents control every child profile and can export or delete data." },
];

export default function Welcome() {
  const { dispatch } = useDemo();
  const navigate = useNavigate();
  const [picker, setPicker] = useState(false);

  const enterAsParent = () => {
    dispatch({ type: "setMode", mode: "parent" });
    navigate("/parent");
  };

  return (
    <div className="min-h-screen">
      <DemoBanner />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <a href="#privacy" className="btn-ghost min-h-[44px] px-3 text-sm">Privacy</a>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <section className="grid items-center gap-8 py-6 md:grid-cols-2 md:py-12">
          <div>
            <p className="eyebrow">Real-world learning · Ages 7–12</p>
            <h1 className="mt-2 text-4xl sm:text-5xl">Less scrolling. More exploring.</h1>
            <p className="mt-4 text-xl text-ink-muted">
              WonderTrail gives children hands-on missions to do away from the screen — building bridges, interviewing family, designing
              playgrounds — and lets parents celebrate the skills they show.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" className="btn-primary" onClick={enterAsParent}>Enter the demo as a parent</button>
              <button type="button" className="btn-secondary" onClick={() => setPicker(true)}>Try a child's adventure</button>
            </div>
            <p className="mt-3 text-sm text-ink-muted">
              Parent sign-in arrives in the next phase. This demo uses a fictional family and stores progress only in this browser.
            </p>
          </div>
          <TrailIllustration className="w-full max-w-lg justify-self-center drop-shadow-xl" />
        </section>

        <section aria-labelledby="how" className="py-8">
          <h2 id="how" className="text-3xl">How a mission works</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW.map((h, i) => (
              <li key={h.title} className="card p-5">
                <span className="flex items-center gap-3">
                  <span aria-hidden className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-white"><h.icon className="h-6 w-6" /></span>
                  <span className="text-sm font-bold text-ink-muted">Step {i + 1}</span>
                </span>
                <h3 className="mt-3 text-xl">{h.title}</h3>
                <p className="mt-1 text-ink-muted">{h.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="cats" className="py-8">
          <h2 id="cats" className="text-3xl">Six ways to learn</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((c) => (
              <li key={c.id} className="card flex items-center gap-4 p-4">
                <CategoryTile id={c.id} />
                <div>
                  <h3 className="text-lg">{c.name}</h3>
                  <p className="text-sm text-ink-muted">{c.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="privacy" aria-labelledby="privacy-h" className="py-8">
          <div className="card grid gap-6 bg-primary-dark p-6 text-cream-100 sm:p-8 md:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 id="privacy-h" className="text-3xl text-white">Built for kids' privacy</h2>
              <p className="mt-2 text-cream-200">These are design commitments for the product. The full privacy policy will be published before any real family can sign up.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/explore" className="btn bg-white text-primary-dark hover:bg-cream-100">Browse sample missions</Link>
                <Link to="/missions/paper-bridge-lab/print" className="btn border-2 border-white/40 text-white hover:bg-white/10">
                  <Printer aria-hidden className="h-5 w-5" /> See a printable card
                </Link>
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {PROMISES.map((p) => (
                <li key={p.text} className="flex gap-3 rounded-2xl bg-white/10 p-4">
                  <p.icon aria-hidden className="h-6 w-6 shrink-0 text-sun" />
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <footer className="border-t border-cream-300 py-6 text-center text-sm text-ink-muted">
        WonderTrail is a provisional working name. © LYONS Technologies · Demo prototype
      </footer>
      {picker && <ChildPickerModal onClose={() => setPicker(false)} />}
    </div>
  );
}
