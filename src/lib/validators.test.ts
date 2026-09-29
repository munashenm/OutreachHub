import assert from "node:assert/strict";
import test from "node:test";
import { campaignSchema, prospectSchema } from "./validators";

const prospect = {
  firstName: "Ada",
  lastName: "Lovelace",
  jobTitle: "",
  email: "Ada@Example.com",
  phone: "",
  companyId: "",
  newCompanyName: "",
  website: "",
  industry: "",
  country: "",
  province: "",
  city: "",
  source: "",
  linkedinUrl: "",
  notes: "",
  leadStatus: "NEW",
  marketingStatus: "UNKNOWN",
};

test("normalises prospect email and empty optional fields", () => {
  const parsed = prospectSchema.parse(prospect);
  assert.equal(parsed.email, "ada@example.com");
  assert.equal(parsed.website, null);
  assert.equal(parsed.companyId, null);
});

test("rejects a campaign whose sending window is reversed", () => {
  const result = campaignSchema.safeParse({
    name: "Follow-up",
    description: "",
    status: "DRAFT",
    mailboxId: "",
    templateId: "",
    dailyLimit: "25",
    timezone: "UTC",
    sendingStartTime: "17:00",
    sendingEndTime: "08:00",
  });
  assert.equal(result.success, false);
});
