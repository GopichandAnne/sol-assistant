// Transactional email from edge functions (low-credit warnings, responder
// notifications). Any SMTP provider: set SMTP_HOST / SMTP_USER / SMTP_PASSWORD.
//
// Upstream this was hardcoded to smtp.gmail.com and read GMAIL_USER /
// GMAIL_APP_PASSWORD. That tied the product's outbound mail to a personal Gmail
// account, which is not something a business sends from. The host is now
// configuration, so this works with Microsoft 365, a transactional provider, or
// a self-hosted relay without touching code.
//
// Microsoft 365:  SMTP_HOST=smtp.office365.com  SMTP_PORT=587
// Google Workspace: SMTP_HOST=smtp.gmail.com    SMTP_PORT=465
//
// Nothing configured -> no-op (logged), like the rest of the best-effort notify
// path. A missing mail setup must never break a chat or a metered turn.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** Read SMTP settings, falling back to the legacy GMAIL_* names so an existing
 *  deployment configured the old way keeps sending. Returns null when unset. */
function config(): SmtpConfig | null {
  const user = Deno.env.get("SMTP_USER") ?? Deno.env.get("GMAIL_USER") ?? "";
  const pass = Deno.env.get("SMTP_PASSWORD") ?? Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
  if (!user || !pass) return null;
  const host = Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com";
  const port = parseInt(Deno.env.get("SMTP_PORT") ?? "465", 10);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 465,
    user,
    pass,
    // The envelope sender. Defaults to the login, which is what most providers
    // require anyway; set SMTP_FROM when the account may send as another address.
    from: Deno.env.get("SMTP_FROM") ?? user,
  };
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  fromName?: string,
): Promise<boolean> {
  const cfg = config();
  if (!cfg) {
    console.warn("[email] SMTP_USER/SMTP_PASSWORD not set — skipping email");
    return false;
  }
  // Brand the From per account when given a name. Strip header-breaking chars.
  const disp = (fromName ? `${fromName} via The Assistant` : "The Assistant")
    .replace(/["<>\r\n]/g, "").trim() || "The Assistant";
  const client = new SMTPClient({
    connection: {
      hostname: cfg.host,
      port: cfg.port,
      // 465 is implicit TLS. 587 and 25 start plaintext and upgrade via STARTTLS,
      // which denomailer negotiates when tls is false.
      tls: cfg.port === 465,
      auth: { username: cfg.user, password: cfg.pass },
    },
  });
  try {
    await client.send({ from: `"${disp}" <${cfg.from}>`, to, subject, content: body });
    return true;
  } catch (e) {
    console.error(`[email] send to ${to} failed: ${e instanceof Error ? e.message : e}`);
    return false;
  } finally {
    try {
      await client.close();
    } catch { /* ignore */ }
  }
}
