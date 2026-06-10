import { useState, useEffect, useRef } from 'react';
import { Plus, Upload, Trash2, Pencil, X, Check, FileText, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface YardEntry {
  id: string;
  arrival_date: string;
  container_number: string;
  teus: number;
  direction: 'In' | 'Out';
  ticked: boolean;
  pdf_url: string | null;
  created_at: string;
}

interface EntryForm {
  arrival_date: string;
  container_number: string;
  teus: string;
  direction: 'In' | 'Out';
  ticked: boolean;
}

const EMPTY_FORM: EntryForm = {
  arrival_date: new Date().toISOString().slice(0, 10),
  container_number: '',
  teus: '1',
  direction: 'In',
  ticked: false,
};

const PAGE_SIZE = 25;
const BUCKET = 'yard-documents';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Import parser (CSV / Excel via xlsx lazy-loaded) ─────────────────────────

async function parseImportFile(file: File): Promise<Omit<EntryForm, 'ticked'>[]> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error('File is empty or has no data rows');

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const colIdx = (candidates: string[]) => {
      for (const c of candidates) {
        const i = headers.indexOf(c);
        if (i !== -1) return i;
      }
      return -1;
    };

    const dateIdx = colIdx(['arrival_date', 'arrivaldate', 'date']);
    const numIdx  = colIdx(['container_number', 'containernumber', 'container_no', 'container']);
    const teuIdx  = colIdx(['teus', 'teu']);
    const dirIdx  = colIdx(['direction', 'in_or_out', 'in/out', 'status']);

    if (dateIdx < 0 || numIdx < 0)
      throw new Error('Required columns not found. Expected: Arrival Date, Container Number');

    return lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const rawDir = dirIdx >= 0 ? (cols[dirIdx] ?? '') : 'In';
      const direction: 'In' | 'Out' = /^out$/i.test(rawDir.trim()) ? 'Out' : 'In';
      return {
        arrival_date: cols[dateIdx] ?? '',
        container_number: cols[numIdx] ?? '',
        teus: teuIdx >= 0 ? (cols[teuIdx] ?? '1') : '1',
        direction,
      };
    }).filter((r) => r.container_number && r.arrival_date);
  }

  // Excel
  const { read, utils } = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  if (rows.length === 0) throw new Error('Spreadsheet is empty');

  const normalise = (key: string) => key.trim().toLowerCase().replace(/\s+/g, '_');
  const findKey = (row: Record<string, unknown>, candidates: string[]) => {
    const keys = Object.keys(row).map(normalise);
    for (const c of candidates) {
      const i = keys.indexOf(c);
      if (i !== -1) return Object.keys(row)[i];
    }
    return null;
  };

  const sample = rows[0];
  const dateKey = findKey(sample, ['arrival_date', 'arrivaldate', 'date']);
  const numKey  = findKey(sample, ['container_number', 'containernumber', 'container_no', 'container']);
  const teuKey  = findKey(sample, ['teus', 'teu']);
  const dirKey  = findKey(sample, ['direction', 'in_or_out', 'in/out', 'status']);

  if (!dateKey || !numKey)
    throw new Error('Required columns not found. Expected: Arrival Date, Container Number');

  return rows.map((row) => {
    const rawDate = row[dateKey];
    let arrival_date = '';
    if (rawDate instanceof Date) {
      arrival_date = rawDate.toISOString().slice(0, 10);
    } else {
      arrival_date = String(rawDate ?? '').slice(0, 10);
    }
    const rawDir = dirKey ? String(row[dirKey] ?? '') : 'In';
    const direction: 'In' | 'Out' = /^out$/i.test(rawDir.trim()) ? 'Out' : 'In';
    return {
      arrival_date,
      container_number: String(row[numKey] ?? '').trim(),
      teus: teuKey ? String(row[teuKey] ?? '1') : '1',
      direction,
    };
  }).filter((r) => r.container_number && r.arrival_date);
}

// ── Pagination ────────────────────────────────────────────────────────────────

function TablePagination({
  currentPage, totalPages, totalItems, pageSize, onPageChange, className,
}: {
  currentPage: number; totalPages: number; totalItems: number;
  pageSize: number; onPageChange: (p: number) => void; className?: string;
}) {
  if (totalPages <= 1) return null;
  const from = (currentPage - 1) * pageSize + 1;
  const to   = Math.min(currentPage * pageSize, totalItems);
  return (
    <div className={`flex items-center justify-between gap-2 flex-wrap text-sm ${className}`}>
      <span className="text-muted-foreground text-xs">{from}–{to} of {totalItems}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
          disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>Prev</Button>
        <span className="px-2 text-xs text-muted-foreground">{currentPage} / {totalPages}</span>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
          disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)}>Next</Button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ContainerYardPage() {
  const { user } = useAuth();

  const [entries, setEntries] = useState<YardEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);

  // Add / Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<YardEntry | null>(null);
  const [form, setForm]   = useState<EntryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // PDF state inside dialog
  const [pdfFile, setPdfFile]         = useState<File | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [removePdf, setRemovePdf]     = useState(false); // flag to delete existing PDF on save
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Delete
  const [deleteOpen, setDeleteOpen]   = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<YardEntry | null>(null);

  // CSV/Excel import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // Tick optimistic toggle
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // ── Fetch ───────────────────────────────────────────────────────────────

  async function fetchEntries(targetPage: number) {
    setLoading(true);
    const from = (targetPage - 1) * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;
    const { data, count, error } = await supabase
      .from('container_yard')
      .select('id,arrival_date,container_number,teus,direction,ticked,pdf_url,created_at', { count: 'exact' })
      .order('arrival_date', { ascending: false })
      .order('created_at',   { ascending: false })
      .range(from, to);

    if (error) {
      toast.error('Failed to load container yard entries');
    } else {
      setEntries(Array.isArray(data) ? (data as YardEntry[]) : []);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  }

  useEffect(() => { fetchEntries(page); }, [page]);

  // Poll every 30 s (Realtime WebSocket incompatible with sb_publishable_ key format)
  useEffect(() => {
    const poll = setInterval(() => fetchEntries(page), 30_000);
    return () => clearInterval(poll);
  }, [page]);

  // ── Tick toggle (optimistic) ─────────────────────────────────────────────

  async function handleTickToggle(entry: YardEntry) {
    const newVal = !entry.ticked;
    setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, ticked: newVal } : e));
    setTogglingIds((prev) => new Set(prev).add(entry.id));

    const { error } = await supabase
      .from('container_yard')
      .update({ ticked: newVal, updated_at: new Date().toISOString() })
      .eq('id', entry.id);

    setTogglingIds((prev) => { const s = new Set(prev); s.delete(entry.id); return s; });

    if (error) {
      setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, ticked: entry.ticked } : e));
      toast.error('Failed to update container status');
    }
  }

  // ── PDF helpers ─────────────────────────────────────────────────────────

  async function uploadPdf(file: File, entryId: string): Promise<string | null> {
    const ext  = file.name.split('.').pop() ?? 'pdf';
    const path = `${entryId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: 'application/pdf', upsert: true,
    });
    if (error) { toast.error('PDF upload failed: ' + error.message); return null; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function deleteOldPdf(pdfUrl: string) {
    // Extract path from public URL: …/storage/v1/object/public/yard-documents/<path>
    const marker = `/object/public/${BUCKET}/`;
    const idx = pdfUrl.indexOf(marker);
    if (idx === -1) return;
    const storagePath = pdfUrl.slice(idx + marker.length);
    await supabase.storage.from(BUCKET).remove([storagePath]);
  }

  // ── Add / Edit ──────────────────────────────────────────────────────────

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setPdfFile(null);
    setRemovePdf(false);
    setDialogOpen(true);
  }

  function openEdit(entry: YardEntry) {
    setEditTarget(entry);
    setForm({
      arrival_date: entry.arrival_date,
      container_number: entry.container_number,
      teus: String(entry.teus),
      direction: entry.direction,
      ticked: entry.ticked,
    });
    setPdfFile(null);
    setRemovePdf(false);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.arrival_date)           { toast.error('Arrival date is required'); return; }
    if (!form.container_number.trim()){ toast.error('Container number is required'); return; }
    const teus = parseInt(form.teus, 10);
    if (isNaN(teus) || teus < 1)      { toast.error('TEUs must be a positive number'); return; }

    setSaving(true);
    setPdfUploading(!!pdfFile);

    const basePayload = {
      arrival_date: form.arrival_date,
      container_number: form.container_number.trim().toUpperCase(),
      teus,
      direction: form.direction,
      ticked: form.ticked,
      updated_at: new Date().toISOString(),
    };

    if (editTarget) {
      // Handle PDF changes
      let newPdfUrl = editTarget.pdf_url ?? null;

      if (removePdf && editTarget.pdf_url) {
        await deleteOldPdf(editTarget.pdf_url);
        newPdfUrl = null;
      }

      if (pdfFile) {
        if (editTarget.pdf_url && !removePdf) await deleteOldPdf(editTarget.pdf_url);
        newPdfUrl = await uploadPdf(pdfFile, editTarget.id);
        if (!newPdfUrl) { setSaving(false); setPdfUploading(false); return; }
      }

      const { error } = await supabase
        .from('container_yard')
        .update({ ...basePayload, pdf_url: newPdfUrl })
        .eq('id', editTarget.id);

      setPdfUploading(false);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success('Entry updated');
    } else {
      // Insert first to get the ID, then upload PDF
      const { data: inserted, error: insertErr } = await supabase
        .from('container_yard')
        .insert({ ...basePayload, pdf_url: null, created_by: user?.id ?? null })
        .select('id')
        .single();

      if (insertErr || !inserted) {
        setPdfUploading(false);
        setSaving(false);
        toast.error(insertErr?.message ?? 'Failed to create entry');
        return;
      }

      let pdfUrl: string | null = null;
      if (pdfFile) {
        pdfUrl = await uploadPdf(pdfFile, inserted.id);
        if (pdfUrl) {
          await supabase.from('container_yard').update({ pdf_url: pdfUrl }).eq('id', inserted.id);
        }
      }

      setPdfUploading(false);
      setSaving(false);
      toast.success('Entry added');
    }

    setDialogOpen(false);
    fetchEntries(editTarget ? page : 1);
    if (!editTarget) setPage(1);
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.pdf_url) await deleteOldPdf(deleteTarget.pdf_url);
    const { error } = await supabase.from('container_yard').delete().eq('id', deleteTarget.id);
    setDeleteOpen(false);
    setDeleteTarget(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Entry deleted');
    const newTotal  = totalCount - 1;
    const maxPage   = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
    const tp        = page > maxPage ? maxPage : page;
    setPage(tp);
    if (tp === page) fetchEntries(page);
  }

  // ── CSV / Excel Import ──────────────────────────────────────────────────

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const rows = await parseImportFile(file);
      if (rows.length === 0) { toast.error('No valid rows found in file'); setImporting(false); return; }

      const inserts = rows.map((r) => ({
        arrival_date: r.arrival_date,
        container_number: r.container_number.toUpperCase(),
        teus: Math.max(1, parseInt(r.teus, 10) || 1),
        direction: r.direction,
        ticked: false,
        pdf_url: null,
        created_by: user?.id ?? null,
      }));

      const { error } = await supabase.from('container_yard').insert(inserts);
      if (error) { toast.error(`Import failed: ${error.message}`); setImporting(false); return; }

      toast.success(`${rows.length} container${rows.length !== 1 ? 's' : ''} imported`);
      setPage(1);
      fetchEntries(1);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    }
    setImporting(false);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // ── Derived: existing PDF state inside dialog ────────────────────────────
  const existingPdfUrl = editTarget?.pdf_url ?? null;
  const showExistingPdf = !!existingPdfUrl && !removePdf && !pdfFile;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-xl text-balance">Container Yard</h1>
          <p className="text-sm text-muted-foreground">
            Track yard inventory — upload container lists or add entries manually
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt"
            className="hidden" onChange={handleImport} />
          <Button variant="outline" className="gap-2"
            onClick={() => fileInputRef.current?.click()} disabled={importing}>
            <Upload className="h-4 w-4" />
            {importing ? 'Importing…' : 'Import CSV / Excel'}
          </Button>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" />Add Entry
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        CSV / Excel columns:{' '}
        <span className="font-medium">Arrival Date</span>,{' '}
        <span className="font-medium">Container Number</span>,{' '}
        <span className="font-medium">TEUs</span>,{' '}
        <span className="font-medium">Direction</span> (In / Out)
      </p>

      {/* Table */}
      <div className="w-full max-w-full overflow-x-auto bg-card rounded-lg border border-border">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Arrival Date</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Container No.</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">TEUs</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">In / Out</th>
              <th className="text-center py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Container Present</th>
              <th className="text-center py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Document</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="py-3 px-4">
                        <Skeleton className="h-4 bg-muted" style={{ width: `${45 + (j * 17) % 45}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              : entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border hover:bg-accent/20 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
                      {fmtDate(entry.arrival_date)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-mono font-medium">
                      {entry.container_number}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">{entry.teus}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        entry.direction === 'In'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {entry.direction}
                      </span>
                    </td>

                    {/* Container Present tick */}
                    <td className="py-3 px-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Checkbox
                          checked={entry.ticked}
                          disabled={togglingIds.has(entry.id)}
                          onCheckedChange={() => handleTickToggle(entry)}
                          aria-label={`Mark ${entry.container_number} as present in yard`}
                          className="mx-auto"
                        />
                        <span className={`text-xs font-medium ${
                          entry.ticked ? 'text-primary' : 'text-muted-foreground'
                        }`}>
                          {entry.ticked ? 'Present' : 'Not confirmed'}
                        </span>
                      </div>
                    </td>

                    {/* PDF document */}
                    <td className="py-3 px-4 text-center">
                      {entry.pdf_url ? (
                        <a
                          href={entry.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          title="Open PDF"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => openEdit(entry)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button variant="ghost" size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => { setDeleteTarget(entry); setDeleteOpen(true); }}
                          title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}

            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Plus className="h-5 w-5 text-muted-foreground/60" />
                    </div>
                    <p className="text-muted-foreground">No entries yet.</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="gap-1"
                        onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-3.5 w-3.5" />Import
                      </Button>
                      <Button size="sm" className="gap-1" onClick={openAdd}>
                        <Plus className="h-3.5 w-3.5" />Add Entry
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination
          currentPage={page} totalPages={totalPages}
          totalItems={totalCount} pageSize={PAGE_SIZE}
          onPageChange={setPage} className="px-4 pb-3"
        />
      </div>

      {/* ── Add / Edit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Entry' : 'Add Container Yard Entry'}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? 'Update the container yard record.'
                : 'Add a new container to the yard inventory.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cy-date">Arrival Date *</Label>
                <Input id="cy-date" type="date" value={form.arrival_date}
                  onChange={(e) => setForm({ ...form, arrival_date: e.target.value })}
                  className="bg-background border-border h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cy-num">Container Number *</Label>
                <Input id="cy-num" value={form.container_number}
                  onChange={(e) => setForm({ ...form, container_number: e.target.value })}
                  placeholder="e.g. BSIU1234567"
                  className="bg-background border-border h-10 font-mono" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cy-teus">TEUs *</Label>
                <Input id="cy-teus" type="number" min="1" value={form.teus}
                  onChange={(e) => setForm({ ...form, teus: e.target.value })}
                  className="bg-background border-border h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cy-dir">In / Out *</Label>
                <Select value={form.direction}
                  onValueChange={(v) => setForm({ ...form, direction: v as 'In' | 'Out' })}>
                  <SelectTrigger id="cy-dir" className="bg-background border-border h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="In">In</SelectItem>
                    <SelectItem value="Out">Out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Container Present checkbox */}
            <div className="flex items-center gap-3 pt-1 p-3 rounded-md border border-border bg-background">
              <Checkbox
                id="cy-ticked"
                checked={form.ticked}
                onCheckedChange={(checked) => setForm({ ...form, ticked: !!checked })}
              />
              <div className="min-w-0">
                <Label htmlFor="cy-ticked" className="cursor-pointer font-medium">
                  Container is present in yard
                </Label>
                <p className="text-xs text-muted-foreground">
                  Tick this to confirm the container has been verified in the yard
                </p>
              </div>
            </div>

            {/* PDF upload */}
            <div className="space-y-2">
              <Label>Document (PDF)</Label>

              {/* Show existing PDF */}
              {showExistingPdf && (
                <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-background text-sm">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <a href={existingPdfUrl!} target="_blank" rel="noopener noreferrer"
                    className="flex-1 min-w-0 truncate text-primary hover:underline text-xs">
                    View current document
                    <ExternalLink className="inline h-3 w-3 ml-1" />
                  </a>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                    onClick={() => setRemovePdf(true)} title="Remove PDF">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {/* Removed notice */}
              {removePdf && (
                <div className="flex items-center gap-2 p-2 rounded-md border border-destructive/30 bg-destructive/5 text-xs text-destructive">
                  <X className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">Document will be removed on save</span>
                  <button className="underline hover:no-underline shrink-0"
                    onClick={() => setRemovePdf(false)}>Undo</button>
                </div>
              )}

              {/* New PDF picked */}
              {pdfFile && (
                <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-background text-xs">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{pdfFile.name}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                    onClick={() => setPdfFile(null)} title="Remove">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {/* Upload button */}
              {!pdfFile && (
                <>
                  <input
                    type="file" accept="application/pdf" className="hidden"
                    id="cy-pdf-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 10 * 1024 * 1024) {
                        toast.error('PDF must be under 10 MB');
                        return;
                      }
                      setPdfFile(f);
                      setRemovePdf(false);
                      e.target.value = '';
                    }}
                  />
                  <Button variant="outline" size="sm" className="gap-2 w-full"
                    type="button"
                    onClick={() => document.getElementById('cy-pdf-input')?.click()}>
                    <Upload className="h-4 w-4" />
                    {showExistingPdf ? 'Replace PDF' : 'Upload PDF'}
                  </Button>
                  <p className="text-xs text-muted-foreground">PDF only, max 10 MB</p>
                </>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              <X className="h-4 w-4 mr-1" />Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1">
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" />{pdfUploading ? 'Uploading…' : 'Saving…'}</>
                : <><Check className="h-4 w-4" />{editTarget ? 'Save Changes' : 'Add Entry'}</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ────────────────────────────────────────────────── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Delete container{' '}
              <strong className="font-mono">{deleteTarget?.container_number}</strong>{' '}
              (arrived {deleteTarget ? fmtDate(deleteTarget.arrival_date) : ''})?
              {deleteTarget?.pdf_url && ' The attached document will also be deleted.'}{' '}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
