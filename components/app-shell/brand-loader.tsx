import { SunMark } from "@/components/app-shell/sun-mark";
import { cn } from "@/lib/utils";

/**
 * Branded loading state — Sol's badge, with a ring turning around it. Used as the
 * route-transition overlay (app/(app)/loading.tsx) and anywhere a page waits.
 *
 * The ring turns rather than the badge: the mark carries the sun motif and reads
 * as itself only the right way up, so spinning it would be a small piece of brand
 * vandalism on the screen people see most often.
 */
export function BrandLoader({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[70dvh] w-full flex-col items-center justify-center gap-5",
        className,
      )}
    >
      <div className="relative grid size-20 place-items-center">
        {/* the turning ring, in Sol orange */}
        <span
          className="absolute inset-0 animate-spin rounded-full border-4"
          style={{ borderColor: "var(--sol-orange-pale)", borderTopColor: "var(--sol-orange)" }}
        />
        {/* a soft warmth behind the badge */}
        <span
          className="absolute inset-1 rounded-full blur-md"
          style={{ background: "color-mix(in srgb, var(--sol-orange) 12%, transparent)" }}
        />
        <SunMark className="animate-bob w-9" />
      </div>
      <p className="text-muted-foreground animate-pulse text-sm">{label}</p>
    </div>
  );
}
