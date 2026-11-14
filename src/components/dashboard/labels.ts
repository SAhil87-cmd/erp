import type { IntelligenceCategory } from '@/lib/crm/types';

export type DashboardTab =
  | 'executive-overview'
  | 'gone-dark'
  | 'not-picking-up'
  | 'mismarked-ni'
  | 'stuck-leads'
  | 'very-high-intent'
  | 'high-intent'
  | 'not-interested'
  | 'cold-follow'
  | 'site-visit-scheduled'
  | 'all-leads'
  | 'reviewed-leads'
  | 'override'
  | 'sales-closed'
  | 'todays-activity'
  | 'executive-performance'
  | 'project-intelligence'
  | 'reports'
  | 'data-health';

export const TAB_ITEMS: {
  id: DashboardTab;
  label: string;
  category?: IntelligenceCategory;
}[] = [
  { id: 'executive-overview', label: 'Executive Overview' },
  { id: 'gone-dark', label: 'Gone Dark', category: 'GONE_DARK' },
  { id: 'not-picking-up', label: 'Not Picking Up', category: 'NOT_PICKING_UP' },
  { id: 'mismarked-ni', label: 'Mismarked NI', category: 'MISMARKED_NI' },
  { id: 'stuck-leads', label: 'Stuck Leads', category: 'STUCK' },
  { id: 'very-high-intent', label: 'Very High Intent', category: 'VERY_HIGH_INTENT' },
  { id: 'high-intent', label: 'High Intent', category: 'HIGH_INTENT' },
  { id: 'not-interested', label: 'Not Interested' },
  { id: 'cold-follow', label: 'Cold Follow' },
  { id: 'site-visit-scheduled', label: 'Site Visit Scheduled' },
  { id: 'all-leads', label: 'All Leads' },
  { id: 'reviewed-leads', label: 'Reviewed Leads' },
  { id: 'override', label: 'Not Gone Dark / Override' },
  { id: 'sales-closed', label: 'Sales Closed' },
  { id: 'todays-activity', label: "Today's Activity" },
  { id: 'executive-performance', label: 'Executive Performance' },
  { id: 'project-intelligence', label: 'Project Intelligence' },
  { id: 'reports', label: 'Reports' },
  { id: 'data-health', label: 'Data Health & Settings' },
];

/** Grouped sidebar for ERP navigation. */
export const NAV_SECTIONS: {
  title: string;
  items: DashboardTab[];
}[] = [
  { title: 'Overview', items: ['executive-overview', 'todays-activity'] },
  {
    title: 'Recovery',
    items: ['gone-dark', 'not-picking-up', 'mismarked-ni', 'stuck-leads'],
  },
  {
    title: 'Intent',
    items: ['very-high-intent', 'high-intent'],
  },
  {
    title: 'Pipeline',
    items: [
      'site-visit-scheduled',
      'cold-follow',
      'not-interested',
      'sales-closed',
    ],
  },
  {
    title: 'Leads',
    items: ['all-leads', 'reviewed-leads', 'override'],
  },
  {
    title: 'Analytics',
    items: ['executive-performance', 'project-intelligence', 'reports'],
  },
  { title: 'System', items: ['data-health'] },
];

export const CATEGORY_LABELS: Record<IntelligenceCategory, string> = {
  GONE_DARK: 'Gone Dark',
  NOT_PICKING_UP: 'Not Picking Up',
  MISMARKED_NI: 'Mismarked NI',
  STUCK: 'Stuck',
  VERY_HIGH_INTENT: 'Very High Intent',
  HIGH_INTENT: 'High Intent',
  NONE: 'None',
};

export const CATEGORY_TONE: Record<IntelligenceCategory, string> = {
  GONE_DARK: 'urgent',
  NOT_PICKING_UP: 'warning',
  MISMARKED_NI: 'warning',
  STUCK: 'warning',
  VERY_HIGH_INTENT: 'opportunity',
  HIGH_INTENT: 'opportunity',
  NONE: 'neutral',
};

export function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}
