import { extractProductRequirements, parseRequirementFragment, type ProductRequirement } from "../sourcing";
import type { RfqAnalysis } from "./rfq-analyzer";

export function requirementsForSourcing(text: string, analysis: RfqAnalysis | null): ProductRequirement[] {
  const parsed = extractProductRequirements(text);
  if (parsed.length > 0 || !analysis) return parsed;
  return analysis.items.flatMap((item) => {
    if (!item.description) return [];
    const requirement = parseRequirementFragment(item.description);
    if (!requirement) return [];
    return [{
      ...requirement,
      quantity: requirement.quantity ?? item.quantity,
      brandPreference: requirement.brandPreference || item.brand,
      model: requirement.model || item.model,
      sku: requirement.sku || item.sku,
      mpn: requirement.mpn || item.mpn,
      productType: requirement.productType || item.category,
      requestedText: item.description,
    }];
  });
}
