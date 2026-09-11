import { NextResponse } from "next/server";
import JSZip from "jszip";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getActiveStore } from "@/lib/store/active-store";

/**
 * The Teams app package, built on demand.
 *
 * A client's Teams administrator uploads a zip: a manifest naming our bot, plus
 * two icons. Nothing in it is secret and nothing in it is per-tenant — the bot
 * identity is ours, registered once — so the only thing that varies is the name
 * on the tile, which is why this can be generated rather than kept as a file
 * somebody remembers to update.
 *
 * Generated here rather than by the script in scripts/ so that setting a client
 * up never requires a developer with the repo checked out. Owner-only: it is not
 * sensitive, but it is part of a paid setup and there is no reason to serve it
 * to anyone who asks.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getActiveStore();
  if (!ctx?.active) return new NextResponse("Not signed in", { status: 401 });
  if (!(ctx.active.role === "owner" || ctx.isPlatformAdmin)) {
    return new NextResponse("Owners only", { status: 403 });
  }

  const appId = process.env.MICROSOFT_APP_ID;
  if (!appId) {
    return NextResponse.json(
      { error: "Teams isn't configured yet — MICROSOFT_APP_ID isn't set." },
      { status: 503 },
    );
  }

  // The tile name. Defaults to the assistant's own name, which is what a
  // colleague will look for in Teams; ?name= lets it be overridden per client.
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") || ctx.active.name).slice(0, 30).trim() || "Assistant";

  const manifest = {
    $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "1.0.0",
    id: appId,
    developer: {
      name: "Sol Consulting",
      websiteUrl: "https://www.wearesol.com",
      privacyUrl: "https://www.wearesol.com/privacy",
      termsOfUseUrl: "https://www.wearesol.com/terms",
    },
    icons: { color: "color.png", outline: "outline.png" },
    name: { short: name, full: `${name} by Sol Consulting` },
    description: {
      short: "Answers from your own material, and acts in your own systems.",
      full:
        "Ask it a question and it answers from your organisation's own documents and policies. " +
        "Ask it to do something and it acts in the systems you have connected — with anything " +
        "consequential held for a named person to approve. When it cannot answer, it reaches a " +
        "colleague and brings their answer back to you.",
    },
    accentColor: "#E05A2B",
    bots: [
      {
        botId: appId,
        // personal + team + groupChat is what lets one presence answer in a DM, in
        // a channel when mentioned, and in a group chat — and therefore what lets
        // several assistants sit behind a single installed app.
        scopes: ["personal", "team", "groupChat"],
        supportsFiles: false,
        isNotificationOnly: false,
      },
    ],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [],
  };

  const badge = join(process.cwd(), "public", "brand", "logo-sol-circle-orange.png");
  const source = await readFile(badge);

  // color.png may be full-bleed. outline.png is tinted by Teams, so only its shape
  // survives — a colour icon used there is the usual reason an app looks broken in
  // the sidebar, hence the plain sun disc.
  const color = await sharp(source)
    .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const outline = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
         <circle cx="16" cy="16" r="13" fill="none" stroke="#ffffff" stroke-width="3"/>
         <circle cx="16" cy="16" r="5" fill="#ffffff"/>
       </svg>`,
    ),
  ).png().toBuffer();

  const zip = new JSZip();
  // Flat at the root. Teams rejects a package whose manifest sits in a subfolder,
  // which is the single most common packaging mistake.
  zip.file("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  zip.file("color.png", color);
  zip.file("outline.png", outline);
  const body = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "assistant"}-teams.zip`;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
    },
  });
}
