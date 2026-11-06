import { NextResponse } from "next/server";
import { createLead, getLeadStats, listLeads } from "@/lib/leads";
import { validateLeadInput } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const leads = await listLeads();
  return NextResponse.json({ leads, stats: getLeadStats(leads) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { data, error } = validateLeadInput(body);
  if (error || !data) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const lead = await createLead(data);
  return NextResponse.json({ lead }, { status: 201 });
}
