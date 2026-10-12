import { emptyRequirement, extractProductRequirements, mergeRequirementLists, parseRequirementFragment, type ProductRequirement } from "../sourcing";
import type { RfqAnalysis, RfqAnalysisItem } from "./rfq-analyzer";

const ACCESSORY_TYPES = new Set(["Power supply", "Charger", "Adapter", "Cable", "Dock"]);

export function requirementsForSourcing(text: string, analysis: RfqAnalysis | null): ProductRequirement[] {
  const deterministic = extractProductRequirements(text);
  if (!analysis || analysis.items.length === 0) return deterministic;
  const fromModel = analysis.items.flatMap((item) => {
    const requirement = requirementFromAnalysisItem(item);
    return requirement ? [requirement] : [];
  });
  if (fromModel.length === 0) return deterministic;
  const identified = deterministic.filter((item) => item.productType || item.model || item.sku || item.mpn);
  const quantityOnly = deterministic.find((item) => item.quantity != null && !item.productType && !item.model && !item.sku && !item.mpn);
  const first = fromModel[0];
  const primary = fromModel.length === 1 && first && first.quantity == null && quantityOnly?.quantity != null
    ? [{ ...first, quantity: quantityOnly.quantity }]
    : fromModel;
  return mergeRequirementLists(primary, identified);
}

function requirementFromAnalysisItem(item: RfqAnalysisItem): ProductRequirement | null {
  const requested = [
    item.quantity ? `${item.quantity} x` : "",
    item.brand,
    item.model,
    item.category,
    [...item.specifications, ...item.mandatorySpecifications].join(", "),
  ].filter(Boolean).join(" ").slice(0, 800);
  const parsed = parseRequirementFragment(requested) ?? emptyRequirement(requested);
  const productType = productTypeFromCategory(item.category) || parsed.productType;
  const requirement: ProductRequirement = {
    ...parsed,
    quantity: item.quantity ?? parsed.quantity,
    brandPreference: item.brand || parsed.brandPreference,
    model: item.model || parsed.model,
    sku: item.sku || parsed.sku,
    mpn: item.mpn || parsed.mpn,
    productType,
    requestedText: requested,
    otherRequirements: [...item.preferences, ...item.uncertainties].filter(Boolean).join("; ").slice(0, 300),
  };
  if (ACCESSORY_TYPES.has(requirement.productType)) {
    requirement.processor = "";
    requirement.processorGeneration = "";
    requirement.ramGb = null;
    requirement.storageGb = null;
    requirement.storageType = "";
    requirement.screenInches = null;
    requirement.operatingSystem = "";
    requirement.graphics = "";
    requirement.formFactor = "";
  }
  if (requirement.quantity == null && !requirement.model && !requirement.sku && !requirement.mpn && !requirement.productType) return null;
  return requirement;
}

function productTypeFromCategory(category: string) {
  const text = category.toLowerCase();
  if (/\bpower\s+suppl/.test(text)) return "Power supply";
  if (/\bchargers?\b/.test(text)) return "Charger";
  if (/\badapters?\b/.test(text)) return "Adapter";
  if (/\bcables?\b/.test(text)) return "Cable";
  if (/\bdocks?\b/.test(text)) return "Dock";
  if (/\blaptops?|notebooks?\b/.test(text)) return "Laptop";
  if (/\bworkstations?\b/.test(text)) return "Workstation";
  if (/\bservers?\b/.test(text)) return "Server";
  if (/\bswitches?\b/.test(text)) return "Switch";
  if (/\bmonitors?\b/.test(text)) return "Monitor";
  if (/\bprinters?\b/.test(text)) return "Printer";
  if (/\bdesks?\b/.test(text)) return "Desk";
  return "";
}
