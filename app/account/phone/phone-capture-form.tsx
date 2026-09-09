"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveAccountPhone } from "./actions";
import { DIAL_CODES, combineDial } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/**
 * Account phone capture — a country-code picker + local number, combined into
 * E.164 (reusing lib/phone). Saved to the auth identity so the assistant recognizes the
 * person on WhatsApp. No SMS is sent; this is a one-field step the account gate
 * requires once.
 */
export function PhoneCaptureForm() {
  const [dial, setDial] = useState("+1");
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const full = combineDial(dial, local);
    if (!full) { toast.error("Enter your phone number"); return; }
    setBusy(true);
    const res = await saveAccountPhone(full);
    if (!res.ok) {
      setBusy(false);
      toast.error("Couldn't save your number", { description: res.error });
      return;
    }
    // Full navigation so the layout re-reads the refreshed session (phone now set).
    window.location.assign("/");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="phone">Phone number</Label>
        <div className="flex gap-2">
          <select
            value={dial}
            onChange={(e) => setDial(e.target.value)}
            aria-label="Country code"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {DIAL_CODES.map((c) => (
              <option key={c.dial} value={c.dial}>{c.flag} {c.dial}</option>
            ))}
          </select>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="512 555 0142"
            required
            className="flex-1"
          />
        </div>
        <p className="text-muted-foreground text-xs">We use it to recognize you on WhatsApp. No SMS is sent.</p>
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} Save &amp; continue
      </Button>
    </form>
  );
}
