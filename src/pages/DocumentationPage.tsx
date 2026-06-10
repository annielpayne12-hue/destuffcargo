import { useEffect, useRef, useState } from 'react';
import {
  FileText, Plus, Trash2, Printer, Search, ChevronDown, ChevronUp, Info,
  Lock, Eye, EyeOff, Eraser,
} from 'lucide-react';
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
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { TablePagination } from '@/components/common/TablePagination';
import type { Container, Cargo, OocNote } from '@/types/types';

const PAGE_SIZE = 20;
const LS_KEY = 'ooc_company_info';

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Handle both date-only (YYYY-MM-DD) and full ISO strings
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function loadCompanyInfo() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as { name: string; address: string; phone: string };
  } catch { /* ignore */ }
  return { name: '', address: '', phone: '' };
}

function saveCompanyInfo(info: { name: string; address: string; phone: string }) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(info)); } catch { /* ignore */ }
}

// ── Print via hidden iframe (no popup permission needed) ──────────────────

function printHtml(html: string): void {
  const iframe = document.createElement('iframe');
  // Off-screen with real dimensions so the browser fully renders and fires load
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:800px;height:600px;border:none;';

  // Register onload BEFORE appending — guarantees the event is caught even
  // when browsers fire it synchronously during doc.close()
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 1500);
  };

  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(html);
  doc.close();
}

// ── Number to words (for "Total No. of packages in words") ───────────────

const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
  'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function numToWords(n: number): string {
  if (n === 0) return 'ZERO';
  if (n < 0) return 'MINUS ' + numToWords(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + numToWords(n % 100) : '');
  return String(n);
}

// ── Print HTML builder ────────────────────────────────────────────────────
// Produces two pages per note: front (OOC Note) + back (Port Authority slip)

function buildPrintHtml(notes: OocNote[], cargoMap: Map<string, Cargo[]>): string {
  const MIN_ROWS = 12; // minimum blank rows so the table fills the page

  const pages = notes.flatMap((note) => {
    const items = cargoMap.get(note.id) ?? [];
    const totalQty = items.reduce((s, i) => s + (i.quantity ?? 0), 0);
    const container = note.containers;
    const vesselName = container?.vessel_name ?? '';
    const arrivalDate = fmtDate(container?.arrival_date ?? null);
    const destuffDate = fmtDate(container?.destuff_date ?? null);
    // Extract shed number from "Shed 6" → "6"
    const shedNum = (container?.destuff_shed ?? '').replace(/[^0-9]/g, '');

    // Build cargo table rows — one row per cargo item
    const dataRows = items.map((item) => {
      const marksLines = (item.marks || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
      const marksHtml = marksLines.length ? marksLines.join('<br>') : '&nbsp;';
      const qtyDesc = item.quantity ? `${item.quantity} Piece${item.quantity !== 1 ? 's' : ''}` : '&nbsp;';
      const desc = item.commodity || '&nbsp;';
      return `
        <tr>
          <td class="tdata">${note.bill_of_lading_no || '&nbsp;'}</td>
          <td class="tdata">${marksHtml}</td>
          <td class="tdata">${qtyDesc}</td>
          <td class="tdata">${desc}</td>
        </tr>`;
    });

    // Pad so table has at least MIN_ROWS data rows
    const padCount = Math.max(0, MIN_ROWS - dataRows.length);
    const padRows = Array.from({ length: padCount }, () =>
      '<tr><td class="tdata">&nbsp;</td><td class="tdata">&nbsp;</td><td class="tdata">&nbsp;</td><td class="tdata">&nbsp;</td></tr>',
    );

    const totalWords = totalQty > 0 ? numToWords(totalQty) : '';

    // ── FRONT PAGE ────────────────────────────────────────────────────────
    const front = `
      <div class="page front-page">

        <!-- Title top-right, matching the physical form -->
        <div class="top-header">
          <div class="top-left">
            <div class="hfield">
              <span class="hlabel">IMPORTER</span><span class="hdots">...........</span><span class="hval">${note.marks !== '(No Mark)' ? note.marks : ''}</span>
            </div>
          </div>
          <div class="page-title">Out of Charge Note</div>
        </div>

        <div class="ship-row">
          <span class="hlabel">SHIP</span><span class="hdots">...........</span><span class="hval ship-val">${vesselName}</span>
          <span class="arrival-label">Date of Arrival</span><span class="hdots">...........</span><span class="hval arrival-val">${arrivalDate !== '—' ? arrivalDate : ''}</span>
        </div>

        <table class="cargo-table">
          <colgroup>
            <col style="width:18%">
            <col style="width:30%">
            <col style="width:22%">
            <col style="width:30%">
          </colgroup>
          <thead>
            <tr>
              <th class="th">B/L No. &amp; Date</th>
              <th class="th">Marks and Nos.</th>
              <th class="th">Packages<br><span class="th-sub">No. &amp; Description</span></th>
              <th class="th">Description of Goods</th>
            </tr>
          </thead>
          <tbody>
            ${dataRows.join('')}
            ${padRows.join('')}
            <tr class="total-row">
              <td class="tdata total-label" colspan="2">Total No. of packages in words</td>
              <td class="tdata total-words">${totalWords}</td>
              <td class="tdata">&nbsp;</td>
            </tr>
          </tbody>
        </table>

        <div class="footer-block">
          <p class="cleared-label">Cleared out of Customs Charge</p>
          <div class="footer-row">
            <span class="flabel">Date and time</span><span class="fdots">............................................................................</span>
          </div>
          <div class="footer-row sig-row-footer">
            <span class="flabel">Signature</span><span class="fdots">............................................................................</span>
            <span class="comptroller">for Comptroller of Customs.</span>
          </div>
        </div>
      </div>`;

    // ── BACK PAGE ─────────────────────────────────────────────────────────
    const back = `
      <div class="page back-page">
        <div class="back-address">
          <div class="ba-line">THE PORT MANAGER</div>
          <div class="ba-line">PORT AUTHORITY</div>
          <div class="ba-line">CASTRIES</div>
        </div>

        <div class="back-body">
          <p class="deliver-to">Please deliver to</p>
          <p class="deliver-sub">the packages mentioned overleaf,</p>

          <div class="back-field">
            <span class="back-label">ex MV</span>
            <span class="back-val">${vesselName}</span>
            <span class="back-line"></span>
          </div>
          <div class="back-field">
            <span class="back-label">Rot. No.</span>
            <span class="back-val"></span>
            <span class="back-line"></span>
          </div>
        </div>

        <div class="back-right">
          <div class="shed-row">
            <span class="back-label">Shed No</span>
            <span class="shed-box">${shedNum}</span>
            <span class="back-label">of</span>
            <span class="shed-box"></span>
          </div>

          <div class="sig-block">
            <div class="sig-area"></div>
            <div class="sig-name">${note.released_by || ''}</div>
            <div class="sig-title">AUTHORIZED AGENT/MASTER</div>
          </div>
        </div>

        <div class="back-footer">
          <div class="back-field cntr-field">
            <span class="back-label">Cntr. No(s):</span>
            <span class="back-val cntr-val">${note.container_id}</span>
          </div>
          <div class="back-field">
            <span class="back-label">Date(s)&nbsp;&nbsp;Destuffed:</span>
            <span class="back-val">${destuffDate !== '—' ? destuffDate : ''}</span>
          </div>
        </div>
      </div>`;

    return [front, back];
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Out of Charge Notes</title>
<style>
  @page {
    size: letter;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10pt;
    color: #000;
    background: #fff;
  }

  /* ── Page shell — fills one letter page exactly ─────────────────────── */
  .page {
    width: 8.5in;
    height: 11in;
    padding: 0.45in 0.5in 0.35in 0.5in;
    page-break-after: always;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── FRONT – top header: IMPORTER left, title right ─────────────────── */
  .top-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 6pt;
  }
  .top-left { flex: 1; padding-top: 4pt; }
  .page-title {
    font-size: 15pt;
    font-weight: bold;
    white-space: nowrap;
    padding-top: 0;
    text-align: right;
    min-width: 160pt;
  }

  /* ── Header fields (IMPORTER, SHIP, Date of Arrival) ────────────────── */
  .hfield {
    display: flex;
    align-items: baseline;
    gap: 2pt;
    font-size: 10pt;
    margin-bottom: 6pt;
  }
  .ship-row {
    display: flex;
    align-items: baseline;
    gap: 2pt;
    font-size: 10pt;
    margin-bottom: 8pt;
    flex-wrap: nowrap;
  }
  .hlabel { font-weight: normal; white-space: nowrap; }
  .hdots  { white-space: nowrap; letter-spacing: 1pt; flex-shrink: 0; }
  .hval {
    font-weight: normal;
    border-bottom: 1pt solid #000;
    flex: 1;
    min-width: 60pt;
    padding-bottom: 1pt;
  }
  .ship-val   { flex: 2; min-width: 80pt; }
  .arrival-val { flex: 1; min-width: 70pt; }
  .arrival-label { white-space: nowrap; margin-left: 12pt; }

  /* ── Cargo table — fills the middle of the page ──────────────────────── */
  .cargo-table {
    width: 100%;
    border-collapse: collapse;
    flex: 1;
    font-size: 10pt;
    table-layout: fixed;
  }
  .cargo-table th,
  .cargo-table td {
    border: 1pt solid #000;
    padding: 3pt 5pt;
    vertical-align: top;
  }
  .th {
    font-weight: bold;
    text-align: center;
    font-size: 9.5pt;
    vertical-align: middle;
    padding: 5pt;
    white-space: normal;
    background: #fff;
  }
  .th-sub { font-weight: normal; font-size: 9pt; }
  .tdata {
    font-size: 10pt;
    height: 30pt;
    vertical-align: top;
    overflow: hidden;
  }
  .total-row td {
    border-top: 1.5pt solid #000;
    font-size: 9.5pt;
    height: 28pt;
  }
  .total-label {
    font-size: 9pt;
    font-style: italic;
    vertical-align: middle;
    text-align: center;
  }
  .total-words {
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    vertical-align: middle;
  }

  /* ── Footer ──────────────────────────────────────────────────────────── */
  .footer-block { padding-top: 10pt; flex-shrink: 0; }
  .cleared-label { font-size: 10pt; margin-bottom: 14pt; }
  .footer-row {
    display: flex;
    align-items: baseline;
    gap: 4pt;
    font-size: 10pt;
    margin-bottom: 14pt;
  }
  .flabel { white-space: nowrap; }
  .fdots { flex: 1; letter-spacing: 1pt; }
  .sig-row-footer { justify-content: space-between; }
  .comptroller { font-size: 9.5pt; font-style: italic; white-space: nowrap; margin-left: 12pt; }

  /* ── BACK page layout ────────────────────────────────────────────────── */
  .back-page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr auto;
    gap: 24pt;
  }
  .back-address {
    grid-column: 1; grid-row: 1;
    font-size: 9.5pt; font-weight: bold; line-height: 1.7;
  }
  .back-body { grid-column: 1; grid-row: 2; padding-top: 20pt; }
  .deliver-to  { font-size: 10pt; margin-bottom: 4pt; }
  .deliver-sub { font-size: 10pt; margin-bottom: 28pt; }
  .back-field {
    display: flex; align-items: baseline; gap: 4pt;
    margin-bottom: 28pt; font-size: 10pt;
  }
  .back-label { white-space: nowrap; }
  .back-val   { flex: 1; border-bottom: 1pt solid #000; min-width: 60pt; padding-bottom: 1pt; }

  .back-right {
    grid-column: 2; grid-row: 1 / 3;
    display: flex; flex-direction: column;
    align-items: flex-end; gap: 28pt;
    padding-top: 8pt;
  }
  .shed-row {
    display: flex; align-items: baseline; gap: 8pt;
    font-size: 10pt; justify-content: flex-end;
  }
  .shed-box {
    border-bottom: 1pt solid #000;
    min-width: 32pt; display: inline-block;
    text-align: center; padding-bottom: 1pt;
  }
  .sig-block { text-align: center; width: 160pt; }
  .sig-area  { border-bottom: 1pt solid #000; height: 56pt; width: 100%; margin-bottom: 6pt; }
  .sig-name  { font-size: 9.5pt; margin-bottom: 3pt; }
  .sig-title { font-size: 9pt; font-weight: bold; letter-spacing: 0.3pt; }

  .back-footer {
    grid-column: 1 / 3; grid-row: 3;
    border-top: 1pt solid #000; padding-top: 12pt;
    display: flex; flex-direction: column; gap: 12pt;
  }
  .cntr-val { font-size: 11pt; font-weight: bold; letter-spacing: 1pt; }

  /* ── Print ───────────────────────────────────────────────────────────── */
  @media print {
    .page { page-break-after: always; }
    body  { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @media screen {
    body { background: #ccc; }
    .page {
      margin: 12pt auto;
      box-shadow: 0 2px 12px rgba(0,0,0,0.18);
      background: #fff;
    }
  }
</style>
</head>
<body>${pages.join('')}</body>
</html>`;
}

// ── Section Re-auth Gate (Shipping Agent only) ────────────────────────────

function useDocumentationLock(userId: string | undefined, isShippingAgent: boolean) {
  const key = `ooc_unlocked_${userId ?? 'anon'}`;
  const [unlocked, setUnlocked] = useState(() =>
    isShippingAgent ? sessionStorage.getItem(key) === '1' : true,
  );
  function unlock() {
    sessionStorage.setItem(key, '1');
    setUnlocked(true);
  }
  return { unlocked: isShippingAgent ? unlocked : true, unlock };
}

function DocumentationGate({ onUnlock }: { onUnlock: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) { setError('Username is required'); return; }
    if (!password) { setError('Password is required'); return; }
    setError('');
    setLoading(true);
    // Verify credentials via Edge Function — avoids replacing the active
    // browser auth session (which would trigger an auth state change and
    // cause the Documentation page to error/reload mid-session).
    const { data, error: fnError } = await supabase.functions.invoke('verify-password', {
      method: 'POST',
      body: { username: username.trim(), password },
    });
    setLoading(false);
    if (fnError || !data?.ok) {
      setError('Invalid credentials. Please try again.');
      setPassword('');
      return;
    }
    onUnlock();
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-balance text-center">Documentation Access</h2>
          <p className="text-sm text-muted-foreground text-center text-pretty">
            Enter the authorized credentials to access Out of Charge Notes
          </p>
        </div>

        <form onSubmit={verify} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gate-user">Username</Label>
            <Input
              id="gate-user"
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              placeholder="Enter username"
              className="bg-background border-border h-10"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gate-pw">Password</Label>
            <div className="relative">
              <Input
                id="gate-pw"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter password"
                className="bg-background border-border h-10 pr-10"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Verifying…' : 'Unlock'}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ── Page body (always-unconditional hooks) ─────────────────────────────────

function DocumentationPageBody({ user, isAdmin }: { user: ReturnType<typeof useAuth>['user']; isAdmin: boolean }) {
  // List state
  const [notes, setNotes] = useState<OocNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);

  // Expanded rows (to show marks in list)
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);

  // Generate dialog state
  const [genOpen, setGenOpen] = useState(false);
  const [containers, setContainers] = useState<Container[]>([]);
  const [containerSearch, setContainerSearch] = useState('');
  const [showContainerList, setShowContainerList] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<Container | null>(null);
  const [previewMarks, setPreviewMarks] = useState<string[]>([]);
  const [markBolMap, setMarkBolMap] = useState<Record<string, string>>({});
  const [loadingMarks, setLoadingMarks] = useState(false);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [companyInfo, setCompanyInfo] = useState(loadCompanyInfo);
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OocNote | null>(null);

  // Clear All
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  // Print individual note
  const [printTarget, setPrintTarget] = useState<OocNote | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // ── Fetch notes ────────────────────────────────────────────────────────

  async function fetchNotes(targetPage: number) {
    setLoading(true);
    const from = (targetPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count, error } = await supabase
      .from('ooc_notes')
      .select(
        'id,container_id,marks,issue_date,company_name,company_address,company_phone,bill_of_lading_no,received_by,released_by,created_by,created_at,containers!ooc_notes_container_id_fkey(vessel_name,arrival_date,destuff_date,destuff_shed,clerk_name,agent_name)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .order('marks', { ascending: true })
      .range(from, to);
    if (error) {
      toast.error('Failed to load OOC Notes');
    } else {
      setNotes(Array.isArray(data) ? (data as unknown as OocNote[]) : []);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  }

  useEffect(() => { fetchNotes(page); }, [page]);

  // Poll every 30 s (Realtime WebSocket incompatible with sb_publishable_ key format)
  useEffect(() => {
    const poll = setInterval(() => fetchNotes(page), 30_000);
    return () => clearInterval(poll);
  }, [page]);

  // ── Container search ────────────────────────────────────────────────────

  async function searchContainers(q: string) {
    let query = supabase
      .from('containers')
      .select('container_id,vessel_name,arrival_date,destuff_date,destuff_shed,clerk_name,agent_name')
      .order('arrival_date', { ascending: false })
      .limit(40);
    if (q.trim()) {
      query = query.or(`container_id.ilike.%${q.trim()}%,vessel_name.ilike.%${q.trim()}%`);
    }
    const { data } = await query;
    setContainers(Array.isArray(data) ? (data as unknown as Container[]) : []);
    setShowContainerList(true);
  }

  function onContainerSearchChange(val: string) {
    setContainerSearch(val);
    setSelectedContainer(null);
    setPreviewMarks([]);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchContainers(val), 280);
  }

  async function selectContainer(c: Container) {
    setSelectedContainer(c);
    setContainerSearch(`${c.container_id} — ${c.vessel_name}`);
    setShowContainerList(false);
    setLoadingMarks(true);
    const { data } = await supabase
      .from('cargo')
      .select('marks, bl_no')
      .eq('container_id', c.container_id);
    const rows = (data ?? []) as { marks: string; bl_no: string | null }[];

    // Distinct marks, sorted
    const marks = [...new Set(
      rows.map((r) => (r.marks?.trim() || '(No Mark)'))
    )].sort();
    setPreviewMarks(marks);

    // Auto-populate B/L# with the first non-blank bl_no found for each mark group
    const bolMap: Record<string, string> = {};
    for (const mark of marks) {
      const matchKey = mark === '(No Mark)' ? '' : mark;
      const firstBl = rows.find(
        (r) => (r.marks?.trim() || '') === matchKey && r.bl_no?.trim()
      );
      bolMap[mark] = firstBl?.bl_no?.trim() ?? '';
    }
    setMarkBolMap(bolMap);
    setLoadingMarks(false);
  }

  // ── Open generate dialog ────────────────────────────────────────────────

  function openGenerate() {
    setSelectedContainer(null);
    setContainerSearch('');
    setPreviewMarks([]);
    setMarkBolMap({});
    setIssueDate(new Date().toISOString().slice(0, 10));
    setCompanyInfo(loadCompanyInfo());
    searchContainers('');
    setGenOpen(true);
  }

  // ── Save notes (one per mark) ───────────────────────────────────────────

  async function handleGenerate() {
    if (!selectedContainer) { toast.error('Please select a container'); return; }
    if (!issueDate) { toast.error('Issue date is required'); return; }
    if (previewMarks.length === 0) { toast.error('No cargo marks found for this container'); return; }

    saveCompanyInfo(companyInfo);
    setSaving(true);

    const rows = previewMarks.map((mark) => ({
      container_id: selectedContainer.container_id,
      marks: mark,
      issue_date: issueDate,
      company_name: companyInfo.name.trim() || null,
      company_address: companyInfo.address.trim() || null,
      company_phone: companyInfo.phone.trim() || null,
      bill_of_lading_no: (markBolMap[mark] ?? '').trim() || null,
      received_by: selectedContainer.clerk_name ?? null,
      released_by: selectedContainer.agent_name ?? null,
      created_by: user?.id ?? null,
    }));

    const { error } = await supabase.from('ooc_notes').insert(rows);
    setSaving(false);

    if (error) { toast.error(error.message); return; }

    toast.success(`${rows.length} OOC Note${rows.length > 1 ? 's' : ''} generated`);
    setGenOpen(false);
    fetchNotes(1);
    setPage(1);
  }

  // ── Print individual note ───────────────────────────────────────────────

  async function handlePrint(note: OocNote) {
    const { data, error } = await supabase
      .from('cargo')
      .select('cargo_id,pallet_no,quantity,commodity,marks,storage_location,damage,system_number,remarks')
      .eq('container_id', note.container_id)
      .eq('marks', note.marks === '(No Mark)' ? '' : note.marks);

    if (error) { toast.error('Failed to fetch cargo'); return; }

    const items = Array.isArray(data) ? (data as Cargo[]) : [];
    const cargoMap = new Map([[note.id, items]]);
    printHtml(buildPrintHtml([note], cargoMap));
  }

  // ── Print all notes for a container ────────────────────────────────────

  async function handlePrintAll(containerId: string) {
    const containerNotes = notes.filter((n) => n.container_id === containerId);
    if (containerNotes.length === 0) return;

    const cargoMap = new Map<string, Cargo[]>();
    await Promise.all(
      containerNotes.map(async (note) => {
        const { data } = await supabase
          .from('cargo')
          .select('cargo_id,pallet_no,quantity,commodity,marks,storage_location,damage,system_number,remarks')
          .eq('container_id', note.container_id)
          .eq('marks', note.marks === '(No Mark)' ? '' : note.marks);
        cargoMap.set(note.id, Array.isArray(data) ? (data as Cargo[]) : []);
      }),
    );

    const html = buildPrintHtml(containerNotes, cargoMap);
    printHtml(html);
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from('ooc_notes').delete().eq('id', deleteTarget.id);
    setDeleteOpen(false);
    setDeleteTarget(null);
    if (error) { toast.error(error.message); return; }
    toast.success('OOC Note deleted');
    const newTotal = totalCount - 1;
    const maxPage = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
    const tp = page > maxPage ? maxPage : page;
    setPage(tp);
    if (tp === page) fetchNotes(page);
  }

  async function handleClearAll() {
    setClearingAll(true);
    // Delete all rows — no filter needed; RLS ensures only authorised users reach here
    const { error } = await supabase.from('ooc_notes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setClearingAll(false);
    setClearAllOpen(false);
    if (error) { toast.error('Failed to clear OOC Notes: ' + error.message); return; }
    toast.success('All OOC Notes cleared');
    setPage(1);
    fetchNotes(1);
  }

  // ── Group notes by container for display ────────────────────────────────

  const grouped = notes.reduce<Map<string, OocNote[]>>((acc, n) => {
    const existing = acc.get(n.container_id) ?? [];
    acc.set(n.container_id, [...existing, n]);
    return acc;
  }, new Map());

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-xl">Out of Charge Notes</h1>
          <p className="text-sm text-muted-foreground">
            Generate one note per consignee/mark from a container's tallied cargo
          </p>
        </div>
        <Button onClick={openGenerate} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          Generate Notes
        </Button>
        {isAdmin && (
          <Button
            variant="outline"
            className="shrink-0 gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setClearAllOpen(true)}
            disabled={totalCount === 0}
          >
            <Eraser className="h-4 w-4" />
            Clear All
          </Button>
        )}
      </div>

      {/* Notes grouped by container */}
      <div className="w-full max-w-full overflow-x-auto bg-card rounded-lg border border-border">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap w-8"></th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Container ID</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Vessel</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Issue Date</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Notes</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Generated</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="py-3 px-4">
                        <div className="h-4 bg-muted rounded animate-pulse" style={{ width: `${50 + (j * 17) % 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              : Array.from(grouped.entries()).map(([containerId, containerNotes]) => {
                  const first = containerNotes[0];
                  const isExpanded = expandedContainer === containerId;
                  return [
                    // ── Summary row
                    <tr
                      key={`row-${containerId}`}
                      className="border-b border-border hover:bg-accent/30 cursor-pointer"
                      onClick={() => setExpandedContainer(isExpanded ? null : containerId)}
                    >
                      <td className="py-3 px-4 text-muted-foreground">
                        {isExpanded
                          ? <ChevronUp className="h-4 w-4" />
                          : <ChevronDown className="h-4 w-4" />}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-medium">{containerId}</td>
                      <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
                        {first.containers?.vessel_name || '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
                        {fmtDate(first.issue_date)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {containerNotes.length} {containerNotes.length === 1 ? 'note' : 'notes'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-muted-foreground text-xs">
                        {fmtShort(first.created_at)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="sm"
                            className="h-8 gap-1 text-xs"
                            onClick={(e) => { e.stopPropagation(); handlePrintAll(containerId); }}
                            title="Print all notes for this container"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            Print All
                          </Button>
                        </div>
                      </td>
                    </tr>,
                    // ── Expanded: one row per mark
                    ...(isExpanded ? containerNotes.map((note) => (
                      <tr key={`mark-${note.id}`} className="border-b border-border/50 bg-muted/20">
                        <td className="py-2 px-4" />
                        <td className="py-2 px-4" colSpan={2}>
                          <span className="text-xs text-muted-foreground mr-2">Consignee / Mark:</span>
                          <span className="text-sm font-medium">{note.marks}</span>
                        </td>
                        <td className="py-2 px-4" />
                        <td className="py-2 px-4" />
                        <td className="py-2 px-4" />
                        <td className="py-2 px-4 whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => handlePrint(note)}
                              title="Print this note"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              <span className="sr-only">Print</span>
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => { setDeleteTarget(note); setDeleteOpen(true); }}
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="sr-only">Delete</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )) : []),
                  ];
                })}
            {!loading && notes.length === 0 && (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <FileText className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-muted-foreground">No OOC Notes generated yet.</p>
                    <Button onClick={openGenerate} size="sm" className="gap-1">
                      <Plus className="h-4 w-4" />
                      Generate First Notes
                    </Button>
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

      {/* ── Generate Dialog ──────────────────────────────────────────────── */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Out of Charge Notes</DialogTitle>
            <DialogDescription>
              Select a container — one note will be created for each Marks / Consignee
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Container search */}
            <div className="space-y-2">
              <Label>Container *</Label>
              <div className="relative" ref={searchRef}>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={containerSearch}
                  onChange={(e) => onContainerSearchChange(e.target.value)}
                  onFocus={() => { if (!selectedContainer) searchContainers(containerSearch); }}
                  placeholder="Search by container ID or vessel name..."
                  className="pl-9 bg-background border-border h-10"
                />
                {showContainerList && containers.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 border border-border rounded-md shadow-lg bg-popover overflow-hidden max-h-48 overflow-y-auto">
                    {containers.map((c) => (
                      <button
                        key={c.container_id}
                        type="button"
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent flex items-center justify-between gap-4"
                        onClick={() => selectContainer(c)}
                      >
                        <span className="font-medium">{c.container_id}</span>
                        <span className="text-muted-foreground text-xs">{c.vessel_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedContainer && previewMarks.length > 0 && (
                <div className="rounded-md border border-border overflow-hidden">
                  <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 border-b border-border">
                    <Info className="h-4 w-4 text-primary shrink-0" />
                    <p className="text-sm font-medium">
                      {previewMarks.length} note{previewMarks.length !== 1 ? 's' : ''} will be generated — enter B/L No. per mark:
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {previewMarks.map((mark) => (
                      <div key={mark} className="flex items-center gap-3 px-3 py-2.5">
                        <span className="text-sm font-medium min-w-0 flex-1 truncate" title={mark}>{mark}</span>
                        <Input
                          value={markBolMap[mark] ?? ''}
                          onChange={(e) => setMarkBolMap((prev) => ({ ...prev, [mark]: e.target.value }))}
                          placeholder="B/L No. (optional)"
                          className="bg-background border-border h-8 text-sm w-48 shrink-0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {loadingMarks && (
                <p className="text-xs text-muted-foreground animate-pulse">Loading marks…</p>
              )}
            </div>

            {/* Issue Date */}
            <div className="space-y-2">
              <Label htmlFor="ooc-date">Issue Date *</Label>
              <Input
                id="ooc-date" type="date" value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="bg-background border-border h-10"
              />
            </div>

            {/* Company info */}
            <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Shipping Company Info (printed on notes)
              </p>
              <div className="space-y-2">
                <Label htmlFor="co-name">Company Name</Label>
                <Input
                  id="co-name" value={companyInfo.name}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, name: e.target.value })}
                  placeholder="e.g. ABC Shipping Ltd."
                  className="bg-background border-border h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="co-addr">Address</Label>
                <Input
                  id="co-addr" value={companyInfo.address}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, address: e.target.value })}
                  placeholder="e.g. 1 Port Road, Kingston"
                  className="bg-background border-border h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="co-phone">Phone</Label>
                <Input
                  id="co-phone" value={companyInfo.phone}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, phone: e.target.value })}
                  placeholder="e.g. +1 876 555 0100"
                  className="bg-background border-border h-10"
                />
              </div>
            </div>

            {/* Received/Released By (auto-filled, editable) */}
            {selectedContainer && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Received By</Label>
                  <Input
                    value={selectedContainer.clerk_name ?? ''}
                    readOnly
                    className="bg-muted border-border h-10 text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Released By</Label>
                  <Input
                    value={selectedContainer.agent_name ?? ''}
                    readOnly
                    className="bg-muted border-border h-10 text-muted-foreground"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={saving || !selectedContainer} className="gap-2">
              {saving ? 'Generating…' : (
                <><FileText className="h-4 w-4" />Generate {previewMarks.length > 0 ? `${previewMarks.length} Note${previewMarks.length !== 1 ? 's' : ''}` : 'Notes'}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ────────────────────────────────────────────────── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete OOC Note</AlertDialogTitle>
            <AlertDialogDescription>
              Delete the note for consignee <strong>{deleteTarget?.marks}</strong> on container{' '}
              <strong>{deleteTarget?.container_id}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Clear All OOC Notes Confirm ───────────────────────────────────── */}
      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All OOC Notes</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>all {totalCount} OOC Note{totalCount !== 1 ? 's' : ''}</strong> from
              the system. This action cannot be undone. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              disabled={clearingAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearingAll ? 'Clearing…' : 'Yes, Clear All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────

export default function DocumentationPage() {
  const { user, isAdmin, isShippingAgent } = useAuth();
  const { unlocked, unlock } = useDocumentationLock(user?.id, isShippingAgent);

  // Show gate for Shipping Agents who haven't verified this session.
  // DocumentationPageBody is only mounted once unlocked, so all its hooks
  // always run unconditionally — no Rules of Hooks violation.
  if (!unlocked) {
    return <DocumentationGate onUnlock={unlock} />;
  }

  return <DocumentationPageBody user={user} isAdmin={isAdmin} />;
}
