import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Inter. All UI, body and data. Sol's body face.
// The CSS variable keeps its old name so the ~200 call sites reading
// var(--font-dm-sans) and the Tailwind `sans` family keep resolving.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

// Outfit. Sol's display face: a geometric sans whose "O" is a near-perfect
// circle, matching the sun motif the brand is built on. Bold weights only,
// and never italic, which is what the upstream serif was set in.
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Assistant",
  description: "Console for The Assistant, the AI agent that answers questions and takes action in the systems your team already uses. By Sol Consulting.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
