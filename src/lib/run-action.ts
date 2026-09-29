import { unstable_rethrow } from "next/navigation";
import { AppError } from "@/lib/errors";
import type { ActionState } from "@/lib/format";

export async function runAction(work: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await work()) ?? {};
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError) return { error: error.message };
    console.error(error);
    return { error: "Something went wrong. Please try again." };
  }
}
