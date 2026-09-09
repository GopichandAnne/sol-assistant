"use client";

import { useState } from "react";
import { TemplatePicker } from "./template-picker";
import { WelcomeChat } from "./welcome-chat";

/**
 * First run: pick a blueprint, or describe the job.
 *
 * The picker leads because recognising a job in a list is faster than describing
 * one, and it is what makes setup possible for someone who does not work in
 * software. The conversation is the fallback for a job that is not on the list,
 * not the default path everyone has to walk.
 */
export function WelcomeStart({ email }: { email: string | null }) {
  const [describe, setDescribe] = useState(false);
  if (describe) return <WelcomeChat email={email} />;
  return <TemplatePicker onDescribe={() => setDescribe(true)} />;
}
