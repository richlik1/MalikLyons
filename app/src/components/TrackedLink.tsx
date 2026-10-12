"use client";
import { track } from "@/lib/visitor";

export function TrackedLink({ href, className, children, variant }: { href: string; className?: string; children: React.ReactNode; variant: string }) {
  return (
    <a href={href} className={className} onClick={() => track("cta_click", variant)}>
      {children}
    </a>
  );
}
