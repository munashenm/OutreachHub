import assert from "node:assert/strict";
import test from "node:test";
import { frontosaFeedUrls, isFrontosaFeed, joinFrontosaFeeds, redactSecrets } from "./frontosa";

const catalogue = JSON.stringify({
  version: 2,
  items: [
    {
      code: "NB-14",
      brand: "Lenovo",
      category: "Notebooks",
      description: "Lenovo ThinkPad E14",
      specifications: "Intel Core i5, 16GB RAM, 512GB SSD, Windows 11 Pro, 14 inch",
      images: ["https://cdn.example.com/e14.jpg"],
      barcode: "6001234567890",
      warranty: "1 Year",
      price: 10000,
    },
    { brand: "HP" },
  ],
});

const stock = JSON.stringify({
  items: [
    {
      code: "NB-14",
      branches: [{ branch: "Johannesburg", qty: 2 }, { branch: "Cape Town", qty: 4 }],
      additional_stock: true,
    },
  ],
});

test("joins the Frontosa catalogue and stock feeds by product code", () => {
  const joined = joinFrontosaFeeds(catalogue, stock);
  assert.equal(joined.error, null);
  assert.equal(joined.skipped, 1);
  assert.equal(joined.offers.length, 1);
  const offer = joined.offers[0];
  assert.equal(offer?.supplierSku, "NB-14");
  assert.equal(offer?.brand, "Lenovo");
  assert.equal(offer?.category, "Notebooks");
  assert.equal(offer?.costCents, 1000000);
  assert.equal(offer?.stockQty, 6);
  assert.match(offer?.specifications ?? "", /16GB RAM/);
  assert.match(offer?.specifications ?? "", /Barcode: 6001234567890/);
  assert.match(offer?.specifications ?? "", /Warranty: 1 Year/);
  assert.match(offer?.specifications ?? "", /Additional stock: yes/);
  assert.deepEqual(offer?.imageUrls, ["https://cdn.example.com/e14.jpg"]);
});

test("reports a rejected Frontosa token without repeating it", () => {
  const notice = JSON.stringify({ notice: "The token provided is not valid.", items: [] });
  const joined = joinFrontosaFeeds(notice, notice);
  assert.equal(joined.error, "The Frontosa token was rejected.");
  const secret = "live-token-value";
  const urls = frontosaFeedUrls(secret);
  assert.equal(isFrontosaFeed(urls.catalogue), true);
  assert.equal(redactSecrets(`fetch failed ${urls.catalogue}`, secret).includes(secret), false);
});
