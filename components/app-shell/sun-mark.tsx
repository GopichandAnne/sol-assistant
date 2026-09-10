import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Sol's badge, for anywhere the product needs a mark on its own — the loader, an
 * empty state, a small avatar next to the product name.
 *
 * This replaces the teal robot mascot the console inherited. That mascot belonged
 * to the product this one was carved out of; it was still what the app showed
 * while a page loaded and what sat in the browser tab, which meant the first and
 * last thing anyone saw was another company's character.
 *
 * The badge is Sol's own asset used unmodified, exactly as the wordmark uses it.
 * The circle in SOL is the sun, and the design system asks that the motif be
 * preserved rather than redrawn — so it is never traced into SVG here, however
 * convenient that would be for animating it. Animate the ring around it instead.
 */
export function SunMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/logo-sol-circle-orange.png"
      alt=""
      width={1000}
      height={1000}
      priority
      className={cn("block shrink-0 rounded-full", className)}
    />
  );
}
