export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "RESPONDED",
  "QUALIFIED",
  "QUOTE_REQUESTED",
  "QUOTE_SENT",
  "NEGOTIATING",
  "WON",
  "LOST",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New lead",
  CONTACTED: "Contacted",
  RESPONDED: "Responded",
  QUALIFIED: "Qualified",
  QUOTE_REQUESTED: "Quote requested",
  QUOTE_SENT: "Quote sent",
  NEGOTIATING: "Negotiating",
  WON: "Won",
  LOST: "Lost",
};

export const MARKETING_STATUSES = [
  "UNKNOWN",
  "CONSENT_REQUESTED",
  "CONSENTED",
  "EXISTING_CUSTOMER",
  "OPTED_OUT",
  "BOUNCED",
  "BLOCKED",
] as const;

export type MarketingStatus = (typeof MARKETING_STATUSES)[number];

export const MARKETING_STATUS_LABELS: Record<MarketingStatus, string> = {
  UNKNOWN: "Unknown",
  CONSENT_REQUESTED: "Consent requested",
  CONSENTED: "Consented",
  EXISTING_CUSTOMER: "Existing customer",
  OPTED_OUT: "Opted out",
  BOUNCED: "Bounced",
  BLOCKED: "Blocked",
};

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const MAILBOX_PROVIDER_LABELS = {
  GOOGLE: "Gmail",
  MICROSOFT: "Microsoft 365",
} as const;

export const ACTIVITY_LABELS = {
  PROSPECT_CREATED: "Prospect created",
  PROSPECT_EDITED: "Prospect edited",
  PROSPECT_DELETED: "Prospect deleted",
  COMPANY_CREATED: "Company created",
  COMPANY_EDITED: "Company edited",
  COMPANY_DELETED: "Company deleted",
  CAMPAIGN_CREATED: "Campaign created",
  CAMPAIGN_UPDATED: "Campaign updated",
  PROSPECT_ADDED_TO_CAMPAIGN: "Prospect added to campaign",
  MARKETING_STATUS_CHANGED: "Marketing status changed",
  LEAD_STATUS_CHANGED: "Lead status changed",
  SUPPRESSION_ADDED: "Suppression added",
  SUPPRESSION_REMOVED: "Suppression removed",
  EMAIL_SENT: "Email sent",
  EMAIL_FAILED: "Email failed",
  REPLY_RECEIVED: "Reply received",
  TEMPLATE_CREATED: "Template created",
  TEMPLATE_UPDATED: "Template updated",
  MAILBOX_CONNECTED: "Mailbox connected",
  MAILBOX_DISCONNECTED: "Mailbox disconnected",
  RFQ_CREATED: "RFQ created",
  INBOX_UPDATED: "Inbox updated",
  PRODUCT_CREATED: "Product created",
  QUOTE_SENT: "Quote sent",
  SUPPLIER_IMPORTED: "Supplier prices imported",
  STOCK_SYNCED: "Stock updated",
  STORE_ORDERS_IMPORTED: "Website orders imported",
} as const;

export const INBOX_CATEGORIES = [
  "NEW_ENQUIRY",
  "RFQ",
  "PRICING_REQUEST",
  "PRODUCT_ENQUIRY",
  "ORDER_ENQUIRY",
  "SUPPORT",
  "CAMPAIGN_REPLY",
  "OTHER",
] as const;

export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

export const INBOX_CATEGORY_LABELS: Record<InboxCategory, string> = {
  NEW_ENQUIRY: "New enquiry",
  RFQ: "RFQ",
  PRICING_REQUEST: "Pricing request",
  PRODUCT_ENQUIRY: "Product enquiry",
  ORDER_ENQUIRY: "Order enquiry",
  SUPPORT: "Support",
  CAMPAIGN_REPLY: "Campaign reply",
  OTHER: "Other",
};

export const RFQ_STATUSES = [
  "NEW",
  "REVIEWING",
  "NEEDS_INFORMATION",
  "READY_TO_QUOTE",
  "QUOTE_PREPARED",
  "QUOTE_SENT",
  "WON",
  "LOST",
] as const;

export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const RFQ_STATUS_LABELS: Record<RfqStatus, string> = {
  NEW: "New",
  REVIEWING: "Reviewing",
  NEEDS_INFORMATION: "Needs information",
  READY_TO_QUOTE: "Ready to quote",
  QUOTE_PREPARED: "Quote prepared",
  QUOTE_SENT: "Quote sent",
  WON: "Won",
  LOST: "Lost",
};

export const OPPORTUNITY_STATUSES: LeadStatus[] = [
  "QUOTE_REQUESTED",
  "QUOTE_SENT",
  "NEGOTIATING",
  "WON",
  "LOST",
];

export const INTERESTED_STATUSES: LeadStatus[] = [
  "QUALIFIED",
  "QUOTE_REQUESTED",
  "QUOTE_SENT",
  "NEGOTIATING",
  "WON",
];

export const PAGE_SIZE = 25;

export const CSV_HEADERS = [
  "firstName",
  "lastName",
  "jobTitle",
  "email",
  "phone",
  "companyName",
  "website",
  "industry",
  "country",
  "province",
  "city",
  "source",
  "linkedinUrl",
  "notes",
  "leadStatus",
  "marketingStatus",
] as const;

export function isLeadStatus(value: string): value is LeadStatus {
  return LEAD_STATUSES.includes(value as LeadStatus);
}

export function isMarketingStatus(value: string): value is MarketingStatus {
  return MARKETING_STATUSES.includes(value as MarketingStatus);
}

export function isCampaignStatus(value: string): value is CampaignStatus {
  return CAMPAIGN_STATUSES.includes(value as CampaignStatus);
}

export function isInboxCategory(value: string): value is InboxCategory {
  return INBOX_CATEGORIES.includes(value as InboxCategory);
}

export function isRfqStatus(value: string): value is RfqStatus {
  return RFQ_STATUSES.includes(value as RfqStatus);
}
