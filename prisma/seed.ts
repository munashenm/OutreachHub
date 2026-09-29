import "dotenv/config";
import bcrypt from "bcryptjs";
import { getDb } from "../src/lib/db";

const demoEmail = "demo@outreachhub.example";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO !== "true") {
    console.error("Demo data is not loaded in production. Open /register and create the Urban Focus staff account.");
    return;
  }
  const db = getDb();
  const existing = await db.workspace.findUnique({ where: { slug: "demo-workspace" } });
  if (existing) {
    console.log("Demo workspace already exists. Skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash("Demo-password-123", 12);
  const user = await db.user.create({
    data: { name: "Demo User", email: demoEmail, passwordHash },
  });
  const workspace = await db.workspace.create({
    data: {
      name: "Demo Workspace",
      slug: "demo-workspace",
      isDemo: true,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const northwind = await db.company.create({
    data: {
      workspaceId: workspace.id,
      companyName: "Northwind IT (demo)",
      website: "https://example.com",
      industry: "Information technology",
      companySize: "51-200",
      country: "South Africa",
      province: "Gauteng",
      city: "Johannesburg",
      notes: "Demo record. Not a real customer.",
    },
  });
  const cape = await db.company.create({
    data: {
      workspaceId: workspace.id,
      companyName: "Cape Circuit Supplies (demo)",
      industry: "Wholesale",
      country: "South Africa",
      province: "Western Cape",
      city: "Cape Town",
      notes: "Demo record. Not a real customer.",
    },
  });

  const ada = await db.prospect.create({
    data: {
      workspaceId: workspace.id,
      companyId: northwind.id,
      firstName: "Ada",
      lastName: "Example",
      jobTitle: "IT manager",
      email: "ada@demo.example",
      marketingStatus: "CONSENTED",
      leadStatus: "QUALIFIED",
      source: "Demo seed",
      notes: "Demo record. Not a real person.",
    },
  });
  const optedOut = await db.prospect.create({
    data: {
      workspaceId: workspace.id,
      companyId: cape.id,
      firstName: "Sam",
      lastName: "Optout",
      jobTitle: "Buyer",
      email: "sam@demo.example",
      marketingStatus: "OPTED_OUT",
      leadStatus: "CONTACTED",
      source: "Demo seed",
      notes: "Demo record. Not a real person.",
    },
  });

  await db.leadStatusHistory.createMany({
    data: [
      { workspaceId: workspace.id, prospectId: ada.id, toStatus: "QUALIFIED", changedById: user.id },
      { workspaceId: workspace.id, prospectId: optedOut.id, toStatus: "CONTACTED", changedById: user.id },
    ],
  });
  await db.suppression.create({
    data: {
      workspaceId: workspace.id,
      email: optedOut.email,
      reason: "Prospect opted out.",
      source: "marketing_status",
      userId: user.id,
    },
  });

  const campaign = await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      name: "Workstation follow-up (demo)",
      description: "Demo campaign. It does not send email.",
      status: "DRAFT",
      timezone: "Africa/Johannesburg",
      dailyLimit: 25,
    },
  });
  await db.campaignProspect.create({
    data: { workspaceId: workspace.id, campaignId: campaign.id, prospectId: ada.id, addedById: user.id },
  });
  await db.activity.createMany({
    data: [
      { workspaceId: workspace.id, actorId: user.id, type: "COMPANY_CREATED", companyId: northwind.id, summary: "Created company Northwind IT (demo)." },
      { workspaceId: workspace.id, actorId: user.id, type: "PROSPECT_CREATED", prospectId: ada.id, companyId: northwind.id, summary: "Created prospect Ada Example." },
      { workspaceId: workspace.id, actorId: user.id, type: "SUPPRESSION_ADDED", summary: "Added sam@demo.example to the suppression list." },
      { workspaceId: workspace.id, actorId: user.id, type: "CAMPAIGN_CREATED", campaignId: campaign.id, summary: "Created campaign Workstation follow-up (demo)." },
      { workspaceId: workspace.id, actorId: user.id, type: "PROSPECT_ADDED_TO_CAMPAIGN", prospectId: ada.id, campaignId: campaign.id, summary: "Added Ada Example to campaign Workstation follow-up (demo)." },
    ],
  });

  console.log("Demo workspace created.");
  console.log(`Email: ${demoEmail}`);
  console.log("Password: Demo-password-123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
