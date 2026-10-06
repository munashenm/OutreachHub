export const SCORECARD_FIELDS = [
  { key: "grossMargin", label: "Gross margin", hint: "5 is a strong margin we can repeat." },
  { key: "moq", label: "Minimum order quantity", hint: "5 means we can buy a small quantity." },
  { key: "feedAvailability", label: "Stock feed or API", hint: "5 means a reliable feed or API with current stock." },
  { key: "deliveryToSouthAfrica", label: "Delivery to South Africa", hint: "5 means a short, reliable lead time into South Africa." },
  { key: "warrantyRma", label: "Warranty and RMA", hint: "5 means a clear warranty and a workable return process." },
  { key: "certifications", label: "Certifications", hint: "5 means the certifications we sell under are in place." },
  { key: "resellerProtection", label: "Reseller protection", hint: "5 means our pricing or territory is protected." },
  { key: "productUniqueness", label: "Product uniqueness", hint: "5 means the range is hard to buy from anyone else." },
  { key: "localCompetition", label: "Local competition", hint: "5 means few local sellers compete on the same products." },
] as const;

export type ScorecardKey = (typeof SCORECARD_FIELDS)[number]["key"];
export type SupplierScores = Record<ScorecardKey, number | null>;
export type SupplierClass = "PREFERRED" | "BACKUP" | "PROJECT_ONLY" | "REJECT" | "UNSCORED";

export const SCORE_WEIGHTS: Record<ScorecardKey, number> = {
  grossMargin: 20,
  moq: 8,
  feedAvailability: 15,
  deliveryToSouthAfrica: 15,
  warrantyRma: 12,
  certifications: 8,
  resellerProtection: 8,
  productUniqueness: 7,
  localCompetition: 7,
};

export const SUPPLIER_CLASS_LABELS: Record<SupplierClass, string> = {
  PREFERRED: "Preferred Supplier",
  BACKUP: "Backup Supplier",
  PROJECT_ONLY: "Project Only",
  REJECT: "Reject",
  UNSCORED: "Not scored yet",
};

export const SUPPLIER_CLASS_TONE: Record<SupplierClass, "green" | "blue" | "amber" | "red" | "slate"> = {
  PREFERRED: "green",
  BACKUP: "blue",
  PROJECT_ONLY: "amber",
  REJECT: "red",
  UNSCORED: "slate",
};

export const SCORECARD_FIELD_SELECT = {
  grossMargin: true,
  moq: true,
  feedAvailability: true,
  deliveryToSouthAfrica: true,
  warrantyRma: true,
  certifications: true,
  resellerProtection: true,
  productUniqueness: true,
  localCompetition: true,
} as const;

export function emptyScores(): SupplierScores {
  return {
    grossMargin: null,
    moq: null,
    feedAvailability: null,
    deliveryToSouthAfrica: null,
    warrantyRma: null,
    certifications: null,
    resellerProtection: null,
    productUniqueness: null,
    localCompetition: null,
  };
}

export function scoresFrom(record: Partial<SupplierScores> | null | undefined): SupplierScores {
  const scores = emptyScores();
  if (!record) return scores;
  for (const field of SCORECARD_FIELDS) {
    const value = record[field.key];
    scores[field.key] = typeof value === "number" ? value : null;
  }
  return scores;
}

export function classFromScorecard(record: Partial<SupplierScores> | null | undefined): SupplierClass {
  return classifySupplier(scoresFrom(record)).supplierClass;
}

export function supplierClassRank(supplierClass: SupplierClass | null | undefined) {
  if (supplierClass === "PREFERRED") return 0;
  if (supplierClass === "BACKUP") return 2;
  if (supplierClass === "PROJECT_ONLY") return 3;
  if (supplierClass === "REJECT") return 4;
  return 1;
}

export function classifySupplier(scores: SupplierScores): { supplierClass: SupplierClass; points: number | null; reason: string } {
  const missing = SCORECARD_FIELDS.some((field) => scores[field.key] == null);
  if (missing) {
    return { supplierClass: "UNSCORED", points: null, reason: "Score every criterion from 1 to 5. The class is calculated after that." };
  }
  const points = Math.round(SCORECARD_FIELDS.reduce((sum, field) => sum + ((scores[field.key] ?? 0) / 5) * SCORE_WEIGHTS[field.key], 0));
  if ((scores.grossMargin ?? 0) <= 1 || (scores.warrantyRma ?? 0) <= 1 || (scores.feedAvailability ?? 0) <= 1) {
    return { supplierClass: "REJECT", points, reason: "Rejected because gross margin, warranty, or the stock feed scored 1." };
  }
  const lowest = Math.min(...SCORECARD_FIELDS.map((field) => scores[field.key] ?? 0));
  if (points >= 80 && lowest >= 3 && (scores.grossMargin ?? 0) >= 4 && (scores.feedAvailability ?? 0) >= 4 && (scores.deliveryToSouthAfrica ?? 0) >= 3) {
    return { supplierClass: "PREFERRED", points, reason: `Preferred supplier. The weighted score is ${points} and every criterion is at least 3.` };
  }
  const limited = (scores.feedAvailability ?? 0) <= 2 || (scores.deliveryToSouthAfrica ?? 0) <= 2 || (scores.moq ?? 0) <= 2;
  if ((scores.productUniqueness ?? 0) >= 4 && limited && points >= 45) {
    return { supplierClass: "PROJECT_ONLY", points, reason: "Project only. The range is distinctive, and the feed, delivery, or minimum order is weak." };
  }
  if (points >= 60) return { supplierClass: "BACKUP", points, reason: `Backup supplier. The weighted score is ${points}.` };
  if (points >= 45) return { supplierClass: "PROJECT_ONLY", points, reason: `Project only. The weighted score is ${points}, below a standing backup.` };
  return { supplierClass: "REJECT", points, reason: `Rejected because the weighted score is ${points}.` };
}
