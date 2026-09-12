import { redirect } from "next/navigation";

// Home is the single answer to "how is it doing".
//
// This page and /health both opened with the same conversation count and the same
// sentiment split, so an owner had to read both to find out which one to trust —
// and the richer half (what people ask most, what it could not answer) was only
// on Home. The kept route redirects rather than 404s, because it was in the nav
// long enough to be bookmarked.
export default function DashboardPage() {
  redirect("/health");
}
