import { NextResponse } from "next/server";
import { deleteLead, updateLeadStatus } from "@/lib/leads";
import type { LeadStatus } from "@/lib/types";

export const runtime = "nodejs";

const STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "closed"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const status = (body as { status?: string }).status as LeadStatus | undefined;
  if (!status || !STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const lead = await updateLeadStatus(id, status);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  return NextResponse.json({ lead });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ok = await deleteLead(id);
  if (!ok) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
