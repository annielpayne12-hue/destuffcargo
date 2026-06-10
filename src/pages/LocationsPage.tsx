import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, Search, ChevronDown, ChevronRight, ExternalLink,
  Boxes, Save, X, CheckCircle2, Container,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { exportToExcel, exportToCSV, printTable } from '@/lib/export';
import { ExportMenu } from '@/components/common/ExportMenu';
import { TablePagination } from '@/components/common/TablePagination';
import type { Cargo } from '@/types/types';

const BROWSE_PAGE_SIZE = 15;

interface ContainerGroup {
  container_id: string;
  items: Cargo[];
}

// Pallet group within the assign panel — all cargo sharing the same pallet_no in a container
interface PalletGroup {
  palletKey: string;        // pallet_no value (or unique key for no-pallet rows)
  palletNo: string;         // display value
  items: Cargo[];           // all cargo records sharing this pallet
  locationInput: string;    // shared editable location
  saving: boolean;
  saved: boolean;
}

const DAMAGE_COLORS: Record<string, string> = {
  none: 'bg-primary/10 text-primary border-primary/20',
  wet: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  torn: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  broken: 'bg-destructive/10 text-destructive border-destructive/20',
  dented: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'b/o': 'bg-destructive/15 text-destructive border-destructive/30',
};

/** Natural/numeric sort comparator for pallet numbers (e.g. P-1 < P-2 < P-10) */
function sortPalletKey(a: string, b: string): number {
  // Extract leading text prefix and trailing number if present
  const re = /^(.*?)(\d+)$/;
  const ma = re.exec(a);
  const mb = re.exec(b);
  if (ma && mb && ma[1] === mb[1]) {
    return parseInt(ma[2], 10) - parseInt(mb[2], 10);
  }
  return a.localeCompare(b);
}

/** Build pallet groups from a flat list of cargo within one container */
function buildPalletGroups(items: Cargo[]): PalletGroup[] {
  const map = new Map<string, Cargo[]>();
  for (const c of items) {
    const key = c.pallet_no ? c.pallet_no.trim().toUpperCase() : `__NO_PALLET__${c.cargo_id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  const groups = Array.from(map.entries()).map(([palletKey, cargo]) => {
    // shared location: use the common value if all rows agree, else blank
    const locs = [...new Set(cargo.map((r) => (r.storage_location ?? '').trim().toUpperCase()))];
    return {
      palletKey,
      palletNo: palletKey.startsWith('__NO_PALLET__') ? '' : palletKey,
      items: cargo,
      locationInput: locs.length === 1 ? locs[0] : '',
      saving: false,
      saved: false,
    };
  });
  // Sort pallets numerically; push no-pallet rows to the end
  groups.sort((a, b) => {
    if (!a.palletNo && !b.palletNo) return 0;
    if (!a.palletNo) return 1;
    if (!b.palletNo) return -1;
    return sortPalletKey(a.palletNo, b.palletNo);
  });
  return groups;
}

export default function LocationsPage() {
  const navigate = useNavigate();
  const { } = useAuth();

  // Bottom grouped view
  const [cargo, setCargo] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [browsePage, setBrowsePage] = useState(1);

  // Assign panel
  const [containerInput, setContainerInput] = useState('');
  const [containerSuggestions, setContainerSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState('');
  const [palletGroups, setPalletGroups] = useState<PalletGroup[] | null>(null);
  const [containerLoading, setContainerLoading] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const containerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestRef = useRef<HTMLDivElement>(null);

  // ── fetch all cargo for grouped browse view ───────────────────────────────
  async function fetchCargo() {
    setLoading(true);
    const { data } = await supabase
      .from('cargo')
      .select('cargo_id,container_id,pallet_no,quantity,commodity,marks,bl_no,storage_location,damage,remarks')
      .order('container_id', { ascending: true })
      .order('pallet_no', { ascending: true })
      .limit(2000);
    setCargo(Array.isArray(data) ? (data as Cargo[]) : []);
    setLoading(false);
  }

  useEffect(() => { fetchCargo(); }, []);

  // ── container autocomplete ────────────────────────────────────────────────
  useEffect(() => {
    if (containerDebounceRef.current) clearTimeout(containerDebounceRef.current);
    const trimmed = containerInput.trim().toUpperCase();
    if (!trimmed) { setContainerSuggestions([]); setShowSuggestions(false); return; }

    containerDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('cargo')
        .select('container_id')
        .ilike('container_id', `%${trimmed}%`)
        .order('container_id', { ascending: true })
        .limit(10);
      if (Array.isArray(data)) {
        const unique = [...new Set(data.map((r: { container_id: string }) => r.container_id))];
        setContainerSuggestions(unique);
        setShowSuggestions(unique.length > 0);
      }
    }, 250);

    return () => { if (containerDebounceRef.current) clearTimeout(containerDebounceRef.current); };
  }, [containerInput]);

  // close autocomplete on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // ── load pallets for selected container ───────────────────────────────────
  async function loadContainerPallets(containerId: string) {
    setContainerLoading(true);
    const { data } = await supabase
      .from('cargo')
      .select('*')
      .eq('container_id', containerId)
      .order('pallet_no', { ascending: true });
    setPalletGroups(Array.isArray(data) ? buildPalletGroups(data as Cargo[]) : []);
    setContainerLoading(false);
  }

  function selectContainer(id: string) {
    setContainerInput(id);
    setSelectedContainer(id);
    setShowSuggestions(false);
    loadContainerPallets(id);
  }

  function clearAssign() {
    setContainerInput('');
    setSelectedContainer('');
    setPalletGroups(null);
    setContainerSuggestions([]);
    setShowSuggestions(false);
  }

  // ── update location draft for a pallet group ──────────────────────────────
  function updateGroupLocation(palletKey: string, value: string) {
    setPalletGroups((prev) =>
      prev ? prev.map((g) =>
        g.palletKey === palletKey ? { ...g, locationInput: value.toUpperCase(), saved: false } : g
      ) : prev
    );
  }

  // ── save a pallet group (updates ALL cargo_ids in the group) ──────────────
  async function savePalletGroup(palletKey: string) {
    if (!palletGroups) return;
    const group = palletGroups.find((g) => g.palletKey === palletKey);
    if (!group) return;

    const loc = group.locationInput.trim().toUpperCase();
    if (!loc) { toast.error('Please enter a storage location'); return; }

    setPalletGroups((prev) =>
      prev ? prev.map((g) => g.palletKey === palletKey ? { ...g, saving: true } : g) : prev
    );

    const ids = group.items.map((c) => c.cargo_id);
    const { error } = await supabase
      .from('cargo')
      .update({ storage_location: loc })
      .in('cargo_id', ids);

    if (error) {
      toast.error('Failed to save: ' + error.message);
      setPalletGroups((prev) =>
        prev ? prev.map((g) => g.palletKey === palletKey ? { ...g, saving: false } : g) : prev
      );
      return;
    }

    setPalletGroups((prev) =>
      prev ? prev.map((g) =>
        g.palletKey === palletKey
          ? {
              ...g, saving: false, saved: true,
              items: g.items.map((c) => ({ ...c, storage_location: loc })),
            }
          : g
      ) : prev
    );

    const label = group.palletNo || '(no pallet no.)';
    toast.success(
      `Location "${loc}" saved for pallet ${label}` +
      (ids.length > 1 ? ` — ${ids.length} cargo records updated` : '')
    );
    await fetchCargo();
  }

  // ── save ALL pallet groups that have a non-empty location input ───────────
  async function saveAllPalletGroups() {
    if (!palletGroups) return;
    const pending = palletGroups.filter((g) => g.locationInput.trim());
    if (!pending.length) { toast.error('No locations to save — enter at least one location first'); return; }

    setSavingAll(true);
    // Mark all pending groups as saving
    setPalletGroups((prev) =>
      prev ? prev.map((g) =>
        g.locationInput.trim() ? { ...g, saving: true } : g
      ) : prev
    );

    let saved = 0;
    let failed = 0;
    for (const group of pending) {
      const loc = group.locationInput.trim().toUpperCase();
      const ids = group.items.map((c) => c.cargo_id);
      const { error } = await supabase
        .from('cargo')
        .update({ storage_location: loc })
        .in('cargo_id', ids);

      if (error) {
        failed++;
        setPalletGroups((prev) =>
          prev ? prev.map((g) => g.palletKey === group.palletKey ? { ...g, saving: false } : g) : prev
        );
      } else {
        saved++;
        setPalletGroups((prev) =>
          prev ? prev.map((g) =>
            g.palletKey === group.palletKey
              ? { ...g, saving: false, saved: true, items: g.items.map((c) => ({ ...c, storage_location: loc })) }
              : g
          ) : prev
        );
      }
    }

    setSavingAll(false);
    if (failed === 0) {
      toast.success(`All ${saved} location${saved !== 1 ? 's' : ''} saved successfully`);
    } else {
      toast.error(`${saved} saved, ${failed} failed — check your connection and retry`);
    }
    await fetchCargo();
  }

  // ── grouped browse view ───────────────────────────────────────────────────
  const containerGroups = useMemo<ContainerGroup[]>(() => {
    const map = new Map<string, Cargo[]>();
    for (const item of cargo) {
      if (!map.has(item.container_id)) map.set(item.container_id, []);
      map.get(item.container_id)!.push(item);
    }
    return Array.from(map.entries())
      .map(([container_id, items]) => ({ container_id, items }))
      .sort((a, b) => a.container_id.localeCompare(b.container_id));
  }, [cargo]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return containerGroups;
    return containerGroups.filter(
      (g) =>
        g.container_id.toUpperCase().includes(q) ||
        g.items.some(
          (i) =>
            (i.pallet_no ?? '').toUpperCase().includes(q) ||
            i.commodity.toUpperCase().includes(q) ||
            (i.storage_location ?? '').toUpperCase().includes(q)
        )
    );
  }, [containerGroups, search]);

  const pagedGroups = useMemo(
    () => filtered.slice((browsePage - 1) * BROWSE_PAGE_SIZE, browsePage * BROWSE_PAGE_SIZE),
    [filtered, browsePage]
  );

  function handleSearchChange(q: string) {
    setSearch(q);
    setBrowsePage(1);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const totalContainers = containerGroups.length;
  const totalWithLocation = cargo.filter((c) => c.storage_location && c.storage_location.trim()).length;
  const totalPallets = cargo.filter((c) => c.pallet_no).length;

  // ── Export handlers ────────────────────────────────────────────────────
  function buildLocationRows() {
    return cargo.map((c) => ({
      'Container ID': c.container_id,
      'BL#': c.bl_no || '',
      'Pallet No': c.pallet_no || '',
      'Commodity': c.commodity,
      'Qty': c.quantity,
      'Storage Location': c.storage_location || '',
      'Damage': c.damage || '',
    }));
  }

  async function handleExcelExport() {
    const rows = buildLocationRows();
    if (!rows.length) { toast.error('No data to export'); return; }
    await exportToExcel(rows, 'Locations');
    toast.success('Exported to Excel');
  }

  function handleCsvExport() {
    const rows = buildLocationRows();
    if (!rows.length) { toast.error('No data to export'); return; }
    exportToCSV(rows, 'Locations');
    toast.success('Exported to CSV');
  }

  function handlePrint() {
    if (!cargo.length) { toast.error('No data to print'); return; }
    printTable(
      'Location Assignments',
      `${totalContainers} container(s) — ${totalWithLocation} of ${cargo.length} items located`,
      ['Container ID', 'BL#', 'Pallet No', 'Commodity', 'Qty', 'Storage Location', 'Damage'],
      cargo.map((c) => [c.container_id, c.bl_no, c.pallet_no, c.commodity, c.quantity, c.storage_location, c.damage]),
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2 text-balance">
            <MapPin className="h-5 w-5 text-primary shrink-0" />
            Location Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1 text-pretty">
            Search a container to assign storage locations to its pallets
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <div className="bg-card border border-border rounded-lg px-4 py-2 text-center min-w-[80px]">
            <p className="text-lg font-semibold text-primary">{totalContainers}</p>
            <p className="text-xs text-muted-foreground">Containers</p>
          </div>
          <div className="bg-card border border-border rounded-lg px-4 py-2 text-center min-w-[80px]">
            <p className="text-lg font-semibold text-primary">{totalPallets}</p>
            <p className="text-xs text-muted-foreground">Pallets</p>
          </div>
          <div className="bg-card border border-border rounded-lg px-4 py-2 text-center min-w-[80px]">
            <p className="text-lg font-semibold text-primary">{totalWithLocation}</p>
            <p className="text-xs text-muted-foreground">Located</p>
          </div>
        </div>
      </div>

      {/* ── Assign panel ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            Assign Storage Locations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Container search */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1 min-w-0 space-y-1.5 md:max-w-xs" ref={suggestRef}>
              <Label htmlFor="containerInput">Container</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="containerInput"
                  placeholder="Search container ID…"
                  value={containerInput}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setContainerInput(val);
                    if (selectedContainer && val !== selectedContainer) {
                      setSelectedContainer('');
                      setPalletGroups(null);
                    }
                  }}
                  onFocus={() => { if (containerSuggestions.length > 0) setShowSuggestions(true); }}
                  className="h-10 bg-background border-border pl-9 pr-8 uppercase"
                  autoComplete="off"
                />
                {containerInput && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={clearAssign}
                    type="button"
                    aria-label="Clear"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {showSuggestions && containerSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md overflow-hidden">
                    {containerSuggestions.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm font-mono hover:bg-muted/60 transition-colors"
                        onMouseDown={(e) => { e.preventDefault(); selectContainer(id); }}
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {selectedContainer && (
              <p className="text-xs text-muted-foreground md:pb-2">
                Container <span className="font-mono font-semibold text-foreground">{selectedContainer}</span>
                {palletGroups ? ` — ${palletGroups.length} pallet${palletGroups.length !== 1 ? 's' : ''}` : ''}
                . Enter location per pallet and press Save or Enter.
              </p>
            )}
          </div>

          {/* Pallet groups table */}
          {containerInput.trim() && (
            <div>
              {containerLoading && <p className="text-xs text-muted-foreground animate-pulse">Loading pallets…</p>}

              {!containerLoading && !selectedContainer && (
                <p className="text-xs text-muted-foreground">Select a container from the list above</p>
              )}

              {!containerLoading && selectedContainer && palletGroups !== null && palletGroups.length === 0 && (
                <p className="text-xs text-destructive">No cargo found for container "{selectedContainer}"</p>
              )}

              {!containerLoading && selectedContainer && palletGroups && palletGroups.length > 0 && (
                <div className="rounded-md border border-border overflow-x-auto">
                  <table className="w-full min-w-max text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-muted-foreground text-xs">
                        <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Pallet No</th>
                        <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Items</th>
                        <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Commodities</th>
                        <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Total Qty</th>
                        <th className="whitespace-nowrap text-left px-4 py-2 font-medium w-48">Storage Location</th>
                        <th className="whitespace-nowrap px-4 py-2 w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {palletGroups.map((group, idx) => {
                        const totalQty = group.items.reduce((s, c) => s + (c.quantity ?? 0), 0);
                        const commodities = [...new Set(group.items.map((c) => c.commodity))].join(', ');
                        const hasDamage = group.items.some((c) => c.damage && c.damage !== 'none');

                        return (
                          <tr
                            key={group.palletKey}
                            className={`border-t border-border/50 ${group.saved ? 'bg-primary/5' : idx % 2 === 1 ? 'bg-muted/10' : ''}`}
                          >
                            {/* Pallet number */}
                            <td className="whitespace-nowrap px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold font-mono text-sm">
                                  {group.palletNo || <span className="text-muted-foreground italic font-sans font-normal text-xs">No pallet no.</span>}
                                </span>
                                {hasDamage && (
                                  <Badge variant="outline" className="text-xs h-4 border-destructive/40 text-destructive">dmg</Badge>
                                )}
                              </div>
                            </td>
                            {/* Item count */}
                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground text-xs">
                              {group.items.length} cargo item{group.items.length !== 1 ? 's' : ''}
                            </td>
                            {/* Commodities */}
                            <td className="whitespace-nowrap px-4 py-3 capitalize text-xs max-w-[180px] truncate">
                              {commodities}
                            </td>
                            {/* Total qty */}
                            <td className="whitespace-nowrap px-4 py-3 font-medium">{totalQty}</td>
                            {/* Shared location input */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <Input
                                  value={group.locationInput}
                                  onChange={(e) => updateGroupLocation(group.palletKey, e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') savePalletGroup(group.palletKey); }}
                                  placeholder="e.g. ZONE-A / ROW-3"
                                  className="h-8 text-xs bg-background border-border uppercase w-44"
                                />
                                {group.saved && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                              </div>
                              {group.items.length > 1 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Saves to all {group.items.length} records
                                </p>
                              )}
                            </td>
                            {/* Save button */}
                            <td className="whitespace-nowrap px-4 py-3">
                              <Button
                                size="sm"
                                className="h-8 gap-1.5 text-xs"
                                onClick={() => savePalletGroup(group.palletKey)}
                                disabled={group.saving || !group.locationInput.trim()}
                              >
                                <Save className="h-3.5 w-3.5" />
                                {group.saving ? 'Saving…' : 'Save'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-2 border-t border-border flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      {palletGroups.length} pallet{palletGroups.length !== 1 ? 's' : ''} in {selectedContainer} —
                      edit locations then click <strong>Save All</strong> or use individual <strong>Save</strong> buttons
                    </p>
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-xs shrink-0"
                      onClick={saveAllPalletGroups}
                      disabled={savingAll || !palletGroups.some((g) => g.locationInput.trim())}
                    >
                      <Save className="h-3.5 w-3.5" />
                      {savingAll ? 'Saving All…' : `Save All Locations (${palletGroups.filter((g) => g.locationInput.trim()).length})`}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Browse section ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search container, pallet, location…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 h-10 bg-background border-border"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" className="h-9 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(new Set(pagedGroups.map((g) => g.container_id)))}>
            Expand All
          </Button>
          <Button variant="ghost" size="sm" className="h-9 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(new Set())}>
            Collapse All
          </Button>
          <ExportMenu
            onExcelExport={handleExcelExport}
            onCsvExport={handleCsvExport}
            onPrint={handlePrint}
            disabled={loading}
          />
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <div key={n} className="h-16 rounded-lg bg-muted animate-pulse" />)}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Boxes className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">
              {search ? 'No containers match your search' : 'No containers found'}
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {pagedGroups.map((group) => {
            const open = expanded.has(group.container_id);
            const palletCount = group.items.filter((i) => i.pallet_no).length;
            const locatedCount = group.items.filter((i) => i.storage_location && i.storage_location.trim()).length;
            const unlocatedCount = group.items.length - locatedCount;
            const hasDamage = group.items.some((i) => i.damage && i.damage !== 'none');
            const totalQty = group.items.reduce((s, i) => s + (i.quantity ?? 0), 0);
            const allLocated = locatedCount === group.items.length;

            return (
              <Card key={group.container_id} className="h-full overflow-hidden">
                <button
                  className="w-full text-left"
                  onClick={() => toggleExpand(group.container_id)}
                  aria-expanded={open}
                >
                  <CardHeader className="py-3 px-4 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                        <Container className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base font-semibold font-mono truncate text-balance">
                          {group.container_id}
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {palletCount} pallet{palletCount !== 1 ? 's' : ''} · {totalQty} units
                          </span>
                          {allLocated
                            ? <Badge variant="outline" className="text-xs h-5 border-primary/40 text-primary">All Located</Badge>
                            : <Badge variant="outline" className="text-xs h-5 border-yellow-500/40 text-yellow-500">{unlocatedCount} unassigned</Badge>
                          }
                          {hasDamage && (
                            <Badge variant="outline" className="text-xs h-5 border-destructive/40 text-destructive">Has Damage</Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 text-xs gap-1.5 text-primary hover:text-primary hover:bg-primary/10 shrink-0 mr-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectContainer(group.container_id);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        title="Edit locations for this container"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">Edit Locations</span>
                      </Button>
                      <div className="shrink-0 text-muted-foreground">
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </div>
                    </div>
                  </CardHeader>
                </button>

                {open && (
                  <CardContent className="p-0">
                    <div className="border-t border-border overflow-x-auto">
                      <table className="w-full min-w-max text-sm">
                        <thead>
                          <tr className="bg-muted/40 text-muted-foreground text-xs">
                            <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Pallet No</th>
                            <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Storage Location</th>
                            <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Commodity</th>
                            <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Qty</th>
                            <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Damage</th>
                            <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Marks</th>
                            <th className="whitespace-nowrap text-left px-4 py-2 font-medium">Remarks</th>
                            <th className="whitespace-nowrap px-4 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item, idx) => (
                            <tr
                              key={item.cargo_id}
                              className={`border-t border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${idx % 2 === 1 ? 'bg-muted/10' : ''}`}
                              onClick={() => navigate(`/containers/${item.container_id}`)}
                            >
                              <td className="whitespace-nowrap px-4 py-3 font-medium font-mono text-xs">
                                {item.pallet_no || <span className="text-muted-foreground italic font-sans font-normal">—</span>}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                {item.storage_location && item.storage_location.trim()
                                  ? <span className="flex items-center gap-1.5 text-primary font-medium">
                                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                                      {item.storage_location}
                                    </span>
                                  : <span className="text-muted-foreground italic text-xs">Not assigned</span>}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 capitalize">{item.commodity}</td>
                              <td className="whitespace-nowrap px-4 py-3">{item.quantity}</td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <Badge variant="outline" className={`text-xs capitalize ${DAMAGE_COLORS[item.damage ?? 'none'] ?? DAMAGE_COLORS['none']}`}>
                                  {item.damage || 'none'}
                                </Badge>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 max-w-[140px] truncate text-muted-foreground text-xs">
                                {item.marks || <span className="italic">—</span>}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 max-w-[140px] truncate text-muted-foreground text-xs">
                                {item.remarks || <span className="italic">—</span>}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                                  onClick={(e) => { e.stopPropagation(); navigate(`/containers/${item.container_id}`); }}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  <span className="sr-only">View container</span>
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border bg-muted/20">
                            <td colSpan={2} className="px-4 py-2 text-xs text-muted-foreground font-medium">
                              {locatedCount}/{group.items.length} pallets located
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</td>
                            <td className="px-4 py-2 text-xs font-semibold">{totalQty}</td>
                            <td colSpan={4} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {!loading && filtered.length > BROWSE_PAGE_SIZE && (
        <TablePagination
          currentPage={browsePage}
          totalPages={Math.ceil(filtered.length / BROWSE_PAGE_SIZE)}
          totalItems={filtered.length}
          pageSize={BROWSE_PAGE_SIZE}
          onPageChange={setBrowsePage}
        />
      )}
    </div>
  );
}
