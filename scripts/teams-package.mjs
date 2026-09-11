#!/usr/bin/env node
/**
 * Build the Microsoft Teams app package.
 *
 *   node scripts/teams-package.mjs <app-id> [--name "The Assistant"] [--out dist]
 *
 * Teams installs a zip containing a manifest and two icons. Nothing about it is
 * per-customer except the name and the icons, because the bot identity is ours:
 * one app registration, marked multi-tenant, that every client's tenant consents
 * to rather than re-creates. So this is built once and handed to each client's
 * Teams administrator to upload — or, later, submitted to the Teams store so even
 * that step disappears.
 *
 * The icons are generated from Sol's own badge rather than drawn here, and the
 * outline icon is what Teams shows in the rail: it must be a single-colour
 * silhouette on transparency, so it is built as the sun disc alone. A colour icon
 * used as the outline is the usual reason a Teams app looks broken in the sidebar.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import JSZip from "jszip";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const appId = process.argv[2];
if (!appId || !/^[0-9a-f-]{36}$/i.test(appId)) {
  console.error("Usage: node scripts/teams-package.mjs <app-id-guid> [--name ...] [--out ...]");
  console.error("The app id is the Application (client) ID from the Entra app registration.");
  process.exit(1);
}

const name = arg("--name", "The Assistant");
const outDir = join(root, arg("--out", "dist/teams"));
const badge = join(root, "public/brand/logo-sol-circle-orange.png");
if (!existsSync(badge)) {
  console.error(`Brand badge not found at ${badge}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// Teams' own schema. `bots` with scopes personal + team + groupChat is what lets
// one presence answer in a DM, in a channel when @mentioned, and in a group chat —
// which is what makes several assistants behind one app possible.
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
      scopes: ["personal", "team", "groupChat"],
      supportsFiles: false,
      isNotificationOnly: false,
      commandLists: [
        {
          scopes: ["personal"],
          commands: [
            { title: "What can you do?", description: "See what this assistant can answer and act on" },
            { title: "Find a document", description: "Search the organisation's files" },
            { title: "What's on today?", description: "Your own calendar for the day" },
          ],
        },
      ],
    },
  ],
  permissions: ["identity", "messageTeamMembers"],
  // What makes single sign-on possible: Teams will only mint a token for an app
  // that declares its own API here, and `resource` must match the App ID URI on
  // the registration EXACTLY — a trailing slash is enough to make Teams hand back
  // a token with the wrong audience and the exchange then fails silently.
  webApplicationInfo: { id: appId, resource: `api://${appId}` },
  // The tenants allowed to install it. Left open because the app is multi-tenant
  // by design; a client that wants it locked to their own directory restricts it
  // in their own admin centre, not here.
  validDomains: [],
};

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// color.png — 192x192, may be full-bleed colour.
await sharp(badge).resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toFile(join(outDir, "color.png"));

// outline.png — 32x32, transparent, single colour. Teams tints it, so shape is all
// that survives: the sun disc, which is the part of the mark that reads at 32px.
const disc = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
     <circle cx="16" cy="16" r="13" fill="none" stroke="#ffffff" stroke-width="3"/>
     <circle cx="16" cy="16" r="5" fill="#ffffff"/>
   </svg>`,
);
await sharp(disc).png().toFile(join(outDir, "outline.png"));

const zipPath = join(outDir, "the-assistant-teams.zip");
const zip = new JSZip();
// Flat, at the root of the zip — Teams rejects a package whose manifest sits in a
// subfolder, which is the single most common packaging mistake.
for (const f of ["manifest.json", "color.png", "outline.png"]) {
  zip.file(f, readFileSync(join(outDir, f)));
}
writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

console.log(`Teams package written: ${zipPath}`);
console.log(`  app id: ${appId}`);
console.log(`  name:   ${name}`);
console.log("Upload it in Teams admin centre → Teams apps → Manage apps → Upload new app.");
