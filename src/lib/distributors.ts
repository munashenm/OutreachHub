export type DistributorPreset = {
  name: string;
  country: string;
  notes: string;
};

const FEED_LATER = "Automatic sync stays off until a price-list address is saved. A CSV, XML, or XLSX file can be uploaded instead.";

export const SOUTH_AFRICAN_DISTRIBUTORS: DistributorPreset[] = [
  { name: "Miro", country: "South Africa", notes: FEED_LATER },
  { name: "Scoop", country: "South Africa", notes: "Scoop uses its own CSV or XML price list. The dealer price excluding VAT is the cost, and total stock is the available quantity. Another supplier does not use these columns." },
  { name: "Pinnacle", country: "South Africa", notes: FEED_LATER },
  { name: "Frontosa", country: "South Africa", notes: "Frontosa uses its catalogue and stock JSON feeds and needs a token. The feed stays off until that token is saved." },
  { name: "SMD Technologies", country: "South Africa", notes: FEED_LATER },
  { name: "Mustek", country: "South Africa", notes: FEED_LATER },
  { name: "Astrum", country: "South Africa", notes: FEED_LATER },
  { name: "DCC", country: "South Africa", notes: "DCC Technologies. The feed stays off until a price-list address is saved." },
  { name: "Axiz", country: "South Africa", notes: FEED_LATER },
  { name: "Rectron", country: "South Africa", notes: FEED_LATER },
  { name: "Tarsus", country: "South Africa", notes: FEED_LATER },
  { name: "Linkqage", country: "South Africa", notes: FEED_LATER },
  { name: "First Distribution", country: "South Africa", notes: FEED_LATER },
  { name: "Syntech", country: "South Africa", notes: FEED_LATER },
];

const ALIASES: Record<string, string> = {
  axis: "axiz",
  smdtecnologies: "smdtechnologies",
  firstdistrubution: "firstdistribution",
  dcctechnologies: "dcc",
  syntechdistribution: "syntech",
  tarsusdistribution: "tarsus",
  mirodistribution: "miro",
  pinnacleafrica: "pinnacle",
};

export function distributorKey(name: string) {
  const compact = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIASES[compact] ?? compact;
}

export function missingDistributors(existingNames: string[]) {
  const present = new Set(existingNames.map(distributorKey));
  return SOUTH_AFRICAN_DISTRIBUTORS.filter((distributor) => !present.has(distributorKey(distributor.name)));
}
