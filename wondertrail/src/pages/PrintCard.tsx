import { ArrowLeft, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { DemoBanner } from "../components/Layout";
import { PrintableMissionCard } from "../components/PrintableMissionCard";
import { missionBySlug } from "../data/missions";
import NotFound from "./NotFound";

export default function PrintCard() {
  const { slug } = useParams();
  const mission = missionBySlug(slug);
  if (!mission) return <NotFound />;
  return (
    <div className="min-h-screen pb-10">
      <DemoBanner />
      <div className="no-print mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4">
        <Link to={`/missions/${mission.slug}`} className="btn-ghost -ml-3 px-3">
          <ArrowLeft aria-hidden className="h-5 w-5" /> Back to mission
        </Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          <Printer aria-hidden className="h-5 w-5" /> Print this card
        </button>
      </div>
      <main id="main" className="px-4">
        <PrintableMissionCard mission={mission} />
      </main>
    </div>
  );
}
