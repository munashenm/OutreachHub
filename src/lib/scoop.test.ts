import assert from "node:assert/strict";
import test from "node:test";
import { isScoopFeedUrl, isScoopPriceList, parseScoopPriceList } from "./scoop";

const csv = [
  "SKU,Description,CPT,JHB,DBN,Total Stock,Dealer Price,Retail Price,Manufacturer,Image URL",
  "FLY-2G,Linkbasic 2 Meter UTP Cat5e Flylead Green,444,244,14,702,R 25,R 36,LinkBasic,https://scoop.co.za/download/marketing/images/FLY-2G.jpg",
  "CAB-12UO,Scoop 12U outdoor cabinet,19,11,0,,\"R1,225.00\",\"R4,775.00\",Scoop,https://scoop.co.za/download/marketing/images/CAB-12UO.jpg",
  "NO-COST,Missing dealer price,1,0,0,1,,R 99,Scoop,",
].join("\n");

test("reads a Scoop CSV price list from the dealer price and total stock", () => {
  assert.equal(isScoopPriceList(csv), true);
  assert.equal(isScoopFeedUrl("https://scoop.co.za/media/pricelist.csv"), true);
  assert.equal(isScoopFeedUrl("https://example.com/feed.json"), false);
  const parsed = parseScoopPriceList(csv);
  assert.equal(parsed.error, null);
  assert.equal(parsed.costsAreExclusive, true);
  assert.equal(parsed.offers.length, 3);
  const fly = parsed.offers[0];
  assert.equal(fly?.supplierSku, "FLY-2G");
  assert.equal(fly?.costCents, 2500);
  assert.equal(fly?.stockQty, 702);
  assert.equal(fly?.brand, "LinkBasic");
  assert.equal(fly?.name, "Linkbasic 2 Meter UTP Cat5e Flylead Green");
  assert.equal(fly?.imageUrls[0], "https://scoop.co.za/download/marketing/images/FLY-2G.jpg");
  assert.equal(fly?.manufacturerPartNumber, "");
  const cabinet = parsed.offers[1];
  assert.equal(cabinet?.costCents, 122500);
  assert.equal(cabinet?.stockQty, 30);
  const missing = parsed.offers[2];
  assert.equal(missing?.costCents, null);
  assert.equal(missing?.stockQty, 1);
});

test("reads the same Scoop columns from XML and ignores retail price", () => {
  const xml = `<?xml version="1.0"?><products><product><SKU>FLY-2G</SKU><Description>Flylead</Description><CPT>1</CPT><JHB>2</JHB><DBN>3</DBN><DealerPrice>R 25.50</DealerPrice><RetailPrice>R 99.00</RetailPrice><Manufacturer>LinkBasic</Manufacturer></product></products>`;
  const parsed = parseScoopPriceList(xml);
  assert.equal(parsed.error, null);
  assert.equal(parsed.offers.length, 1);
  assert.equal(parsed.offers[0]?.costCents, 2550);
  assert.equal(parsed.offers[0]?.stockQty, 6);
});

test("rejects an HTML page saved as the Scoop feed", () => {
  const parsed = parseScoopPriceList("<html><body>Just a moment</body></html>");
  assert.equal(parsed.offers.length, 0);
  assert.match(parsed.error ?? "", /CSV or XML/);
});
