import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  // No signup-door intent to capture: upstream, ?type=saas told onboarding which
  // console to build. This product only has one, so the type is a constant.
  // Grader hand-off: the site the visitor just had graded, so onboarding can
  // auto-set-up from it instead of asking for the website again.
  const site = request.nextUrl.searchParams.get("site");
  if (site && site.includes(".") && site.length <= 300) {
    response.cookies.set("ar_intent_site", site, { path: "/", maxAge: 3600, sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all paths except static assets and image optimization files.
     * Auth cookie refresh must happen on navigations and API/route handlers.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
