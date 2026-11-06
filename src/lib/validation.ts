import type { CreateLeadInput, LeadSource, ServiceInterest } from "./types";

const SERVICES: ServiceInterest[] = [
  "brand-films",
  "social-content",
  "performance-ads",
  "influencer",
  "full-funnel",
  "other",
];

const SOURCES: LeadSource[] = [
  "website",
  "referral",
  "social",
  "event",
  "other",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLeadInput(body: unknown): {
  data?: CreateLeadInput;
  error?: string;
} {
  if (!body || typeof body !== "object") {
    return { error: "Invalid request body." };
  }

  const b = body as Record<string, unknown>;

  const name = String(b.name ?? "").trim();
  const email = String(b.email ?? "").trim();
  const phone = String(b.phone ?? "").trim();
  const company = String(b.company ?? "").trim();
  const website = String(b.website ?? "").trim();
  const service = String(b.service ?? "").trim() as ServiceInterest;
  const budget = String(b.budget ?? "").trim();
  const message = String(b.message ?? "").trim();
  const source = (String(b.source ?? "website").trim() ||
    "website") as LeadSource;

  if (name.length < 2) return { error: "Please enter your full name." };
  if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email." };
  if (phone.length < 7) return { error: "Please enter a valid phone number." };
  if (company.length < 2) return { error: "Please enter your company name." };
  if (!SERVICES.includes(service)) {
    return { error: "Please select a service interest." };
  }
  if (message.length < 10) {
    return { error: "Tell us a bit more about your project (10+ characters)." };
  }
  if (!SOURCES.includes(source)) {
    return { error: "Invalid lead source." };
  }

  return {
    data: {
      name,
      email,
      phone,
      company,
      website: website || undefined,
      service,
      budget: budget || undefined,
      message,
      source,
    },
  };
}
