import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout, ParentOnly } from "./components/Layout";
import Adventure from "./pages/Adventure";
import Explore from "./pages/Explore";
import MissionPage from "./pages/MissionPage";
import NotFound from "./pages/NotFound";
import ParentHome from "./pages/ParentHome";
import Portfolio from "./pages/Portfolio";
import PrintCard from "./pages/PrintCard";
import Reviews from "./pages/Reviews";
import Settings from "./pages/Settings";
import Submit from "./pages/Submit";
import Welcome from "./pages/Welcome";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo?.(0, 0), [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/missions/:slug/print" element={<PrintCard />} />
        <Route element={<Layout />}>
          <Route path="/parent" element={<ParentOnly><ParentHome /></ParentOnly>} />
          <Route path="/parent/reviews" element={<ParentOnly><Reviews /></ParentOnly>} />
          <Route path="/settings" element={<ParentOnly><Settings /></ParentOnly>} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/missions/:slug" element={<MissionPage />} />
          <Route path="/missions/:slug/submit" element={<Submit />} />
          <Route path="/adventure" element={<Adventure />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
