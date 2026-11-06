'use client';

export function InsufficientCallDataBanner({
  count,
  callTotal,
}: {
  count: number;
  /** Total imported call records (if known). */
  callTotal?: number;
}) {
  if (count <= 0) return null;
  const hasCalls = (callTotal ?? 0) > 0;
  return (
    <div className="insufficient-banner" role="status">
      <strong>INSUFFICIENT CALL DATA</strong>
      <span>
        {count} lead{count === 1 ? '' : 's'} cannot be fully classified for call-dependent
        rules
        {hasCalls
          ? ` — call history is loaded (${callTotal!.toLocaleString()} records), but these leads have no matched Customer Id / phone in that history.`
          : '. Import Runo/call history CSV or sync the published Google Sheet before acting on those flags.'}{' '}
        Re-sync the published sheet after a linking fix, or import a CRM sheet with Customer Ids.
      </span>
    </div>
  );
}
