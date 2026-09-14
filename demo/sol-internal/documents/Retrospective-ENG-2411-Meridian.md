# Engagement Retrospective — ENG-2411

**Client:** Meridian Media Group · **Engagement:** FAST channel migration
**Held:** 8 September 2026 · **Facilitated by:** Dan Okafor
**Present:** Marcus Bell, Priya Shah, Joe Duffy, two of the build team

---

## Outcome

Delivered. All fourteen channels migrated, launch time down from eleven weeks to **nine days**, comfortably inside the three-week commitment. Meridian's channel ops team has run two launches unaided.

Client satisfaction is high and Marcus expects a follow-on conversation about their video-on-demand estate in Q1.

**Margin came in at 31% against a 38% target.** That gap is what most of this retrospective is about.

## What went well

- The assessment phase was worth every week. Discovering that three channels used non-standard SCTE-35 markers in week two rather than week fourteen saved the migration sequence.
- Priya's decision to migrate the two lowest-revenue channels first gave the team a real rehearsal before anything valuable moved.
- Joe's relationship with Meridian's ad-ops lead meant the ad-decision integration got tested against real traffic three weeks earlier than planned.

## Why the margin missed

Three causes, in order of size.

### 1. The staffing model in the SOW no longer exists (≈4 points)

The fixed fee was priced at a **£118 blended rate assuming 40% of build hours from the Hyderabad build pool**. That pool was wound down at the end of June 2026 as part of the move to an onshore-plus-partner model. Every build hour after week 12 was delivered onshore at a materially higher cost, against a fee that had already been fixed.

Nobody did anything wrong during delivery. The price was simply built on a delivery model the firm stopped running three months into a six-month engagement.

> **If you are reusing this SOW, do not reuse its pricing.** The current rate card (effective 1 July 2026) is the only valid basis. Re-pricing this same scope under the current model lands near **£560,000**, not £485,000.

### 2. Metadata remediation crept in (≈2 points)

Section 2 explicitly excluded metadata remediation. In practice, four channels could not migrate without it, and the team did roughly three weeks of remediation without raising a change request, because it felt small each time it came up.

The lesson is not "be stricter". It is that a scope exclusion nobody re-reads after signature is an exclusion in name only. The delivery lead should walk the exclusion list at the end of assessment, when the team knows enough to say which ones are going to be tested.

### 3. A distribution platform changed its API (≈1 point)

Assumption 4.2 allowed for two platform API changes and we got three. The third arrived in week 19 and cost about a week. This one was genuinely covered by the change-control clause and we chose not to invoke it for relationship reasons, which was a reasonable call made with open eyes.

## What we would tell the next team

- **Re-price from the current rate card, always.** Lifting a fee from a prior SOW carries the staffing model it was built on, and that model has changed twice in eighteen months.
- Walk the exclusions list at the end of assessment and convert the doubtful ones into change requests before anyone is emotionally committed.
- The nine-day launch figure is a genuine reference and Meridian have agreed we may cite it. Use it.
- Hypercare at two weeks was too short for a client whose ops team was learning the stack. Four weeks next time, priced in.

## Actions

| Action | Owner | By |
| --- | --- | --- |
| Add a pricing-basis warning to the SOW template | Marcus Bell | 30 Sep 2026 |
| Write up the nine-day launch as a reference story | Joe Duffy | 15 Oct 2026 |
| Propose four-week hypercare as standard for ops handovers | Priya Shah | 30 Sep 2026 |

---

*Retrospectives are written for the next team, not for the file. If you are about to propose similar work, read the margin section first.*
