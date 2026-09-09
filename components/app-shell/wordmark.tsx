import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The Assistant, by Sol Consulting.
 *
 * The circular badge is Sol's own logo asset, used unmodified: the "O" in SOL is
 * a perfect circle standing for the sun, and the design system asks that the
 * circle and the motif be preserved rather than redrawn. The badge carries its
 * own orange ground, so it reads correctly on light and dark surfaces alike and
 * needs no per-theme variant.
 *
 * The product name is set in Outfit, Sol's display face. Sentence case, no
 * italic: the upstream wordmark was an italic serif, which is not Sol.
 */
export function Wordmark({
  className,
  withIcon = true,
}: {
  className?: string;
  withIcon?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-display text-foreground inline-flex items-center gap-2 text-xl leading-none",
        className,
      )}
    >
      {withIcon && (
        <Image
          src="/brand/logo-sol-circle-orange.png"
          alt=""
          width={1000}
          height={1000}
          priority
          className="h-[1.15em] w-[1.15em] shrink-0 rounded-full"
        />
      )}
      The Assistant
    </span>
  );
}
