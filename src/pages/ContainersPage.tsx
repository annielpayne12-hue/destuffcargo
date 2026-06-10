import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Ship, Search, Box, FileUp, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { validateContainerId, validateVesselName, sanitizeInput } from '@/lib/security';
import { exportToExcel, exportToCSV, printTable } from '@/lib/export';
import { ExportMenu } from '@/components/common/ExportMenu';
import { TablePagination } from '@/components/common/TablePagination';
import type { Container } from '@/types/types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const COLUMNS = 'container_id,vessel_name,arrival_date,destuff_date,destuff_shed,teu_size,start_time,end_time,status,expected_cargo_count,created_at';

const emptyContainer: Omit<Container, 'created_at'> = {
  container_id: '',
  vessel_name: '',
  arrival_date: '',
  destuff_date: null,
  destuff_shed: null,
  teu_size: null,
  start_time: null,
  end_time: null,
  status: 'Scheduled',
  expected_cargo_count: null,
};

export default function ContainersPage() {
  // Server-side page state
  const [rows, setRows] = useState<Container[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Container | null>(null);
  const [form, setForm] = useState<Omit<Container, 'created_at'>>(emptyContainer);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ── Step-2 manifest state (Add Container wizard) ─────────────────────
  const [addStep, setAddStep] = useState<1 | 2>(1);
  const [newContainerId, setNewContainerId] = useState('');
  const [manifestUploading, setManifestUploading] = useState(false);
  const [manifestDragOver, setManifestDragOver] = useState(false);
  const [manifestFileName, setManifestFileName] = useState('');
  const [manifestUrl, setManifestUrl] = useState('');
  const manifestFileInputRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const { canManageContainers } = useAuth();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Build a base query with current filters applied ───────────────────
  function buildQuery() {
    let q = supabase.from('containers').select(COLUMNS, { count: 'exact' });
    if (debouncedSearch.trim()) {
      const s = debouncedSearch.trim();
      q = q.or(`container_id.ilike.%${s}%,vessel_name.ilike.%${s}%`);
    }
    if (statusFilter !== 'all') {
      q = q.eq('status', statusFilter);
    }
    return q.order('arrival_date', { ascending: false });
  }

  // ── Fetch one page from the database ─────────────────────────────────
  async function fetchPage(targetPage: number) {
    setLoading(true);
    const from = (targetPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count, error } = await buildQuery().range(from, to);
    if (error) {
      toast.error('Failed to load containers');
      setLoading(false);
      return;
    }
    setRows(Array.isArray(data) ? (data as Container[]) : []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  // ── Fetch ALL matching rows for export (no range) ─────────────────────
  async function fetchAllForExport(): Promise<Container[]> {
    const { data, error } = await buildQuery();
    if (error) {
      toast.error('Export failed: could not fetch data');
      return [];
    }
    return Array.isArray(data) ? (data as Container[]) : [];
  }

  // ── Debounce search input ─────────────────────────────────────────────
  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  }

  // ── Re-fetch whenever page / filters change ───────────────────────────
  useEffect(() => {
    // Page 1 on initial mount — defer so the browser paints the shell first
    if (page === 1 && !debouncedSearch && statusFilter === 'all') {
      const handle = (window.requestIdleCallback ?? setTimeout)(() => fetchPage(page), { timeout: 400 });
      return () => {
        if (typeof handle === 'number') clearTimeout(handle);
        else (window.cancelIdleCallback ?? clearTimeout)(handle);
      };
    }
    fetchPage(page);
  }, [page, debouncedSearch, statusFilter]);

  // ── Status filter: reset to page 1 ───────────────────────────────────
  function handleStatusFilter(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  // ── Poll: re-fetch current page every 30 s (Realtime incompatible with sb_publishable_ keys) ──
  useEffect(() => {
    const poll = setInterval(() => fetchPage(page), 30_000);
    return () => clearInterval(poll);
  }, [page, debouncedSearch, statusFilter]);

  function resetManifestState() {
    setAddStep(1);
    setNewContainerId('');
    setManifestUploading(false);
    setManifestDragOver(false);
    setManifestFileName('');
    setManifestUrl('');
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyContainer);
    resetManifestState();
    setDialogOpen(true);
  }

  function toTimeInput(value: string | null): string {
    if (!value) return '';
    const match = value.match(/(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : '';
  }

  function openEdit(c: Container) {
    setEditing(c);
    setForm({
      container_id: c.container_id,
      vessel_name: c.vessel_name,
      arrival_date: c.arrival_date,
      destuff_date: c.destuff_date || null,
      destuff_shed: c.destuff_shed || null,
      teu_size: c.teu_size || null,
      start_time: toTimeInput(c.start_time),
      end_time: toTimeInput(c.end_time),
      status: c.status,
      expected_cargo_count: c.expected_cargo_count || null,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    const cidCheck = validateContainerId(form.container_id);
    if (!cidCheck.valid) { toast.error(cidCheck.message); return; }

    const vesselCheck = validateVesselName(form.vessel_name);
    if (!vesselCheck.valid) { toast.error(vesselCheck.message); return; }

    if (!form.arrival_date) { toast.error('Arrival date is required'); return; }

    const expectedCount = form.expected_cargo_count !== null && form.expected_cargo_count !== undefined
      ? Number(form.expected_cargo_count) : null;
    if (expectedCount !== null && (isNaN(expectedCount) || expectedCount < 0 || expectedCount > 999999)) {
      toast.error('Expected cargo count must be between 0 and 999,999');
      return;
    }

    const sanitizedVessel = sanitizeInput(form.vessel_name);

    if (editing) {
      const { error } = await supabase.from('containers').update({
        vessel_name: sanitizedVessel,
        arrival_date: form.arrival_date,
        destuff_date: form.destuff_date || null,
        destuff_shed: form.destuff_shed || null,
        teu_size: form.teu_size || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        status: form.status,
        expected_cargo_count: expectedCount,
      }).eq('container_id', form.container_id);
      if (error) { toast.error(error.message); return; }
      toast.success('Container updated successfully');
    } else {
      const { error } = await supabase.from('containers').insert({
        container_id: form.container_id.trim().toUpperCase(),
        vessel_name: sanitizedVessel,
        arrival_date: form.arrival_date,
        destuff_date: form.destuff_date || null,
        destuff_shed: form.destuff_shed || null,
        teu_size: form.teu_size || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        status: form.status,
        expected_cargo_count: expectedCount,
      });
      if (error) { toast.error(error.message); return; }
      toast.success('Container added successfully');
      // Advance to manifest upload step
      setNewContainerId(form.container_id.trim().toUpperCase());
      setAddStep(2);
      fetchPage(page);
      return;
    }
    setDialogOpen(false);
    fetchPage(page);
  }

  function openDelete(containerId: string) {
    setDeleteId(containerId);
    setDeleteOpen(true);
  }

  // ── Step-2: upload manifest file as-is to storage ─────────────────────
  const handleManifestUpload = useCallback(async (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['pdf', 'xlsx', 'xls', 'csv'].includes(ext)) {
      toast.error('Supported formats: PDF, Excel (.xlsx, .xls) or CSV');
      return;
    }
    setManifestUploading(true);
    setManifestFileName(f.name);
    try {
      const cid = newContainerId;
      const path = `${cid}/${Date.now()}_${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('manifests').upload(path, f, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('manifests').getPublicUrl(path);
      const { error: dbErr } = await supabase
        .from('containers')
        .update({ manifest_url: urlData.publicUrl })
        .eq('container_id', cid);
      if (dbErr) throw dbErr;
      setManifestUrl(urlData.publicUrl);
      toast.success('Manifest uploaded successfully');
    } catch (e: unknown) {
      toast.error('Upload failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setManifestUploading(false);
    }
  }, [newContainerId]);

  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await supabase.from('containers').delete().eq('container_id', deleteId);
    setDeleteOpen(false);
    setDeleteId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Container deleted');
    // If deleting the last item on the page, step back one page
    const newTotal = totalCount - 1;
    const maxPage = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
    const targetPage = page > maxPage ? maxPage : page;
    setPage(targetPage);
    if (targetPage === page) fetchPage(page);
  }

  async function handleExcelExport() {
    const all = await fetchAllForExport();
    if (!all.length) { toast.error('No data to export'); return; }
    await exportToExcel(all.map((c) => ({
      'Container ID': c.container_id, 'Vessel': c.vessel_name,
      'TEU Size': c.teu_size || '',
      'Arrival Date': c.arrival_date, 'Destuff Date': c.destuff_date || '',
      'Shed': c.destuff_shed || '', 'Start Time': c.start_time || '',
      'End Time': c.end_time || '', 'Status': c.status,
      'Expected Cargo Count': c.expected_cargo_count ?? '',
    })), 'Containers');
    toast.success('Exported to Excel');
  }

  async function handleCsvExport() {
    const all = await fetchAllForExport();
    if (!all.length) { toast.error('No data to export'); return; }
    exportToCSV(all.map((c) => ({
      'Container ID': c.container_id, 'Vessel': c.vessel_name,
      'TEU Size': c.teu_size || '',
      'Arrival Date': c.arrival_date, 'Destuff Date': c.destuff_date || '',
      'Shed': c.destuff_shed || '', 'Start Time': c.start_time || '',
      'End Time': c.end_time || '', 'Status': c.status,
      'Expected Cargo Count': c.expected_cargo_count ?? '',
    })), 'Containers');
    toast.success('Exported to CSV');
  }

  async function handlePrint() {
    const all = await fetchAllForExport();
    if (!all.length) { toast.error('No data to print'); return; }
    printTable(
      'Containers List',
      `Status: ${statusFilter === 'all' ? 'All' : statusFilter} — ${totalCount} container(s)`,
      ['Container ID', 'Vessel', 'TEU', 'Arrival Date', 'Destuff Date', 'Shed', 'Start', 'End', 'Status'],
      all.map((c) => [c.container_id, c.vessel_name, c.teu_size || '—', c.arrival_date, c.destuff_date, c.destuff_shed, c.start_time, c.end_time, c.status]),
    );
  }

  const hasActiveFilters = debouncedSearch.trim() !== '' || statusFilter !== 'all';
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-xl">Containers</h1>
          <p className="text-sm text-muted-foreground">Manage shipping containers and destuffing operations</p>
        </div>
        {canManageContainers && (
          <Button onClick={openAdd} className="shrink-0 gap-2">
            <Plus className="h-4 w-4" />
            Add Container
          </Button>
        )}
        <ExportMenu
          onExcelExport={handleExcelExport}
          onCsvExport={handleCsvExport}
          onPrint={handlePrint}
          disabled={loading}
        />
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by container ID or vessel name..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(['all', 'Scheduled', 'In Process', 'Completed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => handleStatusFilter(status)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {status === 'all' ? 'All' : status}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full max-w-full overflow-x-auto bg-card">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Container ID</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Vessel</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">TEU</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Arrival Date</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Destuff Date</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Shed</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Start Time</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">End Time</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Status</th>
              {canManageContainers && (
                <th className="text-right py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-3 px-4"><div className="h-4 w-28 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-32 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-12 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-20 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-20 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-16 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-16 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-16 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-5 w-20 bg-muted rounded animate-pulse" /></td>
                    {canManageContainers && <td className="py-3 px-4" />}
                  </tr>
                ))
              : rows.map((c) => (
                  <tr key={c.container_id} className="border-b border-border hover:bg-accent/30 cursor-pointer" onClick={() => navigate(`/containers/${c.container_id}`)}>
                    <td className="py-3 px-4 whitespace-nowrap font-medium">{c.container_id}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Ship className="h-3 w-3 text-muted-foreground shrink-0" />
                        {c.vessel_name}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {c.teu_size ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          c.teu_size === '20ft'
                            ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                            : 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                        }`}>
                          {c.teu_size}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">{c.arrival_date}</td>
                    <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">{c.destuff_date || '-'}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {c.destuff_shed ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          c.destuff_shed === 'Shed 6'
                            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}>
                          {c.destuff_shed}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">{c.start_time || '-'}</td>
                    <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">{c.end_time || '-'}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="status-badge" data-status={c.status}>{c.status}</span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {canManageContainers && (
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}>
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => openDelete(c.container_id)} title="Delete container">
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
            }
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Box className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-muted-foreground">
                      {hasActiveFilters ? 'No containers match your search.' : 'No containers added yet.'}
                    </p>
                    {!hasActiveFilters && canManageContainers && (
                      <Button onClick={openAdd} size="sm" className="gap-1">
                        <Plus className="h-4 w-4" />
                        Add First Container
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          className="px-4 pb-3"
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetManifestState(); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Container' : addStep === 1 ? 'Add Container' : 'Upload Manifest'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update container details'
                : addStep === 1
                  ? 'Register a new container — you can optionally attach a manifest next'
                  : `Container ${newContainerId} created. Attach the manifest file, or click Done to skip.`}
            </DialogDescription>
          </DialogHeader>

          {/* ── Step 1: container details form ── */}
          {(!editing || editing) && addStep === 1 && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cid">Container ID *</Label>
              <Input
                id="cid"
                value={form.container_id}
                onChange={(e) => setForm({ ...form, container_id: e.target.value.toUpperCase() })}
                disabled={!!editing}
                className="bg-background border-border h-10 uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vessel">Vessel Name *</Label>
              <Input
                id="vessel"
                value={form.vessel_name}
                onChange={(e) => setForm({ ...form, vessel_name: e.target.value.toUpperCase() })}
                className="bg-background border-border h-10 uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="arrival">Arrival Date *</Label>
              <Input
                id="arrival"
                type="date"
                value={form.arrival_date}
                onChange={(e) => setForm({ ...form, arrival_date: e.target.value })}
                className="bg-background border-border h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="destuff">Destuff Date</Label>
              <Input
                id="destuff"
                type="date"
                value={form.destuff_date || ''}
                onChange={(e) => setForm({ ...form, destuff_date: e.target.value || null })}
                className="bg-background border-border h-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start">Start Time</Label>
                <Input
                  id="start"
                  type="time"
                  value={form.start_time || ''}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value || null })}
                  className="bg-background border-border h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">End Time</Label>
                <Input
                  id="end"
                  type="time"
                  value={form.end_time || ''}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value || null })}
                  className="bg-background border-border h-10"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as 'Scheduled' | 'In Process' | 'Completed' })}>
                  <SelectTrigger className="bg-background border-border h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Scheduled">Scheduled</SelectItem>
                    <SelectItem value="In Process">In Process</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expected">Expected Cargo Count</Label>
                <Input
                  id="expected"
                  type="number"
                  min={0}
                  value={form.expected_cargo_count ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm({ ...form, expected_cargo_count: val === '' ? null : parseInt(val, 10) });
                  }}
                  placeholder="0"
                  className="bg-background border-border h-10"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Destuff Shed</Label>
                <Select
                  value={form.destuff_shed || 'none'}
                  onValueChange={(v) => setForm({ ...form, destuff_shed: v === 'none' ? null : v as 'Shed 6' | 'Shed 7' })}
                >
                  <SelectTrigger className="bg-background border-border h-10">
                    <SelectValue placeholder="Select shed" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not assigned</SelectItem>
                    <SelectItem value="Shed 6">Shed 6</SelectItem>
                    <SelectItem value="Shed 7">Shed 7</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>TEU Size</Label>
                <Select
                  value={form.teu_size || 'none'}
                  onValueChange={(v) => setForm({ ...form, teu_size: v === 'none' ? null : v as '20ft' | '40ft' })}
                >
                  <SelectTrigger className="bg-background border-border h-10">
                    <SelectValue placeholder="Select size" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    <SelectItem value="20ft">20ft</SelectItem>
                    <SelectItem value="40ft">40ft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          )}


          {/* ── Step 2: manifest upload (Add-only) ── */}
          {!editing && addStep === 2 && (
            <div className="space-y-4 py-2">
              <div
                onDragOver={(e) => { e.preventDefault(); setManifestDragOver(true); }}
                onDragLeave={() => setManifestDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setManifestDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) handleManifestUpload(f);
                }}
                onClick={() => !manifestUploading && manifestFileInputRef.current?.click()}
                className={`cursor-pointer border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition-colors
                  ${manifestDragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60 hover:bg-muted/40'}
                  ${manifestUploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <FileUp className="h-6 w-6 text-primary" />
                </div>
                {manifestUploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                    <p className="text-sm text-muted-foreground">Uploading {manifestFileName}…</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="font-medium text-sm">Drop your manifest here, or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, Excel (.xlsx, .xls) or CSV — max 20 MB</p>
                  </div>
                )}
              </div>
              <input
                ref={manifestFileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleManifestUpload(f); e.target.value = ''; }}
              />
              {manifestUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="flex-1 min-w-0 truncate text-muted-foreground">{manifestFileName}</span>
                  <a
                    href={manifestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-primary hover:underline flex items-center gap-1"
                  >
                    View <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {addStep === 1 ? (
              <>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave}>{editing ? 'Update' : 'Save'}</Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => { setDialogOpen(false); resetManifestState(); }}>
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Container?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the container and all associated cargo records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
