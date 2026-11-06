import type { LeadSource, LeadStatus, ServiceInterest } from "./types";

export const SERVICE_LABELS: Record<ServiceInterest, string> = {
  "brand-films": "Brand films & video",
  "social-content": "Social content systems",
  "performance-ads": "Performance media",
  influencer: "Influencer partnerships",
  "full-funnel": "Full-funnel media",
  other: "Something else",
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  closed: "Closed",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Website",
  referral: "Referral",
  social: "Social",
  event: "Event",
  other: "Other",
};

export const BUDGET_OPTIONS = [
  "Under ₹1L",
  "₹1L – ₹5L",
  "₹5L – ₹15L",
  "₹15L+",
  "Not sure yet",
] as const;
