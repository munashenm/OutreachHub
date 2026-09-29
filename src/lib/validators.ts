import { z } from "zod";
import {
  CAMPAIGN_STATUSES,
  LEAD_STATUSES,
  MARKETING_STATUSES,
} from "@/lib/labels";
import { passwordIssue } from "@/lib/password";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value));

const requiredText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(max);

const emailField = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase())
  .refine((value) => z.email().safeParse(value).success, "Enter a valid email address.");

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine(
    (value) => value.length === 0 || z.url().safeParse(value).success,
    "Enter a valid URL, including https://.",
  )
  .transform((value) => (value.length === 0 ? null : value));

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine(
    (value) => value.length === 0 || z.email().safeParse(value).success,
    "Enter a valid email address.",
  )
  .transform((value) => (value.length === 0 ? null : value.toLowerCase()));

const timeField = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 08:00.");

export function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const registerSchema = z.object({
  name: requiredText(80, "Name"),
  email: emailField,
  password: z.string().refine((value) => passwordIssue(value) === null, {
    message: "Use at least 10 characters with a letter and a number.",
  }),
  workspaceName: requiredText(80, "Workspace name"),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required.").max(128),
  next: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20, "This reset link is invalid.").max(200),
    password: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((value, context) => {
    const issue = passwordIssue(value.password);
    if (issue) {
      context.addIssue({ code: "custom", message: issue, path: ["password"] });
    }
    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: "custom",
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      });
    }
  });

export const workspaceSchema = z.object({
  name: requiredText(80, "Workspace name"),
});

export const prospectSchema = z.object({
  firstName: requiredText(80, "First name"),
  lastName: requiredText(80, "Last name"),
  jobTitle: optionalText(120),
  email: emailField,
  phone: optionalText(40),
  companyId: z.string().trim().transform((value) => (value.length === 0 ? null : value)),
  newCompanyName: optionalText(160),
  website: optionalUrl,
  industry: optionalText(120),
  country: optionalText(80),
  province: optionalText(80),
  city: optionalText(80),
  source: optionalText(120),
  linkedinUrl: optionalUrl,
  notes: optionalText(5000),
  leadStatus: z.enum(LEAD_STATUSES),
  marketingStatus: z.enum(MARKETING_STATUSES),
});

export const prospectCsvSchema = prospectSchema
  .omit({ companyId: true, newCompanyName: true })
  .extend({
    companyName: optionalText(160),
  });

export const companySchema = z.object({
  companyName: requiredText(160, "Company name"),
  website: optionalUrl,
  industry: optionalText(120),
  companySize: optionalText(40),
  phone: optionalText(40),
  country: optionalText(80),
  province: optionalText(80),
  city: optionalText(80),
  notes: optionalText(5000),
});

export const campaignSchema = z
  .object({
    name: requiredText(120, "Campaign name"),
    description: optionalText(2000),
    status: z.enum(CAMPAIGN_STATUSES),
    mailboxId: z.string().trim().transform((value) => (value.length === 0 ? null : value)),
    templateId: z.string().trim().transform((value) => (value.length === 0 ? null : value)),
    dailyLimit: z.coerce.number().int().min(1, "Daily limit must be at least 1.").max(1000),
    timezone: z
      .string()
      .trim()
      .min(1, "Timezone is required.")
      .max(80)
      .refine(isValidTimeZone, "Enter a valid IANA timezone, such as UTC."),
    sendingStartTime: timeField,
    sendingEndTime: timeField,
  })
  .superRefine((value, context) => {
    if (value.sendingStartTime >= value.sendingEndTime) {
      context.addIssue({
        code: "custom",
        message: "Sending must end after it starts.",
        path: ["sendingEndTime"],
      });
    }
    if (value.status === "ACTIVE" && !value.mailboxId) {
      context.addIssue({
        code: "custom",
        message: "Choose a connected Gmail mailbox before activating.",
        path: ["mailboxId"],
      });
    }
    if (value.status === "ACTIVE" && !value.templateId) {
      context.addIssue({
        code: "custom",
        message: "Choose a template before activating.",
        path: ["templateId"],
      });
    }
  });

export const draftSchema = z.object({
  brief: requiredText(1000, "Brief"),
  name: z.string().trim().max(120).optional().default(""),
  subject: z.string().trim().max(200).optional().default(""),
  body: z.string().trim().max(10000).optional().default(""),
});

export const templateSchema = z.object({
  name: requiredText(120, "Template name"),
  subject: requiredText(200, "Subject"),
  body: requiredText(10000, "Message"),
  htmlBody: z.string().trim().max(20000).optional().default(""),
});

export const replySchema = z.object({
  messageId: z.string().trim().min(1),
  to: emailField,
  cc: z.string().trim().max(500).optional().default(""),
  subject: requiredText(200, "Subject"),
  body: requiredText(10000, "Message"),
});

export const rfqUpdateSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(["NEW", "REVIEWING", "NEEDS_INFORMATION", "READY_TO_QUOTE", "QUOTE_PREPARED", "QUOTE_SENT", "WON", "LOST"]),
  notes: z.string().trim().max(10000).optional().default(""),
});

export const suppressionSchema = z.object({
  email: emailField,
  reason: requiredText(300, "Reason"),
  source: optionalText(120),
  campaignId: z.string().trim().transform((value) => (value.length === 0 ? null : value)),
});

export const idListSchema = z
  .array(z.string().trim().min(1).max(40))
  .min(1, "Select at least one record.")
  .max(100, "Select 100 records or fewer at a time.");

export type ProspectInput = z.infer<typeof prospectSchema>;
export type CompanyInput = z.infer<typeof companySchema>;
export type CampaignInput = z.infer<typeof campaignSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;
export type SuppressionInput = z.infer<typeof suppressionSchema>;

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] ? String(issue.path[0]) : "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function readForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
