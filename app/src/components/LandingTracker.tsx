"use client";
import { useEffect } from "react";
import { track } from "@/lib/visitor";

export function LandingTracker({ variant }: { variant: string }) {
  useEffect(() => {
    track("page_view", variant);
  }, [variant]);
  return null;
}
