import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Ship, Package, Printer, FileText, PenLine, Type, Paintbrush, Boxes, AlertTriangle, CheckCircle2, Play, Hash, Save, Clock, Timer, PlusCircle, X, Camera, FileUp, Download, ExternalLink, Users, RefreshCw, Eraser, SquareCheck, Square, BookOpen, FileSpreadsheet, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SignatureCanvas from '@/components/ui/signature-canvas';
import { exportToExcel, exportToCSV, printTable } from '@/lib/export';
import { ExportMenu } from '@/components/common/ExportMenu';
import { DamagePhotoUploader } from '@/components/common/DamagePhotoUploader';
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
import { validateCommodity, validateQuantity, sanitizeInput } from '@/lib/security';
import { extractConsigneesFromFile, resolveMarks, type ConsigneeEntry } from '@/lib/import';
import type { Container, Cargo, ManifestLibraryEntry } from '@/types/types';

interface CargoGroup {
  marks: string;
  bl_no: string | null;   // BL# is now part of the group key
  items: Cargo[];
}

export default function CargoSubPage() {
  const { containerId } = useParams<{ containerId: string }>();
  const navigate = useNavigate();
  const [container, setContainer] = useState<Container | null>(null);
  const [cargo, setCargo] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [editingCargo, setEditingCargo] = useState<Cargo | null>(null);
  const [clerkName, setClerkName] = useState('');
  const [clerkSignature, setClerkSignature] = useState('');
  const [clerkDrawn, setClerkDrawn] = useState('');
  const [clerkMode, setClerkMode] = useState<'type' | 'draw'>('type');
  const [agentName, setAgentName] = useState('');
  const [agentSignature, setAgentSignature] = useState('');
  const [agentDrawn, setAgentDrawn] = useState('');
  const [agentMode, setAgentMode] = useState<'type' | 'draw'>('type');
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  // Unsaved-data warning when user tries to close the Add/Edit Cargo dialog
  const [closeWarningOpen, setCloseWarningOpen] = useState(false);
  const { user, isDataEntryClerk, isClerk, isShippingAgent, canManageContainers } = useAuth();
  // Keep ref in sync so realtime callbacks always see the latest role value
  useEffect(() => { isDataEntryClerkRef.current = isDataEntryClerk; }, [isDataEntryClerk]);
  // Reset location alert when switching containers
  useEffect(() => { locationAlertedRef.current = false; }, [containerId]);

  // ── System-number slot state (Data Entry Clerk) ───────────────────────
  // Each marks group gets an array of slots.
  // A slot owns a subset of cargo_ids and one draft system number.
  interface SysNoSlot { cargoIds: number[]; draft: string; saving: boolean; }
  const [sysNoGroups, setSysNoGroups] = useState<Record<string, SysNoSlot[]>>({});

  // Realtime debounce — prevents own writes from triggering a re-fetch
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether a mutation is in-flight so realtime skips during that window
  const mutatingRef = useRef(false);
  // Track which cargo_ids already existed so new live arrivals get detected
  const prevCargoIdsRef = useRef<Set<number>>(new Set());
  // When true, Save keeps the dialog open and resets the form for the next entry
  const addAnotherRef = useRef(false);
  // Sticky pallet — persists the last-used pallet number across dialog opens
  const [activePallet, setActivePallet] = useState('');
  // Ref to avoid stale closure in realtime callback
  const isDataEntryClerkRef = useRef(false);
  // Fire the "locations started" toast only once per container session
  const locationAlertedRef = useRef(false);
  const commodityOptions = ['barrel', 'p/drum', 'carton', 'pallet', 's/w pallet', 'case', 'crate', 'package', 'piece(s)', 'bag', 'other'];
  const damageOptions = ['none', 'wet', 'torn', 'broken', 'dented', 'b/o'];

  const [form, setForm] = useState({
    pallet_no: '',
    bl_no: '',
    marks: '',
    commodity: '',
    quantity: '',
    damage: 'none',
    remarks: '',
    storage_location: '',
  });
  const [damagePhotos, setDamagePhotos] = useState<string[]>([]);

  // ── Manifest upload state ─────────────────────────────────────────────
  const [manifestOpen, setManifestOpen] = useState(false);
  const [manifestUploading, setManifestUploading] = useState(false);
  const [manifestDragOver, setManifestDragOver] = useState(false);
  const [manifestFileName, setManifestFileName] = useState('');
  const [consignees, setConsignees] = useState<ConsigneeEntry[]>([]);
  const [consigneeParsing, setConsigneeParsing] = useState(false);
  const [consigneeImporting, setConsigneeImporting] = useState(false);
  const manifestFileInputRef = useRef<HTMLInputElement>(null);

  // ── Manifest library tab state ────────────────────────────────────────
  const [manifestTab, setManifestTab] = useState<'upload' | 'library'>('upload');
  const [libraryEntries, setLibraryEntries] = useState<ManifestLibraryEntry[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [librarySelected, setLibrarySelected] = useState<ManifestLibraryEntry | null>(null);
  const [libraryExtracting, setLibraryExtracting] = useState(false);

  // ── Manifest file upload to storage ──────────────────────────────────
  const handleManifestUpload = useCallback(async (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const allowed = ['pdf', 'xlsx', 'xls', 'csv', 'txt', 'doc', 'docx'];
    if (!allowed.includes(ext)) {
      toast.error('Supported formats: PDF, Excel (.xlsx/.xls), CSV, TXT, or Word (.docx/.doc)');
      return;
    }
    // Route to the correct DB column: PDF → manifest_url, everything else → manifest_txt_url
    const isPdf = ext === 'pdf';
    const dbColumn = isPdf ? 'manifest_url' : 'manifest_txt_url';

    setManifestUploading(true);
    setManifestFileName(f.name);
    setConsignees([]);
    try {
      const path = `${containerId}/${Date.now()}_${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('manifests').upload(path, f, { upsert: true });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('manifests').getPublicUrl(path);
      const { error: dbErr } = await supabase
        .from('containers')
        .update({ [dbColumn]: urlData.publicUrl })
        .eq('container_id', containerId!);
      if (dbErr) throw dbErr;

      // Update local container state so the link appears immediately
      setContainer((prev) => prev ? { ...prev, [dbColumn]: urlData.publicUrl } : prev);
      toast.success(`${isPdf ? 'PDF' : ext === 'docx' || ext === 'doc' ? 'Word document' : 'TXT/spreadsheet'} manifest uploaded successfully`);

      // Attempt to extract consignee names for all supported file types
      setConsigneeParsing(true);
      try {
        const extracted = await extractConsigneesFromFile(f);
        if (extracted.length > 0) {
          setConsignees(extracted);
        } else {
          const label = isPdf ? 'PDF' : 'file';
          toast.warning(`No consignee entries could be extracted from this ${label}. You can still add cargo rows manually.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Consignee extraction error:', msg);
        toast.error(`Extraction failed: ${msg}`);
      } finally {
        setConsigneeParsing(false);
      }
    } catch (e: unknown) {
      toast.error('Upload failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setManifestUploading(false);
    }
  }, [containerId]);

  // ── Add one cargo row per consignee (marks = consignee, bl_no = HBL#; commodity + quantity left blank for manual entry) ──
  async function handleConsigneeImport() {
    if (!consignees.length || !containerId) return;
    setConsigneeImporting(true);
    const rows = consignees.map((e) => ({
      container_id: containerId,
      // MARKS priority: Marks & Numbers field → Consignee name (commodity + quantity left blank)
      marks: resolveMarks(e).toUpperCase(),
      bl_no: e.blNo || null,
      commodity: '',
      quantity: null,
      damage: 'none',
      pallet_no: null,
      storage_location: null,
    }));
    const { error } = await supabase.from('cargo').insert(rows);
    setConsigneeImporting(false);
    if (error) { toast.error('Import failed: ' + error.message); return; }
    toast.success(`Added ${rows.length} cargo row${rows.length !== 1 ? 's' : ''} from manifest`);
    setConsignees([]);
    setManifestOpen(false);
    setManifestFileName('');
    fetchData();
  }

  // ── Load manifest library entries ─────────────────────────────────────
  const fetchLibraryEntries = useCallback(async () => {
    setLibraryLoading(true);
    const { data, error } = await supabase
      .from('manifest_library')
      .select('*')
      .order('created_at', { ascending: false });
    setLibraryLoading(false);
    if (error) { toast.error('Failed to load library: ' + error.message); return; }
    setLibraryEntries((data as ManifestLibraryEntry[]) ?? []);
  }, []);

  // ── Use a library manifest: download + extract consignees ─────────────
  const handleUseLibraryManifest = useCallback(async (entry: ManifestLibraryEntry) => {
    setLibraryExtracting(true);
    setLibrarySelected(entry);
    try {
      const res = await fetch(entry.public_url);
      if (!res.ok) throw new Error(`Could not fetch manifest (HTTP ${res.status})`);
      const blob = await res.blob();
      const mimeMap: Record<string, string> = {
        pdf:  'application/pdf',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xls:  'application/vnd.ms-excel',
        csv:  'text/csv',
        txt:  'text/plain',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc:  'application/msword',
      };
      const mime = mimeMap[entry.file_type] ?? 'application/octet-stream';
      const file = new File([blob], entry.file_name, { type: mime });
      const extracted = await extractConsigneesFromFile(file);
      if (extracted.length > 0) {
        setConsignees(extracted);
        setManifestFileName(entry.file_name);
        // Switch to upload tab to show the extracted preview
        setManifestTab('upload');
      } else {
        toast.warning('No consignee entries could be extracted from this manifest.');
        setLibrarySelected(null);
      }
    } catch (err: any) {
      toast.error('Extraction failed: ' + (err.message ?? String(err)));
      setLibrarySelected(null);
    } finally {
      setLibraryExtracting(false);
    }
  }, []);

  // ── Re-extract from an already-uploaded manifest ──────────────────────
  // Tries the TXT/spreadsheet manifest first (richer structured data), then
  // falls back to the PDF. Used when the dialog is reopened after a prior
  // upload session or if extraction previously failed silently.
  const handleReExtract = useCallback(async () => {
    const url = container?.manifest_txt_url || container?.manifest_url;
    if (!url) return;
    setConsigneeParsing(true);
    const mimeMap: Record<string, string> = {
      pdf:  'application/pdf',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls:  'application/vnd.ms-excel',
      csv:  'text/csv',
      txt:  'text/plain',
    };
    const tryExtract = async (srcUrl: string): Promise<boolean> => {
      const res = await fetch(srcUrl);
      if (!res.ok) throw new Error(`Could not fetch manifest (HTTP ${res.status})`);
      const blob     = await res.blob();
      const rawName  = srcUrl.split('/').pop()?.split('?')[0] ?? 'manifest';
      const fileName = decodeURIComponent(rawName);
      const ext      = fileName.split('.').pop()?.toLowerCase() ?? '';
      const type     = mimeMap[ext] || blob.type || 'application/octet-stream';
      const file     = new File([blob], fileName, { type });
      const extracted = await extractConsigneesFromFile(file);
      if (extracted.length > 0) {
        setConsignees(extracted);
        setManifestFileName(fileName);
        return true;
      }
      return false;
    };
    try {
      // Prefer TXT/spreadsheet; fall back to PDF if TXT yields nothing
      const txtUrl = container?.manifest_txt_url;
      const pdfUrl = container?.manifest_url;
      let ok = false;
      if (txtUrl) ok = await tryExtract(txtUrl);
      if (!ok && pdfUrl) ok = await tryExtract(pdfUrl);
      if (!ok) toast.warning('No consignee entries could be extracted from the attached manifests.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Re-extract error:', msg);
      toast.error(`Re-extraction failed: ${msg}`);
    } finally {
      setConsigneeParsing(false);
    }
  }, [container?.manifest_url, container?.manifest_txt_url]);

  async function fetchData() {
    setLoading(true);
    const { data: cData } = await supabase
      .from('containers')
      .select('container_id,vessel_name,arrival_date,destuff_date,destuff_shed,start_time,end_time,status,expected_cargo_count,clerk_name,clerk_signature,agent_name,agent_signature,manifest_url,manifest_txt_url,created_at')
      .eq('container_id', containerId)
      .maybeSingle();

    // Clerks and Shipping Agents see only their own cargo entries for this container;
    // all other roles (Admin, Manager, Data Entry Clerk) see everything.
    let cargoQ = supabase
      .from('cargo')
      .select('cargo_id,container_id,pallet_no,quantity,commodity,marks,bl_no,storage_location,damage,remarks,system_number,damage_photos,is_selected,created_at')
      .eq('container_id', containerId)
      .order('cargo_id', { ascending: true });
    // Clerk and Shipping Agent each see:
    //   • rows they personally entered (created_by = their user id)
    //   • manifest-imported rows (created_by IS NULL) — shared reference, not linked to the other role
    // Admin / Manager / Data Entry Clerk see every row.
    if ((isClerk || isShippingAgent) && user?.id) {
      cargoQ = cargoQ.or(`created_by.eq.${user.id},created_by.is.null`);
    }
    const { data: gData } = await cargoQ;
    const cont = cData as Container | null;
    setContainer(cont);
    const cargoList = Array.isArray(gData) ? (gData as Cargo[]) : [];
    setCargo(cargoList);
    // ── Seed sysNoGroups from DB data ─────────────────────────────────────
    // For each marks group: create one slot per unique system_number already in DB.
    // Unsaved in-flight drafts are preserved across re-fetches.
    setSysNoGroups((prev) => {
      const next: Record<string, SysNoSlot[]> = {};
      // Group cargoList by marks+bl_no key (each unique marks+BL# combo is a separate group)
      const byMark: Record<string, Cargo[]> = {};
      cargoList.forEach((c) => {
        const key = `${(c.marks || '').trim().toLowerCase() || '(no marks)'}|||${(c.bl_no || '').trim().toLowerCase()}`;
        if (!byMark[key]) byMark[key] = [];
        byMark[key].push(c);
      });

      Object.entries(byMark).forEach(([markKey, items]) => {
        const sorted = [...items].sort((a, b) => a.cargo_id - b.cargo_id);

        // If there are existing slots (from previous state), preserve their structure
        // but refresh cargoIds so newly added items appear in the last slot.
        const existing = prev[markKey];
        if (existing && existing.length > 0) {
          // Collect all cargoIds that already appear in existing slots
          const slottedIds = new Set(existing.flatMap((s) => s.cargoIds));
          const newIds = sorted.filter((c) => !slottedIds.has(c.cargo_id)).map((c) => c.cargo_id);
          // Append new ids to the last slot
          const refreshed = existing.map((slot, idx) =>
            idx === existing.length - 1
              ? { ...slot, cargoIds: [...slot.cargoIds, ...newIds] }
              : slot
          );
          next[markKey] = refreshed;
          return;
        }

        // First load: build slots from unique system_number values
        const bySysNo: Record<string, number[]> = {};
        sorted.forEach((c) => {
          const sn = c.system_number ?? '__null__';
          if (!bySysNo[sn]) bySysNo[sn] = [];
          bySysNo[sn].push(c.cargo_id);
        });

        const slots: SysNoSlot[] = [];
        // Non-null numbers first (alphabetically), unassigned last
        const keys = Object.keys(bySysNo).sort((a, b) => {
          if (a === '__null__') return 1;
          if (b === '__null__') return -1;
          return a.localeCompare(b);
        });
        keys.forEach((sn) => {
          slots.push({ cargoIds: bySysNo[sn], draft: sn === '__null__' ? '' : sn, saving: false });
        });
        next[markKey] = slots.length > 0 ? slots : [{ cargoIds: sorted.map((c) => c.cargo_id), draft: '', saving: false }];
      });
      return next;
    });
    prevCargoIdsRef.current = new Set(cargoList.map((c) => c.cargo_id));
    setClerkName((cont?.clerk_name || '').toUpperCase());
    setAgentName((cont?.agent_name || '').toUpperCase());
    const clerkSig = cont?.clerk_signature || '';
    const agentSig = cont?.agent_signature || '';
    setClerkSignature(clerkSig.startsWith('data:') ? '' : clerkSig);
    setClerkDrawn(clerkSig.startsWith('data:') ? clerkSig : '');
    setClerkMode(clerkSig.startsWith('data:') ? 'draw' : 'type');
    setAgentSignature(agentSig.startsWith('data:') ? '' : agentSig);
    setAgentDrawn(agentSig.startsWith('data:') ? agentSig : '');
    setAgentMode(agentSig.startsWith('data:') ? 'draw' : 'type');
    setLoading(false);
  }

  useEffect(() => {
    // Defer initial fetch until after the page shell has painted —
    // the skeleton UI is shown immediately while the data loads in the background
    const handle = (window.requestIdleCallback ?? setTimeout)(() => fetchData(), { timeout: 400 });

    // ── Poll every 30 s instead of Realtime (sb_publishable_ key not supported by WebSocket) ──
    const poll = setInterval(() => {
      if (!mutatingRef.current) fetchData();
    }, 30_000);

    return () => {
      if (typeof handle === 'number') clearTimeout(handle);
      else (window.cancelIdleCallback ?? clearTimeout)(handle);
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
      clearInterval(poll);
    };
  }, [containerId]);

  const groupedCargo = useMemo<CargoGroup[]>(() => {
    // Sort by marks (asc) → bl_no (asc) → cargo_id (asc)
    // so entries with the same consignee (marks) but different BL# appear as separate rows
    const sorted = [...cargo].sort((a, b) => {
      const ma = (a.marks || '').toLowerCase();
      const mb = (b.marks || '').toLowerCase();
      if (ma !== mb) return ma < mb ? -1 : 1;
      const ba = (a.bl_no || '').toLowerCase();
      const bb = (b.bl_no || '').toLowerCase();
      if (ba !== bb) return ba < bb ? -1 : 1;
      return a.cargo_id - b.cargo_id;
    });
    const groups: CargoGroup[] = [];
    let current: CargoGroup | null = null;
    sorted.forEach((c) => {
      const markKey = (c.marks || '').trim().toLowerCase() || '(no marks)';
      const blKey   = (c.bl_no  || '').trim().toLowerCase();
      if (!current || current.marks.toLowerCase() !== markKey || (current.bl_no || '').toLowerCase() !== blKey) {
        current = { marks: c.marks || '(no marks)', bl_no: c.bl_no ?? null, items: [c] };
        groups.push(current);
      } else {
        current.items.push(c);
      }
    });
    return groups;
  }, [cargo]);

  function openAdd() {
    setEditingCargo(null);
    setForm({ pallet_no: activePallet, bl_no: '', marks: '', commodity: '', quantity: '', damage: 'none', remarks: '', storage_location: '' });
    setDamagePhotos([]);
    setDialogOpen(true);
  }

  function openEdit(c: Cargo) {
    setEditingCargo(c);
    setForm({
      pallet_no: (c.pallet_no || '').toUpperCase(),
      bl_no: (c.bl_no || '').toUpperCase(),
      marks: (c.marks || '').toUpperCase(),
      commodity: c.commodity,
      quantity: c.quantity != null ? String(c.quantity) : '',
      damage: c.damage || 'none',
      remarks: (c.remarks || '').toUpperCase(),
      storage_location: (c.storage_location || '').toUpperCase(),
    });
    setDamagePhotos(Array.isArray(c.damage_photos) ? c.damage_photos : []);
    setDialogOpen(true);
  }

  function handlePalletChange(value: string) {
    const upper = value.toUpperCase();
    const trimmed = upper.trim();
    const match = cargo.find(
      (c) =>
        c.pallet_no &&
        c.pallet_no.trim().toLowerCase() === trimmed.toLowerCase() &&
        (!editingCargo || c.cargo_id !== editingCargo.cargo_id)
    );
    setForm((prev) => ({
      ...prev,
      pallet_no: upper,
      storage_location: match ? match.storage_location || '' : prev.storage_location,
    }));
  }

  async function handleSave() {
    if (!containerId) return;
    const qty = form.quantity.trim() === '' ? null : parseInt(form.quantity, 10);

    const commCheck = validateCommodity(form.commodity);
    if (!commCheck.valid) {
      toast.error(commCheck.message);
      return;
    }

    const qtyCheck = validateQuantity(qty);
    if (!qtyCheck.valid) {
      toast.error(qtyCheck.message);
      return;
    }

    const storageValue = sanitizeInput(form.storage_location) || null;
    const palletNoValue = sanitizeInput(form.pallet_no) || null;
    const blNoValue = sanitizeInput(form.bl_no) || null;
    const marksValue = sanitizeInput(form.marks) || null;
    const remarksValue = sanitizeInput(form.remarks) || null;
    const commodityValue = sanitizeInput(form.commodity);
    const damageValue = (form.damage || 'none').trim() || 'none';

    if (editingCargo) {
      // ── Optimistic update: patch local state immediately ──────────────
      const updated: Cargo = {
        ...editingCargo,
        pallet_no: palletNoValue,
        bl_no: blNoValue,
        marks: marksValue,
        commodity: commodityValue,
        quantity: qty,
        damage: damageValue,
        remarks: remarksValue,
        storage_location: storageValue,
        damage_photos: damagePhotos,
      };
      setCargo((prev) => prev.map((c) => (c.cargo_id === editingCargo.cargo_id ? updated : c)));
      setDialogOpen(false);

      // Sync to DB in background — if it fails, revert and show error
      mutatingRef.current = true;
      const { error } = await supabase
        .from('cargo')
        .update({
          pallet_no: palletNoValue,
          bl_no: blNoValue,
          marks: marksValue,
          commodity: commodityValue,
          quantity: qty,
          damage: damageValue,
          remarks: remarksValue,
          storage_location: storageValue,
          damage_photos: damagePhotos,
        })
        .eq('cargo_id', editingCargo.cargo_id);
      mutatingRef.current = false;
      if (error) {
        // Revert optimistic update on failure
        setCargo((prev) => prev.map((c) => (c.cargo_id === editingCargo.cargo_id ? editingCargo : c)));
        toast.error(error.message);
        return;
      }
      if (form.pallet_no.trim()) {
        await supabase
          .from('cargo')
          .update({ storage_location: storageValue })
          .eq('container_id', containerId)
          .ilike('pallet_no', form.pallet_no.trim())
          .neq('cargo_id', editingCargo.cargo_id);
      }
      toast.success('Record updated successfully');
    } else {
      // ── Optimistic insert: add a temp row instantly ───────────────────
      const tempId = -(Date.now()); // negative temp id, replaced after DB round-trip
      const tempRow: Cargo = {
        cargo_id: tempId,
        container_id: containerId,
        pallet_no: palletNoValue,
        bl_no: blNoValue,
        marks: marksValue,
        commodity: commodityValue,
        quantity: qty,
        damage: damageValue,
        remarks: remarksValue,
        storage_location: storageValue,
        system_number: null,
        damage_photos: damagePhotos,
        is_selected: false,
        created_at: new Date().toISOString(),
      };
      setCargo((prev) => [...prev, tempRow]);
      // Add temp cargo_id to its mark group slot (or create a new slot)
      setSysNoGroups((prev) => {
        const key = (marksValue || '').trim().toLowerCase() || '(no marks)';
        const slots = prev[key] ? [...prev[key]] : [];
        if (slots.length === 0) {
          slots.push({ cargoIds: [tempId], draft: '', saving: false });
        } else {
          // Append to last slot
          const last = { ...slots[slots.length - 1], cargoIds: [...slots[slots.length - 1].cargoIds, tempId] };
          slots[slots.length - 1] = last;
        }
        return { ...prev, [key]: slots };
      });
      if (addAnotherRef.current || isShippingAgent || isClerk) {
        // Keep dialog open, reset form for next entry
        // Shipping Agents don't use pallet — always clear it; Clerks keep it sticky
        setForm({ pallet_no: isShippingAgent ? '' : (palletNoValue || ''), bl_no: '', marks: '', commodity: '', quantity: '', damage: 'none', remarks: '', storage_location: '' });
        setDamagePhotos([]);
      } else {
        setDialogOpen(false);
        setForm({ pallet_no: '', bl_no: '', marks: '', commodity: '', quantity: '', damage: 'none', remarks: '', storage_location: '' });
        setDamagePhotos([]);
      }
      // Persist pallet for next Add Cargo open
      setActivePallet(palletNoValue || '');
      toast.success('Record saved successfully');

      mutatingRef.current = true;
      const { data: inserted, error } = await supabase
        .from('cargo')
        .insert({
          container_id: containerId,
          pallet_no: palletNoValue,
          bl_no: blNoValue,
          marks: marksValue,
          commodity: commodityValue,
          quantity: qty,
          damage: damageValue,
          remarks: remarksValue,
          storage_location: storageValue,
          damage_photos: damagePhotos,
          created_by: user?.id ?? null,
        })
        .select('cargo_id,container_id,pallet_no,quantity,commodity,marks,bl_no,storage_location,damage,remarks,system_number,damage_photos,created_at')
        .maybeSingle();
      mutatingRef.current = false;
      if (error) {
        // Remove temp row on failure
        setCargo((prev) => prev.filter((c) => c.cargo_id !== tempId));
        setSysNoGroups((prev) => {
          // Remove tempId from whichever slot it's in
          const key = (marksValue || '').trim().toLowerCase() || '(no marks)';
          const slots = (prev[key] ?? []).map((s) => ({ ...s, cargoIds: s.cargoIds.filter((id) => id !== tempId) })).filter((s) => s.cargoIds.length > 0);
          return { ...prev, [key]: slots };
        });
        toast.error(error.message);
        return;
      }
      // Replace temp row with the real DB row (gets real cargo_id)
      if (inserted) {
        const real = inserted as Cargo;
        setCargo((prev) => prev.map((c) => (c.cargo_id === tempId ? real : c)));
        // Swap tempId → real cargo_id in its slot
        setSysNoGroups((prev) => {
          const key = (marksValue || '').trim().toLowerCase() || '(no marks)';
          const slots = (prev[key] ?? []).map((s) => ({
            ...s,
            cargoIds: s.cargoIds.map((id) => (id === tempId ? real.cargo_id : id)),
          }));
          return { ...prev, [key]: slots };
        });
        prevCargoIdsRef.current.add(real.cargo_id);
      }
    }
  }

  function openDelete(cargoId: number) {
    setDeleteId(cargoId);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deleteId) return;
    // Optimistic: remove row immediately, re-add on failure
    const snapshot = cargo.find((c) => c.cargo_id === deleteId) ?? null;
    setCargo((prev) => prev.filter((c) => c.cargo_id !== deleteId));
    setDeleteOpen(false);
    setDeleteId(null);

    mutatingRef.current = true;
    const { error } = await supabase.from('cargo').delete().eq('cargo_id', deleteId);
    mutatingRef.current = false;
    if (error) {
      // Revert optimistic delete
      if (snapshot) setCargo((prev) => [...prev, snapshot].sort((a, b) => a.cargo_id - b.cargo_id));
      toast.error(error.message);
      return;
    }
    toast.success('Cargo record deleted');
  }

  async function handleClearAll() {
    if (!containerId) return;
    setClearingAll(true);
    mutatingRef.current = true;
    const { error } = await supabase.from('cargo').delete().eq('container_id', containerId);
    mutatingRef.current = false;
    setClearingAll(false);
    setClearAllOpen(false);
    if (error) {
      toast.error('Failed to clear cargo: ' + error.message);
      return;
    }
    setCargo([]);
    toast.success('All cargo records cleared');
  }

  async function handleStartContainer() {
    if (!containerId) return;
    setStarting(true);
    const d = new Date();
    const startTime = d.toTimeString().slice(0, 8); // "HH:MM:SS"
    // Optimistic: update container status in local state immediately
    setContainer((prev) => prev ? { ...prev, start_time: startTime, status: 'In Process' } : prev);
    setStartOpen(false);

    const { error } = await supabase
      .from('containers')
      .update({ start_time: startTime, status: 'In Process' })
      .eq('container_id', containerId);
    setStarting(false);
    if (error) {
      // Revert on failure
      setContainer((prev) => prev ? { ...prev, start_time: null, status: 'Scheduled' } : prev);
      toast.error(error.message);
      return;
    }
    toast.success('Container destuffing started');
  }

  async function handleEndContainer() {
    if (!containerId) return;
    setEnding(true);
    const d = new Date();
    const endTime = d.toTimeString().slice(0, 8); // "HH:MM:SS"
    // Optimistic: update container status in local state immediately
    setContainer((prev) => prev ? { ...prev, end_time: endTime, status: 'Completed' } : prev);
    setEndOpen(false);

    const { error } = await supabase
      .from('containers')
      .update({ end_time: endTime, status: 'Completed' })
      .eq('container_id', containerId);
    setEnding(false);
    if (error) {
      setContainer((prev) => prev ? { ...prev, end_time: null, status: 'In Process' } : prev);
      toast.error(error.message);
      return;
    }
    toast.success('Container completed');
  }

  // ── Double-click: toggle is_selected for a cargo row ─────────────────
  async function handleToggleSelected(c: Cargo) {
    if (!canManageContainers && !isClerk) return; // read-only roles cannot select
    const next = !c.is_selected;
    // Optimistic update
    setCargo((prev) => prev.map((r) => r.cargo_id === c.cargo_id ? { ...r, is_selected: next } : r));
    const { error } = await supabase
      .from('cargo')
      .update({ is_selected: next })
      .eq('cargo_id', c.cargo_id);
    if (error) {
      // Revert on failure
      setCargo((prev) => prev.map((r) => r.cargo_id === c.cargo_id ? { ...r, is_selected: c.is_selected } : r));
      toast.error('Could not update selection: ' + error.message);
    }
  }

  // ── Check whether the current form has unsaved data ───────────────────
  const emptyForm = { pallet_no: '', bl_no: '', marks: '', commodity: '', quantity: '', damage: 'none', remarks: '', storage_location: '' };
  function isFormDirty() {
    if (editingCargo) {
      return (
        form.pallet_no !== (editingCargo.pallet_no || '').toUpperCase() ||
        form.bl_no !== (editingCargo.bl_no || '').toUpperCase() ||
        form.marks !== (editingCargo.marks || '').toUpperCase() ||
        form.commodity !== editingCargo.commodity ||
        form.quantity !== (editingCargo.quantity != null ? String(editingCargo.quantity) : '') ||
        form.damage !== (editingCargo.damage || 'none') ||
        form.remarks !== (editingCargo.remarks || '').toUpperCase() ||
        form.storage_location !== (editingCargo.storage_location || '').toUpperCase()
      );
    }
    return Object.keys(emptyForm).some((k) => form[k as keyof typeof emptyForm] !== emptyForm[k as keyof typeof emptyForm]);
  }

  // Called when user clicks Cancel / X — shows warning if dirty
  function requestCloseDialog() {
    if (isFormDirty()) {
      setCloseWarningOpen(true);
    } else {
      setDialogOpen(false);
    }
  }

  async function handleSaveSignatures() {
    if (!containerId) return;
    setSignatureSaving(true);
    const clerkSigVal = clerkMode === 'draw' ? (clerkDrawn.trim() || null) : (clerkSignature.trim() || null);
    const agentSigVal = agentMode === 'draw' ? (agentDrawn.trim() || null) : (agentSignature.trim() || null);

    // Determine which user_id fields to set based on the current user's role
    const userIdUpdate: Record<string, string | null> = {};
    if (isClerk && user?.id) userIdUpdate.clerk_user_id = user.id;
    if (isShippingAgent && user?.id) userIdUpdate.agent_user_id = user.id;

    // Optimistic: reflect names/sigs in local container state immediately
    setContainer((prev) => prev ? {
      ...prev,
      clerk_name: clerkName.trim() || null,
      clerk_signature: clerkSigVal,
      agent_name: agentName.trim() || null,
      agent_signature: agentSigVal,
    } : prev);

    const { error } = await supabase
      .from('containers')
      .update({
        clerk_name: clerkName.trim() || null,
        clerk_signature: clerkSigVal,
        agent_name: agentName.trim() || null,
        agent_signature: agentSigVal,
        ...userIdUpdate,
      })
      .eq('container_id', containerId);
    setSignatureSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Signatures saved');
  }

  // ── System number save — saves one slot's draft to all its cargo items ──
  async function handleSaveSlot(markKey: string, slotIdx: number) {
    const slot = sysNoGroups[markKey]?.[slotIdx];
    if (!slot || slot.cargoIds.length === 0) return;
    const value = slot.draft.trim() || null;

    // Optimistic: mark saving + apply to cargo state
    setSysNoGroups((prev) => {
      const slots = [...(prev[markKey] ?? [])];
      slots[slotIdx] = { ...slots[slotIdx], saving: true };
      return { ...prev, [markKey]: slots };
    });
    setCargo((prev) =>
      prev.map((c) => slot.cargoIds.includes(c.cargo_id) ? { ...c, system_number: value } : c)
    );

    const results = await Promise.all(
      slot.cargoIds.map((id) => supabase.from('cargo').update({ system_number: value }).eq('cargo_id', id))
    );
    setSysNoGroups((prev) => {
      const slots = [...(prev[markKey] ?? [])];
      slots[slotIdx] = { ...slots[slotIdx], saving: false };
      return { ...prev, [markKey]: slots };
    });

    const firstError = results.find((r) => r.error);
    if (firstError?.error) {
      setCargo((prev) =>
        prev.map((c) => slot.cargoIds.includes(c.cargo_id) ? { ...c, system_number: null } : c)
      );
      toast.error(firstError.error.message);
      return;
    }
    toast.success(slot.cargoIds.length > 1
      ? `System number saved for ${slot.cargoIds.length} items`
      : `System number saved for cargo #${slot.cargoIds[0]}`
    );
  }

  // ── Add system number slot — splits last splittable slot ──────────────
  // Takes the last item from the last slot that has ≥2 cargo items and
  // places it into a new empty slot so the clerk can assign a different number.
  function handleAddSystemNumber(markKey: string) {
    setSysNoGroups((prev) => {
      const slots = [...(prev[markKey] ?? [])];
      // Find last slot with ≥2 items
      let targetIdx = -1;
      for (let i = slots.length - 1; i >= 0; i--) {
        if (slots[i].cargoIds.length >= 2) { targetIdx = i; break; }
      }
      if (targetIdx === -1) return prev; // nothing to split
      const target = slots[targetIdx];
      // Move the last cargoId from the target slot into a new slot
      const movedIds = target.cargoIds.slice(Math.floor(target.cargoIds.length / 2));
      const remainIds = target.cargoIds.slice(0, Math.floor(target.cargoIds.length / 2));
      const updated = [
        ...slots.slice(0, targetIdx),
        { ...target, cargoIds: remainIds },
        { cargoIds: movedIds, draft: '', saving: false },
        ...slots.slice(targetIdx + 1),
      ];
      return { ...prev, [markKey]: updated };
    });
  }

  // ── Remove system number slot — merges it back into first slot ─────────
  function handleRemoveSlot(markKey: string, slotIdx: number) {
    setSysNoGroups((prev) => {
      const slots = [...(prev[markKey] ?? [])];
      if (slots.length <= 1) return prev;
      const removed = slots[slotIdx];
      // Merge removed cargoIds into slot 0 (or previous slot)
      const mergeInto = slotIdx === 0 ? 1 : 0;
      const merged = {
        ...slots[mergeInto],
        cargoIds: [...slots[mergeInto].cargoIds, ...removed.cargoIds],
      };
      const result = slots
        .map((s, i) => i === mergeInto ? merged : s)
        .filter((_, i) => i !== slotIdx);
      return { ...prev, [markKey]: result };
    });
  }

  // ── Save All system numbers at once ──────────────────────────────────
  // Iterates every slot in every marks+BL# group and persists any slot that
  // has a non-empty draft value. Slots with an empty draft are skipped.
  async function handleSaveAllSysNos() {
    const allWork: Array<{ markKey: string; slotIdx: number }> = [];
    Object.entries(sysNoGroups).forEach(([markKey, slots]) => {
      slots.forEach((slot, slotIdx) => {
        if (slot.draft.trim()) allWork.push({ markKey, slotIdx });
      });
    });
    if (allWork.length === 0) { toast.error('No system numbers to save'); return; }

    // Mark all slots as saving
    setSysNoGroups((prev) => {
      const next = { ...prev };
      allWork.forEach(({ markKey, slotIdx }) => {
        const slots = [...(next[markKey] ?? [])];
        slots[slotIdx] = { ...slots[slotIdx], saving: true };
        next[markKey] = slots;
      });
      return next;
    });

    // Run all saves in parallel
    const results = await Promise.all(
      allWork.map(async ({ markKey, slotIdx }) => {
        const slot = sysNoGroups[markKey]?.[slotIdx];
        if (!slot) return { markKey, slotIdx, ok: true };
        const value = slot.draft.trim() || null;
        const updates = await Promise.all(
          slot.cargoIds.map((id) => supabase.from('cargo').update({ system_number: value }).eq('cargo_id', id))
        );
        const err = updates.find((r) => r.error);
        if (!err) {
          setCargo((prev) =>
            prev.map((c) => slot.cargoIds.includes(c.cargo_id) ? { ...c, system_number: value } : c)
          );
        }
        return { markKey, slotIdx, ok: !err, error: err?.error };
      })
    );

    // Clear saving flag on all
    setSysNoGroups((prev) => {
      const next = { ...prev };
      allWork.forEach(({ markKey, slotIdx }) => {
        const slots = [...(next[markKey] ?? [])];
        if (slots[slotIdx]) slots[slotIdx] = { ...slots[slotIdx], saving: false };
        next[markKey] = slots;
      });
      return next;
    });

    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      toast.error(`${failed} slot${failed !== 1 ? 's' : ''} failed to save`);
    } else {
      toast.success(`All ${allWork.length} system number${allWork.length !== 1 ? 's' : ''} saved`);
    }
  }
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/containers')} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 space-y-1">
            <div className="h-5 w-48 bg-muted rounded animate-pulse" />
            <div className="h-4 w-72 bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="h-3 w-20 bg-muted rounded animate-pulse" />
              <div className="h-7 w-12 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <div className="h-5 w-32 bg-muted rounded animate-pulse" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 px-4 py-3">
                <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                <div className="h-4 w-32 bg-muted rounded animate-pulse flex-1" />
                <div className="h-4 w-12 bg-muted rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!container) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Container not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/containers')}>Back to Containers</Button>
      </div>
    );
  }

  // ── Export handlers ────────────────────────────────────────────────────
  function buildExportRow(r: Cargo) {
    return {
      'BL#': r.bl_no || '',
      'Container': r.container_id,
      'Pallet No': r.pallet_no || '',
      'Marks': r.marks || '',
      'Commodity': r.commodity,
      'Qty': r.quantity ?? '',
      'Location': r.storage_location || '',
      'Damage': r.damage || '',
      'Remarks': r.remarks || '',
      'System No': r.system_number || '',
    };
  }

  async function handleExcelExport() {
    if (!cargo.length) { toast.error('No cargo to export'); return; }
    await exportToExcel(cargo.map(buildExportRow), `Cargo_${containerId}`);
    toast.success('Exported to Excel');
  }

  function handleCsvExport() {
    if (!cargo.length) { toast.error('No cargo to export'); return; }
    exportToCSV(cargo.map(buildExportRow), `Cargo_${containerId}`);
    toast.success('Exported to CSV');
  }

  function handlePrint() {
    if (!cargo.length) { toast.error('No cargo to print'); return; }

    // Build print rows grouped by marks, collapsing identical system numbers
    const sorted = [...cargo].sort((a, b) => {
      const ma = (a.marks || '').toLowerCase();
      const mb = (b.marks || '').toLowerCase();
      if (ma < mb) return -1; if (ma > mb) return 1;
      return a.cargo_id - b.cargo_id;
    });
    // Group by marks
    const markGroups: { marks: string; items: Cargo[] }[] = [];
    let cur: { marks: string; items: Cargo[] } | null = null;
    sorted.forEach((c) => {
      const mk = (c.marks || '').toLowerCase() || '(no marks)';
      if (!cur || cur.marks.toLowerCase() !== mk) {
        cur = { marks: c.marks || '(no marks)', items: [c] };
        markGroups.push(cur);
      } else { cur.items.push(c); }
    });
    // Flatten to print rows, collapsing system_number within each marks group
    const printRows: (string | number | null)[][] = [];
    markGroups.forEach((group) => {
      const collapsed: { value: string | null; count: number }[] = [];
      group.items.forEach((c) => {
        const last = collapsed[collapsed.length - 1];
        if (last && last.value === c.system_number) { last.count++; }
        else { collapsed.push({ value: c.system_number, count: 1 }); }
      });
      group.items.forEach((c, idx) => {
        // System No cell: only show on first occurrence of each unique value in this group
        const collapseIdx = collapsed.findIndex((e) => e.value === c.system_number);
        const isFirstOccurrence = group.items.slice(0, idx).every((prev) => prev.system_number !== c.system_number);
        const sysNoCell = isFirstOccurrence
          ? (c.system_number ? `${c.system_number}${collapsed[collapseIdx]?.count > 1 ? ` (${collapsed[collapseIdx].count})` : ''}` : '')
          : '';
        printRows.push([c.bl_no, c.pallet_no, c.marks, c.commodity, c.quantity, c.storage_location, c.damage, c.remarks, sysNoCell]);
      });
    });

    printTable(
      `Cargo — ${containerId}`,
      `${container?.vessel_name ?? ''} | Status: ${container?.status ?? ''}${container?.start_time ? ' | Start: ' + container.start_time : ''}${container?.end_time ? ' | End: ' + container.end_time : ''}`,
      ['BL#', 'Pallet No', 'Marks', 'Commodity', 'Qty', 'Location', 'Damage', 'Remarks', 'System No'],
      printRows,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/containers')} className="shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold md:text-xl truncate">
            {isDataEntryClerk ? 'System Number Entry' : 'Cargo Details'}
          </h1>
          <p className="text-sm text-muted-foreground truncate">
            Container: <span className="font-medium text-foreground">{container.container_id}</span>
            {' | '}
            <Ship className="inline h-3 w-3 text-muted-foreground" /> {container.vessel_name}
            {' | '}
            Status: <span className="status-badge" data-status={container.status}>{container.status}</span>
            {container.destuff_date && (
              <>
                {' | '}
                <span className="text-muted-foreground">Destuff: {container.destuff_date}</span>
              </>
            )}
            {container.manifest_url && (
              <>
                {' | '}
                <a
                  href={container.manifest_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  <FileText className="inline h-3 w-3" /> PDF Manifest
                  <ExternalLink className="inline h-2.5 w-2.5 ml-0.5" />
                </a>
              </>
            )}
            {container.manifest_txt_url && (
              <>
                {' | '}
                <a
                  href={container.manifest_txt_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  <FileText className="inline h-3 w-3" /> TXT Manifest
                  <ExternalLink className="inline h-2.5 w-2.5 ml-0.5" />
                </a>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Data Entry Clerk banner */}
      {isDataEntryClerk && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-primary/10 border border-primary/20">
          <Hash className="h-4 w-4 text-primary shrink-0" />
          <p className="text-sm text-primary font-medium">
            Live view — cargo entries appear in real time. Use <strong>Start Destuffing</strong> / <strong>End Container</strong> to record times, and enter a system number for each mark group.
          </p>
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Package className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Cargo Items</p>
            <p className="text-lg font-bold leading-tight">{cargo.length}</p>
          </div>
        </div>
        <div className="bg-card border border-border p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Boxes className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Qty</p>
            <p className="text-lg font-bold leading-tight">{cargo.reduce((s, c) => s + (c.quantity ?? 0), 0).toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-card border border-border p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-[#f39c12]/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-[#f39c12]" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Damaged</p>
            <p className="text-lg font-bold leading-tight">{cargo.filter((c) => c.damage && c.damage !== 'none').length}</p>
          </div>
        </div>
        <div className="bg-card border border-border p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Ship className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Status</p>
            <p className="text-sm font-bold leading-tight truncate">{container.status}</p>
          </div>
        </div>
      </div>

      {/* Destuffing Times Strip — always visible so Clerk can see start/end */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
          container.start_time
            ? 'bg-[#3498db]/10 border-[#3498db]/30'
            : 'bg-muted/50 border-border'
        }`}>
          <Clock className={`h-5 w-5 shrink-0 ${container.start_time ? 'text-[#3498db]' : 'text-muted-foreground'}`} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Start Time</p>
            {container.start_time ? (
              <p className="text-base font-bold text-[#3498db] leading-tight">{container.start_time}</p>
            ) : (
              <p className="text-sm text-muted-foreground leading-tight">Not started</p>
            )}
          </div>
        </div>
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
          container.end_time
            ? 'bg-[#2ecc71]/10 border-[#2ecc71]/30'
            : 'bg-muted/50 border-border'
        }`}>
          <Timer className={`h-5 w-5 shrink-0 ${container.end_time ? 'text-[#2ecc71]' : 'text-muted-foreground'}`} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">End Time</p>
            {container.end_time ? (
              <p className="text-base font-bold text-[#2ecc71] leading-tight">{container.end_time}</p>
            ) : (
              <p className="text-sm text-muted-foreground leading-tight">Not ended</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{cargo.length} cargo item(s)</span>
        </div>
        <div className="flex items-center gap-2">
          {container.status === 'Scheduled' && (
            <Button variant="outline" className="shrink-0 gap-2 text-[#3498db] border-[#3498db]/30 hover:bg-[#3498db]/10 hover:text-[#3498db]" onClick={() => setStartOpen(true)}>
              <Play className="h-4 w-4" />
              Start Destuffing
            </Button>
          )}
          {container.status === 'In Process' && (
            <Button variant="outline" className="shrink-0 gap-2 text-[#2ecc71] border-[#2ecc71]/30 hover:bg-[#2ecc71]/10 hover:text-[#2ecc71]" onClick={() => setEndOpen(true)}>
              <CheckCircle2 className="h-4 w-4" />
              End Container
            </Button>
          )}
          <Button variant="outline" className="shrink-0 gap-2" onClick={() => setSummaryOpen(true)}>
            <FileText className="h-4 w-4" />
            Summary
          </Button>
          <ExportMenu
            onExcelExport={handleExcelExport}
            onCsvExport={handleCsvExport}
            onPrint={handlePrint}
            disabled={loading}
          />
          {/* Save All System Numbers — Data Entry Clerk only */}
          {isDataEntryClerk && (
            <Button
              variant="default"
              className="gap-2 shrink-0"
              onClick={handleSaveAllSysNos}
              title="Save all entered system numbers at once"
            >
              <Save className="h-4 w-4" />
              Save All System Nos
            </Button>
          )}
          {!isDataEntryClerk && (
            <div className="flex items-center gap-2 shrink-0">
              {activePallet && (
                <div className="flex items-center gap-1 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                  <span>Pallet:</span>
                  <span className="font-semibold text-foreground">{activePallet}</span>
                  <button
                    type="button"
                    onClick={() => setActivePallet('')}
                    className="ml-1 rounded hover:text-foreground transition-colors"
                    title="Clear active pallet"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {canManageContainers && (
                <Button variant="outline" onClick={() => { setManifestFileName(''); setManifestTab('upload'); setManifestOpen(true); fetchLibraryEntries(); }} className="gap-2 shrink-0">
                  <FileUp className="h-4 w-4" />
                  Manifest
                </Button>
              )}
              {canManageContainers && cargo.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setClearAllOpen(true)}
                  className="gap-2 shrink-0 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  <Eraser className="h-4 w-4" />
                  Clear All
                </Button>
              )}
              <Button onClick={openAdd} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Cargo
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="w-full max-w-full overflow-x-auto bg-card">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="py-3 px-3 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap w-8 text-center" title="Double-click row to mark/unmark">✓</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">BL#</th>
              {!isShippingAgent && <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Pallet No</th>}
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Marks</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Commodity</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Qty</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Damage</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Remarks</th>
              {!isShippingAgent && <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Storage</th>}
              {isDataEntryClerk ? (
                <th className="text-left py-3 px-4 font-medium text-primary uppercase text-xs whitespace-nowrap">
                  <span className="flex items-center gap-1"><Hash className="h-3 w-3" />System No</span>
                </th>
              ) : (
                <>
                  {!isShippingAgent && <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">System No</th>}
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Actions</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {groupedCargo.map((group) => {
              const rowSpan = group.items.length;
              // A group is "selected" when ALL its items are selected
              const groupSelected = group.items.every((c) => c.is_selected);
              return (
                <tr
                  key={group.items[0].cargo_id}
                  className={`border-b border-border hover:bg-accent/30 transition-colors ${groupSelected ? 'bg-primary/8' : ''} ${!isDataEntryClerk && group.items.length === 1 ? 'cursor-pointer' : ''}`}
                  onClick={() => { if (!isDataEntryClerk && group.items.length === 1) openEdit(group.items[0]); }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    group.items.forEach((c) => handleToggleSelected(c));
                  }}
                  title={!isDataEntryClerk && group.items.length === 1 ? 'Click to edit · Double-click to mark' : 'Double-click to mark/unmark'}
                >
                  {/* Checkmark cell */}
                  <td className="py-3 px-3 whitespace-nowrap align-top text-center w-8" onClick={(e) => { e.stopPropagation(); group.items.forEach((c) => handleToggleSelected(c)); }}>
                    {groupSelected
                      ? <SquareCheck className="h-4 w-4 text-primary mx-auto" />
                      : <Square className="h-4 w-4 text-muted-foreground/40 mx-auto" />}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap align-top">
                    <div className="flex flex-col gap-1">
                      {group.items.map((c) => (
                        <span key={c.cargo_id} className="font-mono font-medium text-xs">{c.bl_no || '-'}</span>
                      ))}
                    </div>
                  </td>
                  {!isShippingAgent && (
                    <td className="py-3 px-4 whitespace-nowrap align-top">
                      <div className="flex flex-col gap-1">
                        {group.items.map((c) => (
                          <span key={c.cargo_id}>{c.pallet_no || '-'}</span>
                        ))}
                      </div>
                    </td>
                  )}
                  <td className="py-3 px-4 align-top">
                    <div className={rowSpan > 1 ? 'border-l-2 border-primary pl-2' : ''}>
                      <div className="whitespace-pre-wrap min-w-[180px] max-w-[280px] text-xs leading-snug">{group.marks}</div>
                      {rowSpan > 1 && <span className="mt-1 text-[10px] text-muted-foreground block">({rowSpan} items)</span>}
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap align-top">
                    <div className="flex flex-col gap-1">
                      {group.items.map((c) => (
                        <span key={c.cargo_id}>{c.commodity}</span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap align-top">
                    <div className="flex flex-col gap-1">
                      {group.items.map((c) => (
                        <span key={c.cargo_id}>{c.quantity ?? '—'}</span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap align-top">
                    <div className="flex flex-col gap-1">
                      {group.items.map((c) => (
                        <span key={c.cargo_id}>
                          {c.damage && c.damage !== 'none' ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#f39c12]/10 text-[#f39c12]">
                                <AlertTriangle className="h-3 w-3" />
                                {c.damage}
                              </span>
                              {Array.isArray(c.damage_photos) && c.damage_photos.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {c.damage_photos.map((url) => (
                                    <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                                      <img
                                        src={url}
                                        alt="Damage"
                                        className="w-10 h-10 object-cover rounded border border-[#f39c12]/40 hover:opacity-80 transition-opacity"
                                      />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">none</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap max-w-[200px] align-top">
                    <div className="flex flex-col gap-1">
                      {group.items.map((c) => (
                        <span key={c.cargo_id} className="truncate">{c.remarks || '-'}</span>
                      ))}
                    </div>
                  </td>
                  {!isShippingAgent && (
                    <td className="py-3 px-4 whitespace-nowrap align-top">
                      <div className="flex flex-col gap-1">
                        {group.items.map((c) => (
                          <span key={c.cargo_id}>{c.storage_location || '-'}</span>
                        ))}
                      </div>
                    </td>
                  )}
                  {/* System No column — editable for Data Entry Clerk, read-only for others */}
                  {isDataEntryClerk ? (
                    <td className="py-2 px-3 align-top">
                      {(() => {
                        const markKey = `${(group.marks || '(no marks)').toLowerCase()}|||${(group.bl_no || '').toLowerCase()}`;
                        const slots = sysNoGroups[markKey] ?? [];
                        const canSplit = slots.some((s) => s.cargoIds.length >= 2);
                        return (
                          <div className="flex flex-col gap-2 min-w-[180px]">
                            {slots.map((slot, slotIdx) => (
                              <div key={slotIdx} className="flex flex-col gap-0.5">
                                {/* Label when multiple slots */}
                                {slots.length > 1 && (
                                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                    Slot {slotIdx + 1} · {slot.cargoIds.length} item{slot.cargoIds.length !== 1 ? 's' : ''}{' '}
                                    <span className="font-mono">[{slot.cargoIds.join(', ')}]</span>
                                  </span>
                                )}
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={slot.draft}
                                    onChange={(e) => {
                                      const digits = e.target.value.replace(/\D/g, '');
                                      setSysNoGroups((prev) => {
                                        const s = [...(prev[markKey] ?? [])];
                                        s[slotIdx] = { ...s[slotIdx], draft: digits };
                                        return { ...prev, [markKey]: s };
                                      });
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSlot(markKey, slotIdx); }}
                                    inputMode="numeric"
                                    placeholder="0000"
                                    className="h-8 w-24 text-xs px-2 bg-background border-border"
                                    disabled={slot.saving}
                                  />
                                  <Button
                                    variant="ghost" size="icon"
                                    className="h-8 w-8 text-primary hover:text-primary shrink-0"
                                    onClick={() => handleSaveSlot(markKey, slotIdx)}
                                    disabled={slot.saving}
                                    title="Save system number"
                                  >
                                    {slot.saving
                                      ? <div className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                      : <Save className="h-3.5 w-3.5" />}
                                    <span className="sr-only">Save</span>
                                  </Button>
                                  {slots.length > 1 && (
                                    <Button
                                      variant="ghost" size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                      onClick={() => handleRemoveSlot(markKey, slotIdx)}
                                      title="Merge slot back"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                      <span className="sr-only">Remove slot</span>
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                            {/* Add system number button — only when there's a slot that can be split */}
                            {canSplit && (
                              <button
                                onClick={() => handleAddSystemNumber(markKey)}
                                className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium mt-0.5 w-fit"
                              >
                                <PlusCircle className="h-3 w-3" />
                                Add system number
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  ) : (
                    <>
                      {!isShippingAgent && (
                        <td className="py-3 px-4 whitespace-nowrap align-top">
                          {/* Collapse identical system numbers within the marks group */}
                          {(() => {
                            const sysNoCounts: { value: string | null; count: number }[] = [];
                            group.items.forEach((c) => {
                              const last = sysNoCounts[sysNoCounts.length - 1];
                              if (last && last.value === c.system_number) {
                                last.count++;
                              } else {
                                sysNoCounts.push({ value: c.system_number, count: 1 });
                              }
                            });
                            return (
                              <div className="flex flex-col gap-1">
                                {sysNoCounts.map((entry, i) => (
                                  <span key={i} className="text-muted-foreground whitespace-nowrap">
                                    {entry.value
                                      ? <>
                                          {entry.value}
                                          {entry.count > 1 && (
                                            <span className="ml-1 text-[10px] text-muted-foreground/60">
                                              ({entry.count} items)
                                            </span>
                                          )}
                                        </>
                                      : <span className="text-muted-foreground/40 text-xs">—</span>
                                    }
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                        </td>
                      )}
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <div className="flex flex-col gap-1 items-end">
                          {group.items.map((c) => (
                            <div key={c.cargo_id} className="flex items-center gap-2">
                              {/* For multi-item groups only — single-item groups use the whole <tr> */}
                              {group.items.length > 1 && (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                  title="Edit cargo"
                                  onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                                >
                                  <Pencil className="h-4 w-4" />
                                  <span className="sr-only">Edit</span>
                                </Button>
                              )}
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={(e) => { e.stopPropagation(); openDelete(c.cargo_id); }}
                                title="Delete cargo"
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Delete</span>
                              </Button>
                            </div>
                          ))}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {cargo.length === 0 && (
              <tr>
                <td colSpan={isDataEntryClerk ? 9 : isShippingAgent ? 7 : 10} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Package className="h-10 w-10 text-muted-foreground/40" />
                    {isDataEntryClerk ? (
                      <p className="text-muted-foreground">Waiting for cargo to be entered — this view updates live.</p>
                    ) : (
                      <>
                        <p className="text-muted-foreground">No cargo items for this container yet.</p>
                        <Button onClick={openAdd} size="sm" className="gap-1">
                          <Plus className="h-4 w-4" />
                          Add First Cargo
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Signatures Section — hidden from Data Entry Clerk */}
      {!isDataEntryClerk && (
      <div className="bg-card border border-border p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-2">
          <PenLine className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wide">Signatures</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Clerk */}
          <div className="space-y-4 border border-border/50 rounded-lg p-4 bg-muted/20">
            <p className="text-sm font-semibold">Clerk</p>
            <div className="space-y-2">
              <Label htmlFor="clerkName" className="text-xs uppercase tracking-wide text-muted-foreground">Name</Label>
              <Input
                id="clerkName"
                value={clerkName}
                onChange={(e) => setClerkName(e.target.value.toUpperCase())}
                placeholder="ENTER CLERK NAME"
                className="bg-background border-border h-10 uppercase"
              />
              {container.clerk_name && (
                <p className="text-xs text-muted-foreground">Saved: <span className="text-foreground font-medium">{container.clerk_name}</span></p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Signature</Label>
              <div className="flex items-center bg-muted rounded-md p-0.5 w-fit">
                <button
                  type="button"
                  onClick={() => setClerkMode('type')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${clerkMode === 'type' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Type className="h-3 w-3" />
                  Type
                </button>
                <button
                  type="button"
                  onClick={() => setClerkMode('draw')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${clerkMode === 'draw' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Paintbrush className="h-3 w-3" />
                  Draw
                </button>
              </div>
              {clerkMode === 'type' ? (
                <Input
                  value={clerkSignature}
                  onChange={(e) => setClerkSignature(e.target.value)}
                  placeholder="Enter typed signature"
                  className="bg-background border-border h-10"
                />
              ) : (
                <SignatureCanvas
                  label=""
                  value={clerkDrawn}
                  onChange={setClerkDrawn}
                  height={120}
                />
              )}
              {container.clerk_signature && !container.clerk_signature.startsWith('data:') && (
                <p className="text-xs text-muted-foreground">Saved: <span className="text-foreground font-medium">{container.clerk_signature}</span></p>
              )}
              {container.clerk_signature && container.clerk_signature.startsWith('data:') && (
                <div className="border border-border rounded-md bg-white p-1 inline-block">
                  <img src={container.clerk_signature} alt="Clerk signature" className="h-10" />
                </div>
              )}
            </div>
          </div>

          {/* Agent */}
          <div className="space-y-4 border border-border/50 rounded-lg p-4 bg-muted/20">
            <p className="text-sm font-semibold">Agent</p>
            <div className="space-y-2">
              <Label htmlFor="agentName" className="text-xs uppercase tracking-wide text-muted-foreground">Name</Label>
              <Input
                id="agentName"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value.toUpperCase())}
                placeholder="ENTER AGENT NAME"
                className="bg-background border-border h-10 uppercase"
              />
              {container.agent_name && (
                <p className="text-xs text-muted-foreground">Saved: <span className="text-foreground font-medium">{container.agent_name}</span></p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Signature</Label>
              <div className="flex items-center bg-muted rounded-md p-0.5 w-fit">
                <button
                  type="button"
                  onClick={() => setAgentMode('type')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${agentMode === 'type' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Type className="h-3 w-3" />
                  Type
                </button>
                <button
                  type="button"
                  onClick={() => setAgentMode('draw')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${agentMode === 'draw' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Paintbrush className="h-3 w-3" />
                  Draw
                </button>
              </div>
              {agentMode === 'type' ? (
                <Input
                  value={agentSignature}
                  onChange={(e) => setAgentSignature(e.target.value)}
                  placeholder="Enter typed signature"
                  className="bg-background border-border h-10"
                />
              ) : (
                <SignatureCanvas
                  label=""
                  value={agentDrawn}
                  onChange={setAgentDrawn}
                  height={120}
                />
              )}
              {container.agent_signature && !container.agent_signature.startsWith('data:') && (
                <p className="text-xs text-muted-foreground">Saved: <span className="text-foreground font-medium">{container.agent_signature}</span></p>
              )}
              {container.agent_signature && container.agent_signature.startsWith('data:') && (
                <div className="border border-border rounded-md bg-white p-1 inline-block">
                  <img src={container.agent_signature} alt="Agent signature" className="h-10" />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSaveSignatures} disabled={signatureSaving} className="h-10">
            {signatureSaving ? 'Saving...' : 'Save Signatures'}
          </Button>
        </div>
      </div>
      )} {/* end !isDataEntryClerk signature section */}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) requestCloseDialog(); }}>
        <DialogContent
          className="max-w-[calc(100%-2rem)] md:max-w-xl bg-card border-border overflow-y-auto max-h-[90dvh]"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{editingCargo ? 'Edit Cargo' : 'Add Cargo'}</DialogTitle>
            <DialogDescription>{editingCargo ? 'Update cargo details' : 'Add new cargo to this container'}</DialogDescription>
          </DialogHeader>

          {/* Fields in requested order: Pallet No → BL# → Marks → Quantity → Commodity → Damage → Remarks → Storage Location */}
          <div className="space-y-4 py-1">

            {/* Pallet No — hidden for Shipping Agents */}
            {!isShippingAgent && (
              <div className="space-y-1.5">
                <Label htmlFor="pallet" className="text-sm font-medium">Pallet No</Label>
                <Input
                  id="pallet"
                  autoFocus
                  value={form.pallet_no}
                  onChange={(e) => handlePalletChange(e.target.value)}
                  placeholder="e.g. P-001"
                  className="bg-background border-border h-10 uppercase"
                />
              </div>
            )}

            {/* BL# */}
            <div className="space-y-1.5">
              <Label htmlFor="bl_no" className="text-sm font-medium">BL#</Label>
              <Input
                id="bl_no"
                autoFocus={isShippingAgent}
                value={form.bl_no}
                onChange={(e) => setForm({ ...form, bl_no: e.target.value.toUpperCase() })}
                placeholder="e.g. HBL205422"
                className="bg-background border-border h-10 font-mono uppercase"
              />
            </div>

            {/* Marks — with inline "use existing" select when prior marks exist */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="marks" className="text-sm font-medium">Marks</Label>
                {(() => {
                  const existingMarks = Array.from(
                    new Set(cargo.map((c) => (c.marks || '').trim()).filter(Boolean))
                  ).sort();
                  return existingMarks.length > 0 ? (
                    <Select value="" onValueChange={(v) => setForm((f) => ({ ...f, marks: v }))}>
                      <SelectTrigger className="h-7 w-auto max-w-[180px] text-xs border-dashed bg-transparent text-muted-foreground px-2 gap-1">
                        <SelectValue placeholder="Use existing mark…" />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {existingMarks.map((m) => (
                          <SelectItem key={m} value={m} className="text-xs font-mono max-w-xs">
                            {m.length > 50 ? m.slice(0, 50) + '…' : m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null;
                })()}
              </div>
              <Textarea
                id="marks"
                value={form.marks}
                onChange={(e) => setForm({ ...form, marks: e.target.value.toUpperCase() })}
                rows={6}
                className="bg-background border-border min-h-[140px] resize-y text-sm uppercase font-mono leading-relaxed"
                placeholder="ADDRESS / SHIPPING NUMBER / OTHER INFO"
              />
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <Label htmlFor="qty" className="text-sm font-medium">
                Quantity <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-10 shrink-0 text-lg font-semibold px-0"
                  onClick={() => {
                    const v = parseInt(form.quantity || '0', 10);
                    if (v > 0) setForm((f) => ({ ...f, quantity: String(v - 1) }));
                  }}
                >−</Button>
                <Input
                  id="qty"
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className="bg-background border-border h-10 text-center font-semibold text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-10 shrink-0 text-lg font-semibold px-0"
                  onClick={() => {
                    const v = parseInt(form.quantity || '0', 10);
                    setForm((f) => ({ ...f, quantity: String(v + 1) }));
                  }}
                >+</Button>
              </div>
            </div>

            {/* Commodity */}
            <div className="space-y-1.5">
              <Label htmlFor="commodity" className="text-sm font-medium">
                Commodity <span className="text-destructive">*</span>
              </Label>
              {/* Determine whether current value is a known option or free-text */}
              {(() => {
                const knownOpts = commodityOptions.filter((o) => o !== 'other');
                const isKnown   = knownOpts.includes(form.commodity.toLowerCase()) || form.commodity === '';
                const selectVal = isKnown ? form.commodity.toLowerCase() : 'other';
                return (
                  <div className="flex flex-col gap-1.5">
                    <Select
                      value={selectVal}
                      onValueChange={(v) => {
                        if (v === 'other') {
                          setForm((f) => ({ ...f, commodity: '' }));
                        } else {
                          setForm((f) => ({ ...f, commodity: v }));
                        }
                      }}
                    >
                      <SelectTrigger id="commodity" className="bg-background border-border h-10">
                        <SelectValue placeholder="Select commodity…" />
                      </SelectTrigger>
                      <SelectContent>
                        {commodityOptions.map((opt) => (
                          <SelectItem key={opt} value={opt} className="capitalize">
                            {opt === 'other' ? 'Other (type manually)' : opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Free-text input shown only when "Other" is selected */}
                    {selectVal === 'other' && (
                      <Input
                        placeholder="Type commodity…"
                        value={form.commodity}
                        onChange={(e) => setForm((f) => ({ ...f, commodity: e.target.value }))}
                        className="bg-background border-border h-10"
                        autoFocus
                        autoComplete="off"
                      />
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Damage */}
            <div className="space-y-1.5">
              <Label htmlFor="damage" className="text-sm font-medium">Damage</Label>
              <Select
                value={form.damage || 'none'}
                onValueChange={(v) => setForm({ ...form, damage: v })}
              >
                <SelectTrigger
                  id="damage"
                  className={`bg-background border-border h-10 ${form.damage && form.damage !== 'none' ? 'border-[#f39c12] text-[#f39c12]' : ''}`}
                >
                  <SelectValue placeholder="Select damage type…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="wet">Wet</SelectItem>
                  <SelectItem value="torn">Torn</SelectItem>
                  <SelectItem value="dented">Dented</SelectItem>
                  <SelectItem value="b/o">B/O</SelectItem>
                  <SelectItem value="broken">Broken</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Damage photos — only shown when damage is not 'none' */}
            {form.damage && form.damage !== 'none' && (
              <div className="space-y-1.5 rounded-lg border border-[#f39c12]/30 bg-[#f39c12]/5 p-3">
                <Label className="flex items-center gap-1.5 text-[#f39c12]">
                  <Camera className="h-3.5 w-3.5" />
                  Damage Photos
                </Label>
                <DamagePhotoUploader photos={damagePhotos} onChange={setDamagePhotos} />
              </div>
            )}

            {/* Remarks */}
            <div className="space-y-1.5">
              <Label htmlFor="remarks" className="text-sm font-medium text-muted-foreground">
                Remarks <span className="font-normal text-xs">(optional)</span>
              </Label>
              <Textarea
                id="remarks"
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value.toUpperCase() })}
                rows={2}
                className="bg-background border-border min-h-[60px] uppercase resize-none"
                placeholder="Any additional notes…"
              />
            </div>

            {/* Storage Location — hidden for Shipping Agents */}
            {!isShippingAgent && (
              <div className="space-y-1.5">
                <Label htmlFor="storage" className="text-sm font-medium">Storage Location</Label>
                <Input
                  id="storage"
                  value={form.storage_location}
                  onChange={(e) => setForm({ ...form, storage_location: e.target.value.toUpperCase() })}
                  placeholder="e.g. A1"
                  className="bg-background border-border h-10 uppercase"
                />
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" onClick={requestCloseDialog} className="sm:mr-auto">Cancel</Button>
            <Button onClick={() => { addAnotherRef.current = false; handleSave(); }}>
              {editingCargo ? 'Update' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl border-border overflow-y-auto max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle>Cargo Summary</DialogTitle>
            <DialogDescription>Preview and print the cargo destuffing report</DialogDescription>
          </DialogHeader>
          <CargoSummaryPrint container={container} cargo={cargo} onPrint={() => {}} onClose={() => setSummaryOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* ── Unsaved changes warning ── */}
      <AlertDialog open={closeWarningOpen} onOpenChange={setCloseWarningOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Unsaved Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved data in this form. If you close now, your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCloseWarningOpen(false)}>Keep Editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setCloseWarningOpen(false); setDialogOpen(false); }}
            >
              Discard &amp; Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cargo Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The cargo record will be permanently removed from the container.
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

      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Cargo?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {cargo.length} cargo record{cargo.length !== 1 ? 's' : ''} for this container. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              disabled={clearingAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearingAll ? 'Clearing…' : `Clear All ${cargo.length} Record${cargo.length !== 1 ? 's' : ''}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={startOpen} onOpenChange={setStartOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Start Destuffing?</AlertDialogTitle>
            <AlertDialogDescription>
              This will set the start time to now and change the container status to In Process. You can then begin adding cargo records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStartContainer} disabled={starting} className="bg-[#3498db] text-white hover:bg-[#3498db]/90">
              {starting ? 'Starting...' : 'Start Destuffing'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>End Container?</AlertDialogTitle>
            <AlertDialogDescription>
              This will set the end time to now and mark the container as Completed. You can still view and edit cargo records after ending.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleEndContainer} disabled={ending} className="bg-[#2ecc71] text-white hover:bg-[#2ecc71]/90">
              {ending ? 'Ending...' : 'End Container'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Manifest Upload Dialog ──────────────────────────────────────── */}
      <Dialog open={manifestOpen} onOpenChange={(open) => { setManifestOpen(open); if (!open) { setManifestFileName(''); setConsignees([]); setManifestTab('upload'); setLibrarySelected(null); setLibrarySearch(''); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="h-5 w-5 text-primary" />
              Manifest — {containerId}
            </DialogTitle>
            <DialogDescription>
              Upload a new manifest directly, or select one from the shared library.
            </DialogDescription>
          </DialogHeader>

          {/* ── Tab switcher ── */}
          <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setManifestTab('upload')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors
                ${manifestTab === 'upload'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <FileUp className="h-4 w-4" />
              Upload New
            </button>
            <button
              type="button"
              onClick={() => { setManifestTab('library'); if (!libraryEntries.length) fetchLibraryEntries(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors
                ${manifestTab === 'library'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <BookOpen className="h-4 w-4" />
              From Library
              {libraryEntries.length > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold
                  ${manifestTab === 'library' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {libraryEntries.length}
                </span>
              )}
            </button>
          </div>

          {/* ══ UPLOAD TAB ══ */}
          {manifestTab === 'upload' && (
          <div className="py-2 space-y-4 min-h-0">
            {/* Drop zone — hidden once consignees are ready */}
            {consignees.length === 0 && (
              <>
                <div
                  onDragOver={(e) => { e.preventDefault(); setManifestDragOver(true); }}
                  onDragLeave={() => setManifestDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setManifestDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f) handleManifestUpload(f);
                  }}
                  onClick={() => !manifestUploading && !consigneeParsing && manifestFileInputRef.current?.click()}
                  className={`cursor-pointer border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition-colors
                    ${manifestDragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60 hover:bg-muted/40'}
                    ${(manifestUploading || consigneeParsing) ? 'pointer-events-none opacity-60' : ''}`}
                >
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <FileUp className="h-6 w-6 text-primary" />
                  </div>
                  {manifestUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                      <p className="text-sm text-muted-foreground">Uploading {manifestFileName}…</p>
                    </div>
                  ) : consigneeParsing ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                      <p className="text-sm text-muted-foreground">Extracting consignees…</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="font-medium text-sm">Drop your manifest here, or click to browse</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF, Excel (.xlsx, .xls), CSV, TXT, or Word (.docx) — max 20 MB</p>
                    </div>
                  )}
                </div>
                <input
                  ref={manifestFileInputRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,.txt,.doc,.docx"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleManifestUpload(f); e.target.value = ''; }}
                />
              </>
            )}

            {/* Existing manifest files attached to container */}
            {(container?.manifest_url || container?.manifest_txt_url) && consignees.length === 0 && (
              <div className="space-y-2">
                {container?.manifest_url && (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-muted-foreground">PDF Manifest attached</span>
                    <a href={container.manifest_url} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-primary hover:underline flex items-center gap-1 text-xs">
                      View <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-primary hover:bg-primary/10"
                      title="Re-extract consignees" disabled={consigneeParsing} onClick={handleReExtract}>
                      {consigneeParsing
                        ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        : <RefreshCw className="h-4 w-4" />}
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Delete PDF manifest"
                      onClick={async () => {
                        const { error } = await supabase.from('containers').update({ manifest_url: null }).eq('container_id', containerId);
                        if (error) { toast.error('Could not delete manifest: ' + error.message); return; }
                        setContainer((prev) => prev ? { ...prev, manifest_url: null } : prev);
                        toast.success('PDF manifest removed');
                      }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {container?.manifest_txt_url && (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-muted-foreground">TXT/Spreadsheet Manifest attached</span>
                    <a href={container.manifest_txt_url} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-primary hover:underline flex items-center gap-1 text-xs">
                      View <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-primary hover:bg-primary/10"
                      title="Re-extract consignees" disabled={consigneeParsing} onClick={handleReExtract}>
                      {consigneeParsing
                        ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        : <RefreshCw className="h-4 w-4" />}
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Delete TXT manifest"
                      onClick={async () => {
                        const { error } = await supabase.from('containers').update({ manifest_txt_url: null }).eq('container_id', containerId);
                        if (error) { toast.error('Could not delete manifest: ' + error.message); return; }
                        setContainer((prev) => prev ? { ...prev, manifest_txt_url: null } : prev);
                        toast.success('TXT manifest removed');
                      }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Extracted rows preview */}
            {consignees.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-muted-foreground">{manifestFileName}</span>
                  {container?.manifest_url && (
                    <a href={container.manifest_url} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-primary hover:underline flex items-center gap-1 text-xs">
                      PDF <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {container?.manifest_txt_url && (
                    <a href={container.manifest_txt_url} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-primary hover:underline flex items-center gap-1 text-xs">
                      TXT <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <Button type="button" variant="ghost" size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="Remove manifest"
                    onClick={() => { setConsignees([]); setManifestFileName(''); setLibrarySelected(null); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-sm font-medium">
                    {consignees.length} row{consignees.length !== 1 ? 's' : ''} extracted
                  </p>
                  <span className="text-xs text-muted-foreground">— review below then click Add to Cargo</span>
                </div>

                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                        <tr className="border-b border-border">
                          <th className="py-2 px-3 text-left font-medium text-muted-foreground uppercase whitespace-nowrap">BL#</th>
                          <th className="py-2 px-3 text-left font-medium text-muted-foreground uppercase whitespace-nowrap">
                            Marks
                            <span className="ml-1 font-normal normal-case text-[10px] text-muted-foreground/70">(will be imported)</span>
                          </th>
                          <th className="py-2 px-3 text-left font-medium text-muted-foreground uppercase whitespace-nowrap">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consignees.map((e, i) => {
                          const resolved = resolveMarks(e);
                          const usedMarks = !!e.marksText;
                          return (
                            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                              <td className="py-1.5 px-3 font-mono text-xs whitespace-nowrap">
                                {e.blNo || <span className="italic text-muted-foreground">—</span>}
                              </td>
                              <td className="py-1.5 px-3 font-medium max-w-[200px] truncate" title={resolved.toUpperCase()}>
                                {resolved.toUpperCase()}
                              </td>
                              <td className="py-1.5 px-3 whitespace-nowrap">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  usedMarks ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                                  {usedMarks ? 'Marks & Numbers' : 'Consignee'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  <strong>Marks</strong> uses the <em>Marks &amp; Numbers</em> field when available, else the Consignee name.
                  Commodity and Quantity are left blank — fill them in after importing.
                </p>
              </div>
            )}
          </div>
          )}

          {/* ══ LIBRARY TAB ══ */}
          {manifestTab === 'library' && (
          <div className="py-2 space-y-3 min-h-0">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Search manifests…"
                className="pl-8 h-8 text-sm"
              />
              {librarySearch && (
                <button onClick={() => setLibrarySearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Library list */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                {libraryLoading ? (
                  <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    Loading library…
                  </div>
                ) : (() => {
                  const q = librarySearch.toLowerCase();
                  const filtered = libraryEntries.filter((e) =>
                    e.file_name.toLowerCase().includes(q) ||
                    (e.description ?? '').toLowerCase().includes(q) ||
                    (e.uploader_name ?? '').toLowerCase().includes(q)
                  );
                  if (filtered.length === 0) return (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      {librarySearch ? `No results for "${librarySearch}"` : 'No manifests in library yet.'}
                    </div>
                  );
                  return filtered.map((entry) => {
                    const isSelected = librarySelected?.id === entry.id;
                    return (
                      <div key={entry.id}
                        className={`flex items-start gap-3 px-3 py-2.5 border-b border-border last:border-0 cursor-pointer transition-colors
                          ${isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-muted/30'}`}
                        onClick={() => !libraryExtracting && setLibrarySelected(isSelected ? null : entry)}
                      >
                        {/* File type icon */}
                        <div className="shrink-0 mt-0.5">
                          {entry.file_type === 'pdf'
                            ? <FileText className="h-4 w-4 text-red-500" />
                            : ['xlsx','xls','csv'].includes(entry.file_type)
                              ? <FileSpreadsheet className="h-4 w-4 text-green-600" />
                              : <FileText className="h-4 w-4 text-blue-500" />}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate text-foreground" title={entry.file_name}>
                            {entry.file_name}
                          </p>
                          {entry.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.description}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                            {entry.uploader_name ?? '—'} · {new Date(entry.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                        {/* Type badge + view link */}
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {entry.file_type}
                          </span>
                          <a href={entry.public_url} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                            View <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </div>
                        {/* Checkmark */}
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {librarySelected && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                <span className="flex-1 min-w-0 truncate font-medium">{librarySelected.file_name}</span>
                {libraryExtracting && (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
                )}
              </div>
            )}
          </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setManifestOpen(false); setManifestFileName(''); setConsignees([]); setManifestTab('upload'); setLibrarySelected(null); setLibrarySearch(''); }}
            >
              {consignees.length > 0 ? 'Skip' : 'Close'}
            </Button>

            {/* Library tab: Extract button */}
            {manifestTab === 'library' && librarySelected && consignees.length === 0 && (
              <Button
                onClick={() => handleUseLibraryManifest(librarySelected)}
                disabled={libraryExtracting}
                className="gap-2"
              >
                {libraryExtracting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    Extracting…
                  </>
                ) : (
                  <>
                    <Users className="h-4 w-4" />
                    Extract Consignees
                  </>
                )}
              </Button>
            )}

            {/* Both tabs: Add to Cargo once rows are extracted */}
            {consignees.length > 0 && (
              <Button onClick={handleConsigneeImport} disabled={consigneeImporting} className="gap-2">
                {consigneeImporting ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full" />
                    Adding…
                  </>
                ) : (
                  <>
                    <Users className="h-4 w-4" />
                    Add {consignees.length} Row{consignees.length !== 1 ? 's' : ''} to Cargo
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── buildPrintHTML: generates a complete standalone HTML document for printing ──
function buildPrintHTML(container: Container, cargo: Cargo[]): string {
  const totalQty = cargo.reduce((s, c) => s + (c.quantity ?? 0), 0);
  const damaged = cargo.filter((c) => c.damage && c.damage !== 'none');
  const commodityTotals: Record<string, number> = {};
  cargo.forEach((c) => {
    commodityTotals[c.commodity || '—'] = (commodityTotals[c.commodity || '—'] || 0) + (c.quantity ?? 0);
  });

  // Sort by marks → cargo_id
  const sorted = [...cargo].sort((a, b) => {
    const ma = (a.marks || '').toLowerCase();
    const mb = (b.marks || '').toLowerCase();
    if (ma < mb) return -1; if (ma > mb) return 1;
    return a.cargo_id - b.cargo_id;
  });

  // Group by mark, tracking first/last in group and sys_no collapsing
  interface PrintRow { cargo: Cargo; showMarks: boolean; isLastInGroup: boolean; showSysNo: boolean; sysNoCount: number; }
  const printRows: PrintRow[] = [];
  let currentMark = '';
  let markBuffer: Cargo[] = [];

  function flush() {
    if (!markBuffer.length) return;
    const sysNoCounts: Record<string, number> = {};
    markBuffer.forEach((c) => { const k = c.system_number || '__null__'; sysNoCounts[k] = (sysNoCounts[k] || 0) + 1; });
    const seen = new Set<string>();
    markBuffer.forEach((c, idx) => {
      const snKey = c.system_number || '__null__';
      const isFirst = !seen.has(snKey);
      if (isFirst) seen.add(snKey);
      printRows.push({ cargo: c, showMarks: idx === 0, isLastInGroup: idx === markBuffer.length - 1, showSysNo: isFirst, sysNoCount: sysNoCounts[snKey] });
    });
    markBuffer = [];
  }

  sorted.forEach((c) => {
    const mk = (c.marks || '').toLowerCase() || '(no marks)';
    if (mk !== currentMark) { flush(); currentMark = mk; }
    markBuffer.push(c);
  });
  flush();

  const esc = (s: string | null | undefined) =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const infoFields = [
    ['Vessel', container.vessel_name],
    ['Arrival Date', container.arrival_date || '—'],
    ['Destuff Date', container.destuff_date || '—'],
    ['Destuff Shed', (container as Container & { destuff_shed?: string }).destuff_shed || '—'],
    ['Start Time', container.start_time || '—'],
    ['End Time', container.end_time || '—'],
    ['Total Items', String(cargo.length)],
    ['Total Qty', totalQty.toLocaleString()],
  ];

  const statusColor =
    container.status === 'Completed' ? '#1a7a3c' :
    container.status === 'In Process' ? '#1a5fa8' : '#555';

  const cargoRows = printRows.map((row, idx) => {
    const c = row.cargo;
    const bg = idx % 2 === 0 ? '#ffffff' : '#f7f8fa';
    const borderBottom = row.isLastInGroup ? '1.5px solid #555' : '1px solid #e0e0e0';
    const marksCell = row.showMarks
      ? `<div style="border-left:2.5px solid #e67e22;padding-left:4px;white-space:pre-wrap;font-weight:600;font-size:8pt;line-height:1.3">${esc(c.marks) || '(no marks)'}</div>`
      : '';
    const damageCell = c.damage && c.damage !== 'none'
      ? `<span style="color:#c0392b;font-weight:600">${esc(c.damage)}${Array.isArray(c.damage_photos) && c.damage_photos.length > 0 ? ` <span style="font-size:6.5pt;color:#888">[${c.damage_photos.length} photo${c.damage_photos.length !== 1 ? 's' : ''}]</span>` : ''}</span>`
      : '<span style="color:#aaa">—</span>';
    const sysNoCell = row.showSysNo
      ? `<span style="font-family:monospace;font-weight:700">${esc(c.system_number) || '—'}${row.sysNoCount > 1 ? `<span style="font-weight:400;font-size:6.5pt;color:#666"> ×${row.sysNoCount}</span>` : ''}</span>`
      : '';
    const td = (content: string, align = 'left', extra = '') =>
      `<td style="padding:3px 4px;vertical-align:top;text-align:${align};border-bottom:${borderBottom};overflow:hidden;${extra}">${content}</td>`;

    return `<tr style="background:${bg};break-inside:avoid">
      ${td(`<span style="font-family:monospace;font-size:7pt;color:#333">${esc(c.bl_no) || '—'}</span>`)}
      ${td(`<span style="font-size:7pt">${esc(c.pallet_no) || '—'}</span>`)}
      ${td(marksCell)}
      ${td(`<span style="font-size:7.5pt;font-weight:500">${esc(c.commodity) || '—'}</span>`)}
      ${td(`<span style="font-size:8pt;font-weight:700">${c.quantity ?? '—'}</span>`, 'right')}
      ${td(`<span style="font-size:7pt">${damageCell}</span>`)}
      ${td(`<span style="font-size:7pt;color:#444">${esc(c.remarks) || '—'}</span>`)}
      ${td(`<span style="font-size:7.5pt">${esc(c.storage_location) || '—'}</span>`)}
      ${td(sysNoCell)}
    </tr>`;
  }).join('');

  const sigRows = [
    { role: 'Clerk', name: container.clerk_name, sig: container.clerk_signature },
    { role: 'Agent / Receiver', name: container.agent_name, sig: container.agent_signature },
  ].map(({ role, name, sig }) => {
    const sigContent = sig && sig.startsWith('data:')
      ? `<img src="${sig}" alt="${esc(role)} signature" style="height:36px;border:1px solid #ccc;display:block">`
      : '<div style="border-bottom:1px solid #999;height:36px;min-width:120px"></div>';
    return `
      <div>
        <p style="font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px">${esc(role)}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div>
            <p style="font-size:7pt;color:#666;margin:0 0 2px">Name</p>
            <p style="font-size:9pt;font-weight:600;border-bottom:1px solid #999;padding-bottom:2px;min-height:18px;margin:0">${esc(name) || '&nbsp;'}</p>
          </div>
          <div>
            <p style="font-size:7pt;color:#666;margin:0 0 2px">Signature</p>
            ${sigContent}
          </div>
        </div>
      </div>`;
  }).join('');

  const commoditySummary = Object.entries(commodityTotals).map(([k, v]) => `${esc(k)}: ${v}`).join(' &middot; ');
  const now = new Date();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cargo Destuffing Report — ${esc(container.container_id)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table { border-collapse: collapse; width: 100%; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { break-inside: avoid; }
    .no-break { break-inside: avoid; }
    /* Summary section gets its own page */
    .summary-section { break-before: page; break-inside: avoid; }
    /* Signature section gets its own page */
    .sig-section { break-before: page; break-inside: avoid; }
    @media screen {
      body { background: #f0f0f0; padding: 16px; }
      .page { background: #fff; max-width: 794px; margin: 0 auto; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
      .no-print { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
      .btn { padding: 8px 16px; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; font-size: 13px; font-weight: 600; }
      .btn-primary { background: #1a1a2e; color: #fff; border-color: #1a1a2e; }
    }
    @media print {
      body { background: #fff; padding: 0; }
      .page { padding: 0; box-shadow: none; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Toolbar (screen only) -->
  <div class="no-print">
    <button class="btn btn-primary" onclick="window.print()">&#128438; Print / Save as PDF</button>
    <button class="btn" onclick="window.close()">Close</button>
    <span style="font-size:11px;color:#666;margin-left:8px">Use your browser's Print dialog to select paper size (A4 or Letter), margins, and orientation.</span>
  </div>

  <!-- ── Page 1: Header + Cargo Table ──────────────────────────────── -->
  <div class="no-break" style="border-bottom:2px solid #000;padding:10px 0 8px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <p style="font-size:7pt;text-transform:uppercase;letter-spacing:0.12em;color:#777;font-weight:600;margin:0 0 2px">Official Document</p>
        <h1 style="font-size:16pt;font-weight:900;text-transform:uppercase;letter-spacing:0.03em;margin:0;line-height:1">Cargo Destuffing Report</h1>
        <p style="font-size:8pt;color:#555;margin:4px 0 0">Printed: ${esc(now.toLocaleDateString())} ${esc(now.toLocaleTimeString())}</p>
      </div>
      <div style="text-align:right">
        <p style="font-size:7pt;text-transform:uppercase;letter-spacing:0.1em;color:#777;margin:0 0 2px">Container No.</p>
        <p style="font-size:20pt;font-weight:900;letter-spacing:0.06em;margin:0;line-height:1">${esc(container.container_id)}</p>
        <span style="display:inline-block;margin-top:4px;padding:2px 8px;font-size:7.5pt;font-weight:700;text-transform:uppercase;border:1.5px solid ${statusColor};color:${statusColor}">${esc(container.status)}</span>
      </div>
    </div>
    <div style="margin-top:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:4px 16px;font-size:8.5pt">
      ${infoFields.map(([label, value]) => `
        <div style="display:flex;gap:4px;align-items:baseline">
          <span style="font-weight:700;color:#555;white-space:nowrap">${esc(label)}:</span>
          <span style="font-weight:500">${esc(value)}</span>
        </div>`).join('')}
    </div>
  </div>

  <div style="margin-top:10px">
    <table style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:7.5pt">
      <colgroup>
        <col style="width:9%">   <!-- BL# -->
        <col style="width:8%">   <!-- Pallet -->
        <col style="width:21%">  <!-- Marks -->
        <col style="width:13%">  <!-- Commodity -->
        <col style="width:5%">   <!-- Qty -->
        <col style="width:8%">   <!-- Damage -->
        <col style="width:14%">  <!-- Remarks -->
        <col style="width:12%">  <!-- Storage -->
        <col style="width:10%">  <!-- System No -->
      </colgroup>
      <thead>
        <tr style="background:#1a1a2e;color:#fff">
          ${['BL#','Pallet No','Marks','Commodity','Qty','Damage','Remarks','Storage','System No'].map((h, i) =>
            `<th style="padding:5px 4px;text-align:${i === 4 ? 'right' : 'left'};font-size:7pt;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;border-bottom:2px solid #000;white-space:nowrap">${h}</th>`
          ).join('')}
        </tr>
      </thead>
      <tbody>${cargoRows}</tbody>
      <tfoot>
        <tr style="background:#f0f0f0;border-top:2px solid #000">
          <td colspan="4" style="padding:5px 6px;font-weight:700;font-size:8pt">TOTALS</td>
          <td style="padding:5px 6px;text-align:right;font-weight:900;font-size:9pt">${totalQty.toLocaleString()}</td>
          <td style="padding:5px 6px;font-size:8pt;color:${damaged.length > 0 ? '#c0392b' : '#555'};font-weight:${damaged.length > 0 ? 700 : 400}">${damaged.length > 0 ? `${damaged.length} damaged` : '—'}</td>
          <td colspan="3" style="padding:5px 6px;font-size:7.5pt;color:#555">${commoditySummary}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- ── Page 2: Summary Statistics ────────────────────────────────── -->
  <div class="summary-section" style="padding-top:16px">
    <h2 style="font-size:11pt;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #000;padding-bottom:4px;margin:0 0 12px">Cargo Summary</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      <div style="border:1px solid #ddd;padding:10px 12px">
        <p style="font-size:7pt;color:#777;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px">Total Items</p>
        <p style="font-size:18pt;font-weight:900;margin:0;line-height:1">${cargo.length}</p>
      </div>
      <div style="border:1px solid #ddd;padding:10px 12px">
        <p style="font-size:7pt;color:#777;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px">Total Quantity</p>
        <p style="font-size:18pt;font-weight:900;margin:0;line-height:1">${totalQty.toLocaleString()}</p>
      </div>
      <div style="border:1px solid ${damaged.length > 0 ? '#c0392b' : '#ddd'};padding:10px 12px">
        <p style="font-size:7pt;color:${damaged.length > 0 ? '#c0392b' : '#777'};text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px">Damaged Items</p>
        <p style="font-size:18pt;font-weight:900;margin:0;line-height:1;color:${damaged.length > 0 ? '#c0392b' : '#000'}">${damaged.length}</p>
      </div>
    </div>
    <h3 style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px;color:#444">Commodity Breakdown</h3>
    <table style="border-collapse:collapse;width:50%;font-size:8pt">
      <thead>
        <tr style="background:#f0f0f0">
          <th style="text-align:left;padding:4px 8px;border:1px solid #ddd;font-weight:700">Commodity</th>
          <th style="text-align:right;padding:4px 8px;border:1px solid #ddd;font-weight:700">Total Qty</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(commodityTotals).sort((a,b)=>b[1]-a[1]).map(([k,v],i)=>
          `<tr style="background:${i%2===0?'#fff':'#f9f9f9'}">
            <td style="padding:3px 8px;border:1px solid #e0e0e0;text-transform:capitalize">${esc(k)}</td>
            <td style="padding:3px 8px;border:1px solid #e0e0e0;text-align:right;font-weight:700">${v}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${damaged.length > 0 ? `
    <h3 style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px;color:#c0392b">Damaged Items Detail</h3>
    <table style="border-collapse:collapse;width:100%;font-size:7.5pt">
      <thead>
        <tr style="background:#fff0f0">
          <th style="text-align:left;padding:4px 6px;border:1px solid #ddd;font-weight:700">BL#</th>
          <th style="text-align:left;padding:4px 6px;border:1px solid #ddd;font-weight:700">Pallet</th>
          <th style="text-align:left;padding:4px 6px;border:1px solid #ddd;font-weight:700">Marks</th>
          <th style="text-align:left;padding:4px 6px;border:1px solid #ddd;font-weight:700">Commodity</th>
          <th style="text-align:left;padding:4px 6px;border:1px solid #ddd;font-weight:700">Damage</th>
          <th style="text-align:left;padding:4px 6px;border:1px solid #ddd;font-weight:700">Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${damaged.map((c,i)=>`
        <tr style="background:${i%2===0?'#fff':'#fff8f8'}">
          <td style="padding:3px 6px;border:1px solid #e0e0e0;font-family:monospace;font-size:7pt">${esc(c.bl_no)||'—'}</td>
          <td style="padding:3px 6px;border:1px solid #e0e0e0">${esc(c.pallet_no)||'—'}</td>
          <td style="padding:3px 6px;border:1px solid #e0e0e0;font-size:7pt;max-width:120px;overflow:hidden">${esc(c.marks)||'—'}</td>
          <td style="padding:3px 6px;border:1px solid #e0e0e0;text-transform:capitalize">${esc(c.commodity)||'—'}</td>
          <td style="padding:3px 6px;border:1px solid #e0e0e0;color:#c0392b;font-weight:700">${esc(c.damage)||'—'}</td>
          <td style="padding:3px 6px;border:1px solid #e0e0e0;font-size:7pt">${esc(c.remarks)||'—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : ''}
  </div>

  <!-- ── Page 3: Signatures ─────────────────────────────────────────── -->
  <div class="sig-section" style="padding-top:16px;border-top:1px solid #ccc">
    <h2 style="font-size:11pt;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #000;padding-bottom:4px;margin:0 0 20px">Signatures &amp; Acknowledgement</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px">
      ${sigRows}
    </div>
    <p style="font-size:7pt;color:#777;margin-top:32px;border-top:1px solid #e0e0e0;padding-top:8px">
      This document was generated by the Cargo Destuffing Management System.
      Container: <strong>${esc(container.container_id)}</strong> &middot;
      Vessel: <strong>${esc(container.vessel_name)}</strong> &middot;
      Generated: ${esc(now.toLocaleString())}
    </p>
  </div>

</div>
</body>
</html>`;
}

function CargoSummaryPrint({
  container,
  cargo,
  onClose,
}: {
  container: Container | null;
  cargo: Cargo[];
  onPrint: () => void;
  onClose: () => void;
}) {
  if (!container) return null;

  function handlePrint() {
    const html = buildPrintHTML(container!, cargo);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Please allow popups for this site to enable printing.'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    // Give the new window a moment to render before printing
    win.onload = () => { win.focus(); win.print(); };
  }

  const totalQty = cargo.reduce((s, c) => s + (c.quantity ?? 0), 0);
  const damaged = cargo.filter((c) => c.damage && c.damage !== 'none');
  const commodityTotals: Record<string, number> = {};
  cargo.forEach((c) => {
    commodityTotals[c.commodity || '—'] = (commodityTotals[c.commodity || '—'] || 0) + (c.quantity ?? 0);
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <Button className="gap-2" onClick={handlePrint}>
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </Button>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>

      {/* On-screen preview */}
      <div className="rounded-lg border border-border bg-white text-black p-5 text-sm space-y-4" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        {/* Header row */}
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <p className="text-[7pt] uppercase tracking-widest text-gray-500 font-semibold mb-1">Official Document</p>
            <h2 className="text-lg font-extrabold uppercase tracking-wide">Cargo Destuffing Report</h2>
            <p className="text-xs text-gray-500 mt-1">Preview — click Print to open clean printable version</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase">Container No.</p>
            <p className="text-2xl font-extrabold tracking-widest">{container.container_id}</p>
            <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-bold uppercase border ${
              container.status === 'Completed' ? 'border-green-700 text-green-700' :
              container.status === 'In Process' ? 'border-blue-700 text-blue-700' :
              'border-gray-500 text-gray-500'}`}>
              {container.status}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Items', value: cargo.length },
            { label: 'Total Qty', value: totalQty.toLocaleString() },
            { label: 'Damaged', value: damaged.length, warn: damaged.length > 0 },
          ].map(({ label, value, warn }) => (
            <div key={label} className={`border rounded p-3 ${warn ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
              <p className={`text-2xl font-black ${warn ? 'text-red-600' : 'text-black'}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Commodity breakdown */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-2">Commodity Breakdown</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(commodityTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <span key={k} className="px-2 py-1 rounded bg-gray-100 text-xs font-medium capitalize">
                {k}: <strong>{v}</strong>
              </span>
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-400 border-t border-gray-200 pt-3">
          The printed report will include: Page 1 — full cargo table · Page 2 — summary &amp; damaged items · Page 3 — signatures
        </p>
      </div>
    </div>
  );
}
