// When a standing instruction should next be carried out.
//
// Its own module because two callers need the same answer and must not disagree:
// the runner, to claim a row, and the console, to tell an owner when their job
// will next fire. A schedule that says one thing on screen and does another is
// worse than no schedule shown at all.

/**
 * The next time to run, as a UTC instant.
 *
 * Walks forward hour by hour and asks Intl what the local hour would be, rather
 * than doing offset arithmetic. It is a few dozen comparisons and it is right
 * across daylight saving, which offset arithmetic quietly is not — a "9am" job
 * that silently becomes 8am for half the year is the kind of bug nobody reports
 * and everybody stops trusting.
 */
export function nextRun(from: Date, schedule: string, atHour: number, tz: string): Date {
  if (schedule === "hourly") return new Date(from.getTime() + 3600_000);

  const parts = (d: Date) => {
    try {
      const f = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, hour: "numeric", minute: "numeric", weekday: "short", hour12: false,
      }).formatToParts(d);
      return {
        hour: Number(f.find((p) => p.type === "hour")?.value ?? "-1"),
        minute: Number(f.find((p) => p.type === "minute")?.value ?? "0"),
        weekday: f.find((p) => p.type === "weekday")?.value ?? "",
      };
    } catch {
      return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: "" };
    }
  };

  // Step forward in whole hours looking for the right local hour, then subtract
  // the local minutes to land on the hour itself. The subtraction is the part
  // that is easy to leave out: zones offset by half an hour (India, Iran, parts
  // of Australia) are never on a whole UTC hour, so without it a "9am" job runs
  // at 9:30 there — right in testing from London, wrong for the client.
  const start = new Date(from.getTime() + 3600_000);
  start.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    const at = new Date(start.getTime() + i * 3600_000);
    const p = parts(at);
    if (p.hour !== atHour) continue;
    if (schedule === "weekdays" && (p.weekday === "Sat" || p.weekday === "Sun")) continue;
    const snapped = new Date(at.getTime() - p.minute * 60_000);
    // Snapping backwards can land on or before `from`; that slot has passed.
    if (snapped.getTime() <= from.getTime()) continue;
    return snapped;
  }
  // Unreachable for the schedules above; a day from now beats looping forever.
  return new Date(from.getTime() + 86400_000);
}
