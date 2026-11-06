import { NextRequest, NextResponse } from 'next/server';
import {
  computeBookingForecast,
  computeExecutivePerformance,
  computeOverviewMetrics,
  computeProjectIntelligence,
} from '@/lib/crm/analytics';
import {
  exportBookingForecastCsv,
  exportCallsCsv,
  exportClassificationsCsv,
  exportCustomersCsv,
  exportDataHealthCsv,
  exportExecutivePerformanceCsv,
  exportOverviewCsv,
  exportProcessesCsv,
  exportProjectIntelligenceCsv,
  exportSheetTemplateCsv,
} from '@/lib/crm/export';
import { applyGlobalFilters } from '@/lib/crm/filters';
import { ensureSeeded } from '@/lib/crm/seed';
import type { CrmSnapshot, GlobalFilters } from '@/lib/crm/types';

export const runtime = 'nodejs';

function parseFilters(req: NextRequest): GlobalFilters | null {
  const raw = req.nextUrl.searchParams.get('filters');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GlobalFilters;
  } catch {
    return null;
  }
}

function applyFiltersToSnapshot(
  snapshot: CrmSnapshot,
  filters: GlobalFilters | null,
): CrmSnapshot {
  if (!filters) return snapshot;
  const filtered = applyGlobalFilters(snapshot, filters);
  return {
    ...snapshot,
    customers: filtered.customers,
    processes: filtered.processes,
    interactions: filtered.interactions,
    calls: filtered.calls,
    followUps: filtered.followUps,
    classifications: filtered.classifications,
  };
}

export async function GET(req: NextRequest) {
  try {
    const report = (req.nextUrl.searchParams.get('report') || 'classifications').toLowerCase();
    const { snapshot: base } = await ensureSeeded(false);
    const snapshot = applyFiltersToSnapshot(base, parseFilters(req));

    let csv: string;
    let filename: string;

    switch (report) {
      case 'customers':
        csv = exportCustomersCsv(snapshot.customers);
        filename = 'customers.csv';
        break;
      case 'processes':
        csv = exportProcessesCsv(snapshot.processes);
        filename = 'processes.csv';
        break;
      case 'calls':
        csv = exportCallsCsv(snapshot.calls);
        filename = 'calls.csv';
        break;
      case 'overview':
        csv = exportOverviewCsv(computeOverviewMetrics(snapshot));
        filename = 'overview.csv';
        break;
      case 'executives':
        csv = exportExecutivePerformanceCsv(computeExecutivePerformance(snapshot));
        filename = 'executive-performance.csv';
        break;
      case 'projects':
        csv = exportProjectIntelligenceCsv(computeProjectIntelligence(snapshot));
        filename = 'project-intelligence.csv';
        break;
      case 'booking':
      case 'forecast':
        csv = exportBookingForecastCsv(computeBookingForecast(snapshot));
        filename = 'booking-forecast.csv';
        break;
      case 'health':
        csv = exportDataHealthCsv(snapshot.dataHealth);
        filename = 'data-health.csv';
        break;
      case 'template':
        csv = exportSheetTemplateCsv();
        filename = 'crm-sheet-template.csv';
        break;
      case 'classifications':
      default:
        csv = exportClassificationsCsv(snapshot.classifications);
        filename = 'classifications.csv';
        break;
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
