import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileText, CalendarClock, CheckCircle2, Package, Box, TrendingUp, Clock, Container, Users, Warehouse, RefreshCw, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { exportToExcel, exportToCSV, printTable } from '@/lib/export';
import { ExportMenu } from '@/components/common/ExportMenu';

interface SummaryRow {
  container_id: string;
  vessel_name: string;
  total_quantity: number;
  arrival_date: string | null;
  destuff_date: string | null;
  status: string;
}

interface DamageRow {
  container_id: string;
  bl_no: string | null;
  pallet_no: string | null;
  commodity: string;
  damage: string;
  remarks: string | null;
}

interface ProductivityRow {
  container_id: string;
  vessel_name: string;
  teu_size: '20ft' | '40ft' | null;
  destuff_shed: 'Shed 6' | 'Shed 7' | null;
  arrival_date: string | null;
  destuff_date: string | null;
  start_time: string | null;
  end_time: string | null;
  total_cargo: number;
  duration_minutes: number | null;
  items_per_hour: number | null;
}

// Parse "HH:MM" or "HH:MM:SS" → total minutes since midnight
function parseTimeMinutes(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function calcDuration(start: string | null, end: string | null): number | null {
  const s = parseTimeMinutes(start);
  const e = parseTimeMinutes(end);
  if (s === null || e === null) return null;
  const diff = e >= s ? e - s : 24 * 60 - s + e;
  return diff > 0 ? diff : null;
}

function fmtDuration(mins: number | null): string {
  if (mins === null) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// TEU factor: 20ft = 1 TEU, 40ft = 2 TEUs, unknown = 1 TEU
function teuFactor(size: '20ft' | '40ft' | null): number {
  return size === '40ft' ? 2 : 1;
}

function fmt2(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

// ── Reusable summary table ─────────────────────────────────────────────────
function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="w-full max-w-full overflow-x-auto border border-border rounded-md">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">#</th>
            <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Container ID</th>
            <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Vessel</th>
            <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Arrival Date</th>
            <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Destuff Date</th>
            <th className="text-right py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Total Qty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.container_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
              <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground text-xs">{i + 1}</td>
              <td className="py-2.5 px-4 whitespace-nowrap font-semibold">{row.container_id}</td>
              <td className="py-2.5 px-4 whitespace-nowrap">{row.vessel_name}</td>
              <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground">{row.arrival_date || '—'}</td>
              <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground">{row.destuff_date || '—'}</td>
              <td className="py-2.5 px-4 whitespace-nowrap text-right font-medium">{row.total_quantity.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/30">
            <td colSpan={5} className="py-2.5 px-4 text-xs font-medium text-muted-foreground">{rows.length} container{rows.length !== 1 ? 's' : ''}</td>
            <td className="py-2.5 px-4 text-right text-xs font-semibold">
              {rows.reduce((s, r) => s + r.total_quantity, 0).toLocaleString()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'summary' | 'damage' | 'productivity'>('summary');
  const [summaryData, setSummaryData] = useState<SummaryRow[]>([]);
  const [damageData, setDamageData] = useState<DamageRow[]>([]);
  const [productivityData, setProductivityData] = useState<ProductivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [prodDateFrom, setProdDateFrom] = useState('');
  const [prodDateTo, setProdDateTo] = useState('');
  // Shed filter for productivity view: 'all' = combined (CSP), or specific shed
  const [prodShedFilter, setProdShedFilter] = useState<'all' | 'Shed 6' | 'Shed 7'>('all');

  // Shed areas auto-loaded from app_settings (configured in Settings page)
  const [shed6Area, setShed6Area] = useState(0);
  const [shed7Area, setShed7Area] = useState(0);
  const [shedSettingsLoaded, setShedSettingsLoaded] = useState(false);

  const { canManageContainers } = useAuth();

  async function fetchSummary() {
    setLoading(true);
    // Query containers directly so Scheduled containers with no cargo yet still appear.
    // Left-join cargo to sum quantities (containers with no cargo show 0).
    const { data: containerRows } = await supabase
      .from('containers')
      .select('container_id,vessel_name,arrival_date,destuff_date,status,cargo(quantity)')
      .in('status', ['Scheduled', 'Completed'])
      .order('container_id', { ascending: true })
      .limit(10000);

    const rows = Array.isArray(containerRows) ? containerRows : [];

    const flat: SummaryRow[] = rows.map((c) => {
      const cargoItems = Array.isArray(c.cargo) ? c.cargo : [];
      const totalQty = cargoItems.reduce((sum: number, item: { quantity: number }) => sum + (item.quantity || 0), 0);
      return {
        container_id: c.container_id,
        vessel_name: c.vessel_name,
        arrival_date: c.arrival_date,
        destuff_date: c.destuff_date,
        status: c.status,
        total_quantity: totalQty,
      };
    });

    setSummaryData(flat);
    setLoading(false);
  }

  async function fetchDamage() {
    setLoading(true);
    const { data } = await supabase
      .from('cargo')
      .select('container_id,bl_no,pallet_no,commodity,damage,remarks')
      .not('damage', 'is', null)
      .neq('damage', '')
      .neq('damage', 'none')
      .limit(5000);
    const rows = Array.isArray(data) ? data : [];
    setDamageData(rows as DamageRow[]);
    setLoading(false);
  }

  async function fetchProductivity(dateFrom?: string, dateTo?: string) {
    setLoading(true);
    let q = supabase
      .from('containers')
      .select('container_id,vessel_name,teu_size,destuff_shed,arrival_date,destuff_date,start_time,end_time,cargo(quantity)')
      .eq('status', 'Completed')
      .order('destuff_date', { ascending: false })
      .limit(5000);
    if (dateFrom) q = q.gte('destuff_date', dateFrom);
    if (dateTo)   q = q.lte('destuff_date', dateTo);

    const { data } = await q;
    const rows = Array.isArray(data) ? data : [];

    const flat: ProductivityRow[] = rows.map((c) => {
      const cargoItems = Array.isArray(c.cargo) ? c.cargo : [];
      const totalCargo = cargoItems.reduce((s: number, item: { quantity: number }) => s + (item.quantity || 0), 0);
      const dur = calcDuration(c.start_time, c.end_time);
      const iph = dur && totalCargo > 0 ? Math.round((totalCargo / dur) * 60) : null;
      return {
        container_id: c.container_id,
        vessel_name: c.vessel_name,
        teu_size: c.teu_size as '20ft' | '40ft' | null,
        destuff_shed: c.destuff_shed as 'Shed 6' | 'Shed 7' | null,
        arrival_date: c.arrival_date,
        destuff_date: c.destuff_date,
        start_time: c.start_time,
        end_time: c.end_time,
        total_cargo: totalCargo,
        duration_minutes: dur,
        items_per_hour: iph,
      };
    });

    setProductivityData(flat);
    setLoading(false);
  }

  // Auto-load shed areas from app_settings (configured once in Settings)
  async function loadShedSettings() {
    const { data } = await supabase
      .from('app_settings')
      .select('key,value')
      .in('key', ['shed6_area_m2', 'shed7_area_m2']);
    if (Array.isArray(data)) {
      data.forEach((row) => {
        const v = parseFloat(row.value) || 0;
        if (row.key === 'shed6_area_m2') setShed6Area(v);
        if (row.key === 'shed7_area_m2') setShed7Area(v);
      });
    }
    setShedSettingsLoaded(true);
  }

  const allTabs = [
    { key: 'summary' as const, label: 'Summary Report', icon: FileText, clerkVisible: false },
    { key: 'damage' as const, label: 'Damage Report', icon: AlertTriangle, clerkVisible: false },
    { key: 'productivity' as const, label: 'Productivity', icon: TrendingUp, clerkVisible: false },
  ];

  const tabs = allTabs.filter((t) => {
    if (canManageContainers) return true;
    return t.clerkVisible;
  });

  useEffect(() => {
    const visibleKeys = tabs.map((t) => t.key);
    if (!visibleKeys.includes(activeTab)) {
      setActiveTab(visibleKeys[0] ?? 'summary');
      return;
    }
    if (activeTab === 'summary') fetchSummary();
    if (activeTab === 'damage') fetchDamage();
    if (activeTab === 'productivity') {
      fetchProductivity(prodDateFrom, prodDateTo);
      if (!shedSettingsLoaded) loadShedSettings();
    }
  }, [activeTab]);

  // ── Export helpers ────────────────────────────────────────────────────
  const toExportRow = (r: SummaryRow) => ({
    'Container ID': r.container_id,
    'Vessel': r.vessel_name,
    'Arrival Date': r.arrival_date || '',
    'Destuff Date': r.destuff_date || '',
    'Total Qty': r.total_quantity,
  });

  const toPrintRow = (r: SummaryRow) => [
    r.container_id, r.vessel_name, r.arrival_date || '—', r.destuff_date || '—', r.total_quantity,
  ];

  const PRINT_COLS = ['Container ID', 'Vessel', 'Arrival Date', 'Destuff Date', 'Total Qty'];

  async function handleExcelExport() {
    if (activeTab === 'summary') {
      if (!summaryData.length) { toast.error('No data to export'); return; }
      await exportToExcel(summaryData.map(toExportRow), 'Summary_Report');
    } else {
      if (!damageData.length) { toast.error('No data to export'); return; }
      await exportToExcel(damageData.map((r) => ({
        'Container ID': r.container_id, 'BL#': r.bl_no || '', 'Pallet No': r.pallet_no || '',
        'Commodity': r.commodity, 'Damage': r.damage, 'Remarks': r.remarks || '',
      })), 'Damage_Report');
    }
    toast.success('Exported to Excel');
  }

  function handleCsvExport() {
    if (activeTab === 'summary') {
      if (!summaryData.length) { toast.error('No data to export'); return; }
      exportToCSV(summaryData.map(toExportRow), 'Summary_Report');
    } else {
      if (!damageData.length) { toast.error('No data to export'); return; }
      exportToCSV(damageData.map((r) => ({
        'Container ID': r.container_id, 'BL#': r.bl_no || '', 'Pallet No': r.pallet_no || '',
        'Commodity': r.commodity, 'Damage': r.damage, 'Remarks': r.remarks || '',
      })), 'Damage_Report');
    }
    toast.success('Exported to CSV');
  }

  function handlePrint() {
    if (activeTab === 'summary') {
      if (!summaryData.length) { toast.error('No data to print'); return; }
      printTable('Summary Report', `${summaryData.length} container(s)`, PRINT_COLS, summaryData.map(toPrintRow));
    } else {
      if (!damageData.length) { toast.error('No data to print'); return; }
      printTable('Damage Report', `${damageData.length} damaged cargo item(s)`,
        ['Container ID', 'BL#', 'Pallet No', 'Commodity', 'Damage', 'Remarks'],
        damageData.map((r) => [r.container_id, r.bl_no, r.pallet_no, r.commodity, r.damage, r.remarks]));
    }
  }

  // ── Productivity export helpers ───────────────────────────────────────
  const toProdExportRow = (r: ProductivityRow) => ({
    'Container ID': r.container_id,
    'Vessel': r.vessel_name,
    'TEU Size': r.teu_size || '—',
    'Shed': r.destuff_shed || '—',
    'Arrival Date': r.arrival_date || '',
    'Destuff Date': r.destuff_date || '',
    'Start Time': r.start_time || '',
    'End Time': r.end_time || '',
    'Duration': fmtDuration(r.duration_minutes),
    'Total Cargo': r.total_cargo,
    'Items/Hour': r.items_per_hour ?? '—',
  });

  async function handleProdExcelExport() {
    if (!productivityData.length) { toast.error('No data to export'); return; }
    await exportToExcel(productivityData.map(toProdExportRow), 'Productivity_Report');
    toast.success('Exported to Excel');
  }

  function handleProdCsvExport() {
    if (!productivityData.length) { toast.error('No data to export'); return; }
    exportToCSV(productivityData.map(toProdExportRow), 'Productivity_Report');
    toast.success('Exported to CSV');
  }

  function handleProdPrint() {
    if (!productivityData.length) { toast.error('No data to print'); return; }
    printTable(
      'Productivity Report',
      `${productivityData.length} completed container(s)`,
      ['Container ID', 'Vessel', 'TEU', 'Destuff Date', 'Duration', 'Total Cargo', 'Items/Hour'],
      productivityData.map((r) => [
        r.container_id, r.vessel_name, r.teu_size || '—',
        r.destuff_date || '—', fmtDuration(r.duration_minutes),
        r.total_cargo, r.items_per_hour ?? '—',
      ]),
    );
  }

  const scheduled = summaryData.filter((r) => r.status === 'Scheduled');
  const completed = summaryData.filter((r) => r.status === 'Completed')
    .sort((a, b) => (b.destuff_date ?? '').localeCompare(a.destuff_date ?? ''));
  const totalQtyScheduled = scheduled.reduce((s, r) => s + r.total_quantity, 0);
  const totalQtyCompleted = completed.reduce((s, r) => s + r.total_quantity, 0);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-lg font-semibold md:text-xl">Reports</h1>
        <p className="text-sm text-muted-foreground">Generate and export operational reports</p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <Button
              key={t.key}
              variant={activeTab === t.key ? 'default' : 'outline'}
              className="gap-2"
              onClick={() => setActiveTab(t.key)}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Button>
          );
        })}
      </div>

      {/* ── Summary Report ── */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Top stat cards */}
          {!loading && summaryData.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-card border-border">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CalendarClock className="h-4 w-4 text-[#3498db]" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Scheduled</span>
                  </div>
                  <p className="text-2xl font-bold">{scheduled.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">containers</p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-[#2ecc71]" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Completed</span>
                  </div>
                  <p className="text-2xl font-bold">{completed.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">containers</p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="h-4 w-4 text-[#3498db]" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Pending Qty</span>
                  </div>
                  <p className="text-2xl font-bold">{totalQtyScheduled.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">units scheduled</p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Box className="h-4 w-4 text-[#2ecc71]" />
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Completed Qty</span>
                  </div>
                  <p className="text-2xl font-bold">{totalQtyCompleted.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">units destuffed</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Scheduled table */}
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-[#3498db]" />
                <CardTitle className="text-base">Scheduled Containers</CardTitle>
                {!loading && (
                  <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#3498db]/15 text-[#3498db]">
                    {scheduled.length}
                  </span>
                )}
              </div>
              <ExportMenu
                onExcelExport={async () => {
                  if (!scheduled.length) { toast.error('No scheduled containers to export'); return; }
                  await exportToExcel(scheduled.map(toExportRow), 'Scheduled_Containers');
                  toast.success('Exported to Excel');
                }}
                onCsvExport={() => {
                  if (!scheduled.length) { toast.error('No scheduled containers to export'); return; }
                  exportToCSV(scheduled.map(toExportRow), 'Scheduled_Containers');
                  toast.success('Exported to CSV');
                }}
                onPrint={() => {
                  if (!scheduled.length) { toast.error('No scheduled containers to print'); return; }
                  printTable('Scheduled Containers', `${scheduled.length} container(s)`, PRINT_COLS, scheduled.map(toPrintRow));
                }}
                disabled={loading}
              />
            </CardHeader>
            <CardContent className="pt-4">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : scheduled.length === 0 ? (
                <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
                  <CalendarClock className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No scheduled containers</p>
                </div>
              ) : (
                <SummaryTable rows={scheduled} />
              )}
            </CardContent>
          </Card>

          {/* Completed table */}
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#2ecc71]" />
                <CardTitle className="text-base">Completed Containers</CardTitle>
                {!loading && (
                  <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#2ecc71]/15 text-[#2ecc71]">
                    {completed.length}
                  </span>
                )}
              </div>
              <ExportMenu
                onExcelExport={async () => {
                  if (!completed.length) { toast.error('No completed containers to export'); return; }
                  await exportToExcel(completed.map(toExportRow), 'Completed_Containers');
                  toast.success('Exported to Excel');
                }}
                onCsvExport={() => {
                  if (!completed.length) { toast.error('No completed containers to export'); return; }
                  exportToCSV(completed.map(toExportRow), 'Completed_Containers');
                  toast.success('Exported to CSV');
                }}
                onPrint={() => {
                  if (!completed.length) { toast.error('No completed containers to print'); return; }
                  printTable('Completed Containers', `${completed.length} container(s)`, PRINT_COLS, completed.map(toPrintRow));
                }}
                disabled={loading}
              />
            </CardHeader>
            <CardContent className="pt-4">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : completed.length === 0 ? (
                <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No completed containers</p>
                </div>
              ) : (
                <SummaryTable rows={completed} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Productivity Report ── */}
      {activeTab === 'productivity' && (() => {
        // ── Helper: compute KPIs for a given subset of rows and shed area ──
        function computeKpis(rows: ProductivityRow[], shedArea: number) {
          const containers = rows.length;
          const teus = rows.reduce((s, r) => s + teuFactor(r.teu_size), 0);
          const cargo = rows.reduce((s, r) => s + r.total_cargo, 0);
          const durMins = rows.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
          const labourHrs = durMins / 60;
          const timedCount = rows.filter((r) => r.duration_minutes !== null).length;
          return {
            containers, teus, cargo, labourHrs, timedCount,
            tonnesPerM2Year:     shedArea > 0 ? (cargo / shedArea) * annualisationFactor : null,
            containersPerM2Year: shedArea > 0 ? (containers / shedArea) * annualisationFactor : null,
            teusPerM2Year:       shedArea > 0 ? (teus / shedArea) * annualisationFactor : null,
            tonnesPerManHour:     labourHrs > 0 ? cargo / labourHrs : null,
            containersPerManHour: labourHrs > 0 ? containers / labourHrs : null,
            teusPerManHour:       labourHrs > 0 ? teus / labourHrs : null,
            count20: rows.filter((r) => r.teu_size === '20ft').length,
            count40: rows.filter((r) => r.teu_size === '40ft').length,
          };
        }

        // Annualisation factor from date range
        let annualisationFactor = 1;
        if (prodDateFrom && prodDateTo) {
          const days = Math.max(1, (new Date(prodDateTo).getTime() - new Date(prodDateFrom).getTime()) / 86400000 + 1);
          annualisationFactor = 365 / days;
        }

        const shed6Data = productivityData.filter((r) => r.destuff_shed === 'Shed 6');
        const shed7Data = productivityData.filter((r) => r.destuff_shed === 'Shed 7');

        // Current view's data + shed area based on filter
        const viewData   = prodShedFilter === 'all' ? productivityData : prodShedFilter === 'Shed 6' ? shed6Data : shed7Data;
        const viewArea   = prodShedFilter === 'all' ? (shed6Area + shed7Area) : prodShedFilter === 'Shed 6' ? shed6Area : shed7Area;
        const kpis       = computeKpis(viewData, viewArea);
        const totalShedArea = shed6Area + shed7Area;

        const shedNotConfigured = !shedSettingsLoaded || viewArea === 0;
        const noTimes = kpis.timedCount === 0 && kpis.containers > 0;

        interface KpiCardProps { label: string; formula: string; value: number | null; unit: string; icon: React.ReactNode; missing?: string; }
        function KpiCard({ label, formula, value, unit, icon, missing }: KpiCardProps) {
          return (
            <Card className="bg-card border-border h-full">
              <CardContent className="pt-5 pb-4 flex flex-col gap-3 h-full">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">{icon}</div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">{formula}</p>
                  </div>
                </div>
                <div className="mt-auto">
                  {value !== null ? (
                    <div className="flex items-end gap-1.5">
                      <span className="text-3xl font-bold tabular-nums leading-none">{fmt2(value)}</span>
                      <span className="text-xs text-muted-foreground pb-0.5">{unit}</span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">{missing ?? '—'}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        }

        // ── Mini KPI row for Combined CSP comparison table ──
        function ShedKpiRow({ label, shed6Val, shed7Val, unit }: { label: string; shed6Val: number | null; shed7Val: number | null; unit: string }) {
          return (
            <tr className="border-b border-border last:border-0">
              <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{label}</td>
              <td className="py-2 px-3 text-right text-xs font-medium whitespace-nowrap">
                {shed6Val !== null ? <>{fmt2(shed6Val)} <span className="text-muted-foreground text-[10px]">{unit}</span></> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2 px-3 text-right text-xs font-medium whitespace-nowrap">
                {shed7Val !== null ? <>{fmt2(shed7Val)} <span className="text-muted-foreground text-[10px]">{unit}</span></> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2 px-3 text-right text-xs font-semibold whitespace-nowrap text-primary">
                {shed6Val !== null && shed7Val !== null
                  ? <>{fmt2(shed6Val + shed7Val)} <span className="text-muted-foreground font-normal text-[10px]">{unit}</span></>
                  : shed6Val !== null ? <>{fmt2(shed6Val)} <span className="text-muted-foreground font-normal text-[10px]">{unit}</span></> 
                  : shed7Val !== null ? <>{fmt2(shed7Val)} <span className="text-muted-foreground font-normal text-[10px]">{unit}</span></> 
                  : <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          );
        }

        return (
          <div className="space-y-6">

            {/* ── Date filter + shed area warning ──────────────────── */}
            <Card className="bg-card border-border">
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">From</Label>
                    <Input type="date" value={prodDateFrom} onChange={(e) => setProdDateFrom(e.target.value)} className="bg-background border-border h-9 w-44" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">To</Label>
                    <Input type="date" value={prodDateTo} onChange={(e) => setProdDateTo(e.target.value)} className="bg-background border-border h-9 w-44" />
                  </div>
                  <Button variant="default" size="sm" className="gap-2 h-9 shrink-0" onClick={() => fetchProductivity(prodDateFrom, prodDateTo)} disabled={loading}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh
                  </Button>
                  {(prodDateFrom || prodDateTo) && (
                    <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => { setProdDateFrom(''); setProdDateTo(''); fetchProductivity('', ''); }}>
                      Clear
                    </Button>
                  )}
                  {shedNotConfigured && (
                    <div className="flex items-center gap-2 ml-auto text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Shed area not configured.</span>
                      <Link to="/settings" className="underline underline-offset-2 font-medium flex items-center gap-0.5 hover:opacity-80">
                        Go to Settings <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Shed filter tabs ─────────────────────────────────── */}
            <div className="flex flex-wrap gap-2">
              {([
                { key: 'all',    label: 'Combined (CSP)',   color: 'text-primary' },
                { key: 'Shed 6', label: 'Shed 6',           color: 'text-[#3498db]' },
                { key: 'Shed 7', label: 'Shed 7',           color: 'text-[#9b59b6]' },
              ] as const).map(({ key, label }) => (
                <Button
                  key={key}
                  variant={prodShedFilter === key ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setProdShedFilter(key)}
                >
                  <Warehouse className="h-3.5 w-3.5" />
                  {label}
                  {!loading && (
                    <span className={`ml-1 inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium ${prodShedFilter === key ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {key === 'all' ? productivityData.length : key === 'Shed 6' ? shed6Data.length : shed7Data.length}
                    </span>
                  )}
                </Button>
              ))}
            </div>

            {/* ── Auto-computed summary cards ───────────────────────── */}
            {!loading && kpis.containers > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="bg-card border-border">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="h-4 w-4 text-[#2ecc71]" /><span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Containers</span></div>
                    <p className="text-2xl font-bold">{kpis.containers}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{kpis.count20} × 20ft · {kpis.count40} × 40ft</p>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-1"><Container className="h-4 w-4 text-violet-500" /><span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total TEUs</span></div>
                    <p className="text-2xl font-bold">{kpis.teus}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">destuffed</p>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-1"><Package className="h-4 w-4 text-[#3498db]" /><span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Cargo Units</span></div>
                    <p className="text-2xl font-bold">{kpis.cargo.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">total qty handled</p>
                  </CardContent>
                </Card>
                <Card className="bg-card border-border">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-1"><Clock className="h-4 w-4 text-[#f39c12]" /><span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Labour Hours</span></div>
                    <p className="text-2xl font-bold">{kpis.labourHrs > 0 ? fmt2(kpis.labourHrs) : '—'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {kpis.labourHrs > 0
                        ? `auto · ${kpis.timedCount} container${kpis.timedCount !== 1 ? 's' : ''} timed`
                        : 'no start/end times recorded'}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Combined (CSP) comparison table — only when 'all' selected ── */}
            {prodShedFilter === 'all' && !loading && productivityData.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Warehouse className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base">CSP Combined Productivity</CardTitle>
                    <span className="text-xs text-muted-foreground ml-1">— side-by-side shed comparison</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="w-full overflow-x-auto">
                    <table className="w-full min-w-max text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase whitespace-nowrap">Metric</th>
                          <th className="text-right py-2.5 px-3 text-xs font-medium text-[#3498db] uppercase whitespace-nowrap">Shed 6</th>
                          <th className="text-right py-2.5 px-3 text-xs font-medium text-[#9b59b6] uppercase whitespace-nowrap">Shed 7</th>
                          <th className="text-right py-2.5 px-3 text-xs font-medium text-primary uppercase whitespace-nowrap">CSP Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Volume rows */}
                        <tr className="border-b border-border bg-muted/20">
                          <td colSpan={4} className="py-1.5 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Volume</td>
                        </tr>
                        <ShedKpiRow label="Containers" shed6Val={shed6Data.length} shed7Val={shed7Data.length} unit="containers" />
                        <ShedKpiRow label="TEUs" shed6Val={computeKpis(shed6Data, shed6Area).teus} shed7Val={computeKpis(shed7Data, shed7Area).teus} unit="TEUs" />
                        <ShedKpiRow label="Cargo Units" shed6Val={computeKpis(shed6Data, shed6Area).cargo} shed7Val={computeKpis(shed7Data, shed7Area).cargo} unit="units" />
                        {/* Shed area rows */}
                        <tr className="border-b border-border bg-muted/20">
                          <td colSpan={4} className="py-1.5 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Shed Area Productivity{annualisationFactor !== 1 ? ` (annualised ×${fmt2(annualisationFactor)})` : ''}</td>
                        </tr>
                        <ShedKpiRow label="Tonnes / m² / year" shed6Val={computeKpis(shed6Data, shed6Area).tonnesPerM2Year} shed7Val={computeKpis(shed7Data, shed7Area).tonnesPerM2Year} unit="t/m²/yr" />
                        <ShedKpiRow label="Containers / m² / year" shed6Val={computeKpis(shed6Data, shed6Area).containersPerM2Year} shed7Val={computeKpis(shed7Data, shed7Area).containersPerM2Year} unit="cont/m²/yr" />
                        <ShedKpiRow label="TEUs / m² / year" shed6Val={computeKpis(shed6Data, shed6Area).teusPerM2Year} shed7Val={computeKpis(shed7Data, shed7Area).teusPerM2Year} unit="TEU/m²/yr" />
                        {/* Crew rows */}
                        <tr className="border-b border-border bg-muted/20">
                          <td colSpan={4} className="py-1.5 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Crew Productivity</td>
                        </tr>
                        <ShedKpiRow label="Labour Hours" shed6Val={computeKpis(shed6Data, shed6Area).labourHrs || null} shed7Val={computeKpis(shed7Data, shed7Area).labourHrs || null} unit="hrs" />
                        <ShedKpiRow label="Tonnes / man-hour" shed6Val={computeKpis(shed6Data, shed6Area).tonnesPerManHour} shed7Val={computeKpis(shed7Data, shed7Area).tonnesPerManHour} unit="t/man-hr" />
                        <ShedKpiRow label="Containers / man-hour" shed6Val={computeKpis(shed6Data, shed6Area).containersPerManHour} shed7Val={computeKpis(shed7Data, shed7Area).containersPerManHour} unit="cont/man-hr" />
                        <ShedKpiRow label="TEUs / man-hour" shed6Val={computeKpis(shed6Data, shed6Area).teusPerManHour} shed7Val={computeKpis(shed7Data, shed7Area).teusPerManHour} unit="TEU/man-hr" />
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border bg-muted/30">
                          <td className="py-2.5 px-3 text-xs font-medium text-muted-foreground">Shed Area (m²)</td>
                          <td className="py-2.5 px-3 text-right text-xs font-semibold text-[#3498db]">{shed6Area > 0 ? shed6Area.toLocaleString() : '—'}</td>
                          <td className="py-2.5 px-3 text-right text-xs font-semibold text-[#9b59b6]">{shed7Area > 0 ? shed7Area.toLocaleString() : '—'}</td>
                          <td className="py-2.5 px-3 text-right text-xs font-semibold text-primary">{totalShedArea > 0 ? totalShedArea.toLocaleString() : '—'}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Section 1: Shed Area Productivity ───────────────── */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 border-b border-border">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Warehouse className="h-4 w-4 text-[#3498db]" />
                    <CardTitle className="text-base">
                      Shed Area Productivity
                      {prodShedFilter !== 'all' && <span className="ml-2 text-sm font-normal text-muted-foreground">— {prodShedFilter}</span>}
                    </CardTitle>
                  </div>
                  {viewArea > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Shed area: <span className="font-semibold text-foreground">{viewArea.toLocaleString()} m²</span>
                      {annualisationFactor !== 1 && <span className="ml-1 text-muted-foreground/60">(×{fmt2(annualisationFactor)} annualised)</span>}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Throughput divided by shed storage area. Shed area is configured once in Settings.
                </p>
              </CardHeader>
              <CardContent className="pt-5">
                {loading ? (
                  <div className="flex items-center justify-center py-10"><div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full" /></div>
                ) : kpis.containers === 0 ? (
                  <div className="py-8 flex flex-col items-center gap-2 text-muted-foreground"><TrendingUp className="h-7 w-7 opacity-30" /><p className="text-sm">No completed containers found for this period.</p></div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <KpiCard label="Tonnes / m² / year" formula="Cargo Units Handled ÷ Shed Area" value={kpis.tonnesPerM2Year} unit="t/m²/yr" icon={<TrendingUp className="h-5 w-5 text-[#3498db]" />} missing={shedNotConfigured ? 'Configure shed area in Settings' : undefined} />
                      <KpiCard label="Containers / m² / year" formula="Containers Destuffed ÷ Shed Area" value={kpis.containersPerM2Year} unit="cont/m²/yr" icon={<Container className="h-5 w-5 text-[#9b59b6]" />} missing={shedNotConfigured ? 'Configure shed area in Settings' : undefined} />
                      <KpiCard label="TEUs / m² / year" formula="TEUs Destuffed ÷ Shed Area" value={kpis.teusPerM2Year} unit="TEU/m²/yr" icon={<Box className="h-5 w-5 text-[#2ecc71]" />} missing={shedNotConfigured ? 'Configure shed area in Settings' : undefined} />
                    </div>
                    <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { label: 'Tonnes/m²/year', num: `${kpis.cargo.toLocaleString()} units`, den: `${viewArea > 0 ? viewArea.toLocaleString() : '? (not set)'} m²` },
                        { label: 'Containers/m²/year', num: `${kpis.containers}`, den: `${viewArea > 0 ? viewArea.toLocaleString() : '? (not set)'} m²` },
                        { label: 'TEUs/m²/year', num: `${kpis.teus} TEUs`, den: `${viewArea > 0 ? viewArea.toLocaleString() : '? (not set)'} m²` },
                      ].map((f) => (
                        <div key={f.label} className="rounded-md border border-border bg-muted/30 px-4 py-2.5 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{f.label}</p>
                          <div className="inline-flex flex-col items-center">
                            <span className="text-xs font-medium border-b border-foreground/40 pb-0.5 px-2">{f.num}</span>
                            <span className="text-xs text-muted-foreground pt-0.5">{f.den}</span>
                          </div>
                          {annualisationFactor !== 1 && <p className="text-[10px] text-muted-foreground mt-1">× {fmt2(annualisationFactor)} annualised</p>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Section 2: Crew Productivity ────────────────────── */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 border-b border-border">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-[#f39c12]" />
                    <CardTitle className="text-base">
                      Productivity of Destuffing Crew
                      {prodShedFilter !== 'all' && <span className="ml-2 text-sm font-normal text-muted-foreground">— {prodShedFilter}</span>}
                    </CardTitle>
                  </div>
                  {kpis.labourHrs > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Labour hours: <span className="font-semibold text-foreground">{fmt2(kpis.labourHrs)} hrs</span>
                      <span className="ml-1 text-muted-foreground/60">(auto from destuffing times)</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Throughput divided by total destuffing labour hours — automatically summed from container start and end times.
                </p>
              </CardHeader>
              <CardContent className="pt-5">
                {loading ? (
                  <div className="flex items-center justify-center py-10"><div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full" /></div>
                ) : kpis.containers === 0 ? (
                  <div className="py-8 flex flex-col items-center gap-2 text-muted-foreground"><Users className="h-7 w-7 opacity-30" /><p className="text-sm">No completed containers found for this period.</p></div>
                ) : (
                  <>
                    {noTimes && (
                      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 mb-4">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        No start/end times recorded on these containers. Add destuffing times to enable crew productivity calculations.
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <KpiCard label="Tonnes / man-hour" formula="Cargo Units Handled ÷ Labour Hours" value={kpis.tonnesPerManHour} unit="t/man-hr" icon={<TrendingUp className="h-5 w-5 text-[#f39c12]" />} missing={noTimes ? 'No destuffing times recorded' : undefined} />
                      <KpiCard label="Container / man-hour" formula="Containers Destuffed ÷ Labour Hours" value={kpis.containersPerManHour} unit="cont/man-hr" icon={<Container className="h-5 w-5 text-[#e74c3c]" />} missing={noTimes ? 'No destuffing times recorded' : undefined} />
                      <KpiCard label="TEU / man-hour" formula="TEUs Destuffed ÷ Labour Hours" value={kpis.teusPerManHour} unit="TEU/man-hr" icon={<Box className="h-5 w-5 text-[#1abc9c]" />} missing={noTimes ? 'No destuffing times recorded' : undefined} />
                    </div>
                    <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { label: 'Tonnes/man-hour', num: `${kpis.cargo.toLocaleString()} units`, den: `${kpis.labourHrs > 0 ? fmt2(kpis.labourHrs) : '? (no times)'} hrs` },
                        { label: 'Container/man-hour', num: `${kpis.containers}`, den: `${kpis.labourHrs > 0 ? fmt2(kpis.labourHrs) : '? (no times)'} hrs` },
                        { label: 'TEU/man-hour', num: `${kpis.teus} TEUs`, den: `${kpis.labourHrs > 0 ? fmt2(kpis.labourHrs) : '? (no times)'} hrs` },
                      ].map((f) => (
                        <div key={f.label} className="rounded-md border border-border bg-muted/30 px-4 py-2.5 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{f.label}</p>
                          <div className="inline-flex flex-col items-center">
                            <span className="text-xs font-medium border-b border-foreground/40 pb-0.5 px-2">{f.num}</span>
                            <span className="text-xs text-muted-foreground pt-0.5">{f.den}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Per-container detail table ───────────────────────── */}
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">Container Detail
                    {prodShedFilter !== 'all' && <span className="ml-2 text-sm font-normal text-muted-foreground">— {prodShedFilter}</span>}
                  </CardTitle>
                  {!loading && kpis.containers > 0 && (
                    <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary">{kpis.containers}</span>
                  )}
                </div>
                <ExportMenu onExcelExport={handleProdExcelExport} onCsvExport={handleProdCsvExport} onPrint={handleProdPrint} disabled={loading} />
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12"><div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full" /></div>
                ) : viewData.length === 0 ? (
                  <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground"><TrendingUp className="h-8 w-8 opacity-30" /><p className="text-sm">No completed containers found.</p></div>
                ) : (
                  <div className="w-full max-w-full overflow-x-auto">
                    <table className="w-full min-w-max text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">#</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Container ID</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Vessel</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">TEU</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Shed</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Destuff Date</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Start</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">End</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Duration</th>
                          <th className="text-right py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Cargo Qty</th>
                          <th className="text-right py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Items/Hr</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewData.map((r, i) => (
                          <tr key={r.container_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground text-xs">{i + 1}</td>
                            <td className="py-2.5 px-4 whitespace-nowrap font-semibold">{r.container_id}</td>
                            <td className="py-2.5 px-4 whitespace-nowrap">{r.vessel_name}</td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              {r.teu_size ? (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.teu_size === '20ft' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400' : 'bg-orange-500/15 text-orange-600 dark:text-orange-400'}`}>
                                  {r.teu_size} ({teuFactor(r.teu_size)} TEU)
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              {r.destuff_shed ? (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.destuff_shed === 'Shed 6' ? 'bg-[#3498db]/15 text-[#3498db]' : 'bg-[#9b59b6]/15 text-[#9b59b6]'}`}>
                                  {r.destuff_shed}
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground">{r.destuff_date || '—'}</td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground">{r.start_time ? r.start_time.slice(0, 5) : '—'}</td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground">{r.end_time ? r.end_time.slice(0, 5) : '—'}</td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1 ${r.duration_minutes !== null ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {r.duration_minutes !== null && <Clock className="h-3 w-3 text-muted-foreground shrink-0" />}
                                {fmtDuration(r.duration_minutes)}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-right font-medium">{r.total_cargo.toLocaleString()}</td>
                            <td className="py-2.5 px-4 whitespace-nowrap text-right">
                              {r.items_per_hour !== null ? (
                                <span className={`font-medium ${r.items_per_hour >= 100 ? 'text-[#2ecc71]' : r.items_per_hour >= 50 ? 'text-[#f39c12]' : 'text-destructive'}`}>{r.items_per_hour}</span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border bg-muted/30">
                          <td colSpan={9} className="py-2.5 px-4 text-xs font-medium text-muted-foreground">
                            {kpis.containers} container{kpis.containers !== 1 ? 's' : ''} · {kpis.teus} TEUs · {kpis.labourHrs > 0 ? `${fmt2(kpis.labourHrs)} labour hrs` : 'no times recorded'}
                          </td>
                          <td className="py-2.5 px-4 text-right text-xs font-semibold">{kpis.cargo.toLocaleString()}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* ── Damage Report ── */}
      {activeTab === 'damage' && (        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
            <CardTitle className="text-base">Damage Report</CardTitle>
            <ExportMenu
              onExcelExport={handleExcelExport}
              onCsvExport={handleCsvExport}
              onPrint={handlePrint}
              disabled={loading}
            />
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="w-full max-w-full overflow-x-auto">
                {(() => {
                  const groups: Record<string, { damageTypes: string[]; count: number; remarks: string[] }> = {};
                  damageData.forEach((row) => {
                    if (!groups[row.container_id]) {
                      groups[row.container_id] = { damageTypes: [], count: 0, remarks: [] };
                    }
                    if (!groups[row.container_id].damageTypes.includes(row.damage)) {
                      groups[row.container_id].damageTypes.push(row.damage);
                    }
                    groups[row.container_id].count += 1;
                    if (row.remarks) groups[row.container_id].remarks.push(row.remarks);
                  });
                  const containerIds = Object.keys(groups).sort();
                  return (
                    <table className="w-full min-w-max text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Container ID</th>
                          <th className="text-right py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Damaged Items</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Damage Types</th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {containerIds.map((cid) => {
                          const group = groups[cid];
                          return (
                            <tr key={cid} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="py-2.5 px-4 whitespace-nowrap font-semibold">{cid}</td>
                              <td className="py-2.5 px-4 whitespace-nowrap text-right">{group.count}</td>
                              <td className="py-2.5 px-4 whitespace-nowrap text-[#f39c12]">{group.damageTypes.join(', ')}</td>
                              <td className="py-2.5 px-4 whitespace-nowrap max-w-[300px] truncate">{group.remarks.join('; ') || '—'}</td>
                            </tr>
                          );
                        })}
                        {containerIds.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-12 text-center text-muted-foreground">No damage records found</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
