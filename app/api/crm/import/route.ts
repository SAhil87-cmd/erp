import { NextRequest, NextResponse } from 'next/server';
import { importFromFile } from '@/lib/crm/import';
import { loadSnapshot, saveRawRows } from '@/lib/crm/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'Missing file field (multipart CSV/XLSX)' },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name || 'upload.csv';
    const imported = await importFromFile(buffer, name);
    const source = name.toLowerCase().endsWith('.xlsx') || name.toLowerCase().endsWith('.xls')
      ? 'xlsx'
      : 'csv';

    await saveRawRows(imported.rows, source);
    const snapshot = await loadSnapshot();

    return NextResponse.json({
      ok: true,
      rowCount: imported.rows.length,
      mappedKeys: imported.mappedKeys,
      unmappedHeaders: imported.unmappedHeaders,
      issues: imported.issues,
      snapshot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
