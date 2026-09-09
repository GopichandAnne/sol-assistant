import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { listCompanies, listUnassignedStores } from "./actions";
import { CompaniesAdmin } from "./companies-admin";

export const metadata: Metadata = { title: "Accounts · SOL Assistant" };
export const dynamic = "force-dynamic";

export default async function CompaniesAdminPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.isPlatformAdmin) redirect("/");

  const [companies, unassigned] = await Promise.all([listCompanies(), listUnassignedStores()]);
  return <CompaniesAdmin companies={companies} unassigned={unassigned} />;
}
