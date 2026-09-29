"use client";

import { buttonSecondary } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" className={`${buttonSecondary} print:hidden`} onClick={() => window.print()}>
      Print
    </button>
  );
}
