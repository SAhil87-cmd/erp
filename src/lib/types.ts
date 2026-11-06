export type LeadStatus = "new" | "contacted" | "qualified" | "closed";

export type LeadSource =
  | "website"
  | "referral"
  | "social"
  | "event"
  | "other";

export type ServiceInterest =
  | "brand-films"
  | "social-content"
  | "performance-ads"
  | "influencer"
  | "full-funnel"
  | "other";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  website?: string;
  service: ServiceInterest;
  budget?: string;
  message: string;
  source: LeadSource;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeadInput {
  name: string;
  email: string;
  phone: string;
  company: string;
  website?: string;
  service: ServiceInterest;
  budget?: string;
  message: string;
  source?: LeadSource;
}
