import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  Download, ChevronRight, RotateCcw, FileUp, Info, ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { parseImportFile, parsePdfManifest, downloadTemplate } from '@/lib/import';
import type { ImportType, ImportPreview, ParsedRow } from '@/lib/import';

// ── Step type ────────────────────────────────────────────────────────────────
type Step = 'select' | 'upload' | 'preview' | 'result';

interface ImportResult {
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
}

// ── Helper: step indicator ───────────────────────────────────────────────────
const STEPS: { key: Step; label: string }[] = [
  { key: 'select', label: 'Data Type' },
  { key: 'upload', label: 'Upload File' },
  { key: 'preview', label: 'Preview & Validate' },
  { key: 'result', label: 'Done' },
];

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.key} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
              ${active ? 'bg-primary text-primary-foreground' : done ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 inline-flex items-center justify-center">{i + 1}</span>}
              {s.label}
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className="h-4 w-4 mx-1 text-muted-foreground shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Row status badge ─────────────────────────────────────────────────────────
function RowBadge({ row }: { row: ParsedRow }) {
  if (!row.valid) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
      <XCircle className="h-3 w-3" /> Error
    </span>
  );
  if (row.warnings.length > 0) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-500">
      <AlertTriangle className="h-3 w-3" /> Warning
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
      <CheckCircle2 className="h-3 w-3" /> OK
    </span>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ImportPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('select');
  const [importType, setImportType] = useState<ImportType>('containers');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFile = useCallback(async (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!ext || !['xlsx', 'xls', 'csv', 'pdf'].includes(ext)) {
      toast.error('Supported formats: Excel (.xlsx, .xls), CSV (.csv), PDF (.pdf)');
      return;
    }
    // PDF manifests are cargo-only: consignee → marks mapping is handled by parsePdfManifest
    if (ext === 'pdf' && importType !== 'cargo') {
      toast.error('PDF manifests can only be imported as Cargo rows');
      return;
    }
    setFile(f);
    setParsing(true);
    try {
      const p = ext === 'pdf'
        ? await parsePdfManifest(f)
        : await parseImportFile(f, importType);
      setPreview(p);
      if (p.totalRows === 0) {
        toast.error('No data rows found in the file');
      } else {
        toast.success(`Extracted ${p.totalRows} row${p.totalRows !== 1 ? 's' : ''} — Consignee names mapped to Marks`);
        setStep('preview');
      }
    } catch (e: unknown) {
      toast.error('Failed to parse file: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setParsing(false);
    }
  }, [importType]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  // ── Import to Supabase ─────────────────────────────────────────────────────
  async function handleImport(skipInvalid: boolean) {
    if (!preview) return;
    const rows = skipInvalid ? preview.rows.filter((r) => r.valid) : preview.rows;
    if (rows.length === 0) { toast.error('No valid rows to import'); return; }

    setImporting(true);
    let inserted = 0;
    const errors: string[] = [];

    try {
      if (importType === 'containers') {
        const records = rows.map((r) => r.data) as Record<string, unknown>[];
        const { error } = await supabase.from('containers').upsert(
          records as never,
          { onConflict: 'container_id', ignoreDuplicates: false },
        );
        if (error) errors.push(error.message);
        else inserted = records.length;
      } else {
        const CHUNK = 50;
        const allRecords = rows.map((r) => r.data) as Record<string, unknown>[];
        for (let i = 0; i < allRecords.length; i += CHUNK) {
          const batch = allRecords.slice(i, i + CHUNK);
          const { error } = await supabase.from('cargo').insert(batch as never);
          if (error) errors.push(`Rows ${i + 1}–${i + batch.length}: ${error.message}`);
          else inserted += batch.length;
        }
      }
    } catch (e: unknown) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    setImporting(false);
    setResult({ inserted, updated: 0, failed: rows.length - inserted, errors });
    setStep('result');
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  function reset() {
    setStep('select');
    setFile(null);
    setPreview(null);
    setResult(null);
    setShowOnlyErrors(false);
  }

  // ── Column field labels ────────────────────────────────────────────────────
  const CONTAINER_FIELDS = ['container_id', 'vessel_name', 'arrival_date', 'destuff_date', 'destuff_shed', 'status', 'expected_cargo_count'];
  const CARGO_FIELDS = ['container_id', 'pallet_no', 'commodity', 'quantity', 'marks', 'storage_location', 'damage', 'remarks'];
  const activeFields = importType === 'containers' ? CONTAINER_FIELDS : CARGO_FIELDS;
  // Human-readable column header overrides for the preview table
  const FIELD_LABELS: Record<string, string> = { marks: 'Marks (Consignee)' };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-xl">Import Data</h1>
          <p className="text-sm text-muted-foreground">Import containers or cargo from Excel or CSV files</p>
        </div>
        {step !== 'select' && (
          <Button variant="outline" onClick={reset} className="gap-2 shrink-0">
            <RotateCcw className="h-4 w-4" /> Start Over
          </Button>
        )}
      </div>

      {/* Step bar */}
      <div className="overflow-x-auto">
        <StepBar current={step} />
      </div>

      {/* ── STEP 1: Select data type ────────────────────────────────────── */}
      {step === 'select' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          {(['containers', 'cargo'] as ImportType[]).map((t) => (
            <button
              key={t}
              onClick={() => { setImportType(t); setStep('upload'); }}
              className={`group text-left p-6 rounded-lg border-2 transition-all hover:border-primary hover:bg-primary/5
                ${importType === t ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
            >
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold capitalize">{t}</p>
                  <p className="text-sm text-muted-foreground mt-1 text-pretty">
                    {t === 'containers'
                      ? 'Import container records with vessel, dates, shed, and status'
                      : 'Import cargo items linked to existing containers'}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-3">
                    {(t === 'containers' ? CONTAINER_FIELDS : CARGO_FIELDS).slice(0, 4).map((f) => (
                      <span key={f} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">{f}</span>
                    ))}
                    <span className="text-xs text-muted-foreground py-0.5">…</span>
                  </div>
                </div>
              </div>
            </button>
          ))}

          {/* Format info */}
          <div className="md:col-span-2 bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Info className="h-4 w-4 text-primary shrink-0" />
              Supported file formats
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              {[
                { icon: '📊', label: 'Excel (.xlsx, .xls)', note: 'Export from Microsoft Excel' },
                { icon: '📄', label: 'CSV (.csv)', note: 'Universal — works from any app' },
                { icon: '🗄️', label: 'Microsoft Access', note: 'Export table to Excel or CSV first, then import here' },
              ].map((f) => (
                <div key={f.label} className="flex items-start gap-2 p-3 bg-muted/40 rounded-md">
                  <span className="text-base shrink-0">{f.icon}</span>
                  <div>
                    <p className="font-medium text-xs">{f.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{f.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Upload ──────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-4 max-w-2xl">

          {/* Data type switcher */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Importing:</span>
            <Select value={importType} onValueChange={(v) => setImportType(v as ImportType)}>
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="containers">Containers</SelectItem>
                <SelectItem value="cargo">Cargo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center gap-3 transition-colors
              ${dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60 hover:bg-muted/40'}`}
          >
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <FileUp className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="font-medium">Drop your file here, or click to browse</p>
              <p className="text-sm text-muted-foreground mt-1">
                Excel (.xlsx, .xls), CSV (.csv){importType === 'cargo' ? ', or PDF manifest (.pdf)' : ''} — max 10 MB
              </p>
            </div>
            {parsing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                Parsing file…
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={onFileChange} />

          {/* Download template */}
          <div className="flex flex-col md:flex-row md:items-center gap-3 p-4 bg-muted/40 rounded-lg border border-border">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Need a template?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Download a pre-formatted Excel template with example data and correct column headers.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              onClick={() => void downloadTemplate(importType)}
            >
              <Download className="h-4 w-4" />
              Download Template
            </Button>
          </div>

          {/* Column reference */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Expected columns for <span className="text-primary capitalize">{importType}</span></CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {activeFields.map((f) => {
                  const required = importType === 'containers'
                    ? ['container_id', 'vessel_name', 'arrival_date'].includes(f)
                    : ['container_id', 'commodity', 'quantity'].includes(f);
                  return (
                    <div key={f} className="flex items-center gap-1">
                      <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{f}</code>
                      {required && <span className="text-xs text-destructive">*</span>}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                <span className="text-destructive">*</span> Required fields. Column names are flexible — common variations are auto-detected.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── STEP 3: Preview & Validate ──────────────────────────────────── */}
      {step === 'preview' && preview && (
        <div className="space-y-4">

          {/* Summary bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Rows', value: preview.totalRows, cls: 'text-foreground' },
              { label: 'Valid', value: preview.validRows, cls: 'text-green-600 dark:text-green-400' },
              { label: 'Errors', value: preview.invalidRows, cls: preview.invalidRows > 0 ? 'text-destructive' : 'text-foreground' },
              { label: 'Warnings', value: preview.rows.filter((r) => r.warnings.length > 0).length, cls: 'text-yellow-500' },
            ].map((s) => (
              <div key={s.label} className="bg-card border border-border rounded-lg p-4 text-center">
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Column mapping summary */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-sm">
                Detected column mapping
                {file && <span className="ml-2 font-normal text-muted-foreground text-xs">— {file.name}</span>}
              </CardTitle>
              <Badge variant="secondary" className="shrink-0">{Object.keys(preview.mappedFields).length} of {preview.headers.length} headers mapped</Badge>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {preview.headers.map((h) => {
                  const mapped = preview.mappedFields[h];
                  return (
                    <div key={h} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border ${mapped ? 'bg-primary/5 border-primary/20 text-foreground' : 'bg-muted border-border text-muted-foreground'}`}>
                      <code className="font-mono">{h}</code>
                      {mapped && (
                        <>
                          <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                          <code className="font-mono text-primary">{mapped}</code>
                        </>
                      )}
                      {!mapped && <span className="text-muted-foreground/60 ml-1">(skipped)</span>}
                    </div>
                  );
                })}
              </div>
              {preview.headers.some((h) => !preview.mappedFields[h]) && (
                <p className="text-xs text-muted-foreground mt-2">
                  Skipped columns were not recognised and will be ignored during import.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Row preview table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium">Row preview</p>
              <button
                onClick={() => setShowOnlyErrors((v) => !v)}
                className={`text-xs px-3 py-1 rounded-full transition-colors ${showOnlyErrors ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              >
                {showOnlyErrors ? 'Show all rows' : 'Show errors only'}
              </button>
            </div>

            <div className="w-full max-w-full overflow-x-auto border border-border bg-card">
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground uppercase whitespace-nowrap">#</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground uppercase whitespace-nowrap">Status</th>
                    {activeFields.map((f) => (
                      <th key={f} className="text-left py-2 px-3 font-medium text-muted-foreground uppercase whitespace-nowrap">{FIELD_LABELS[f] ?? f}</th>
                    ))}
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground uppercase whitespace-nowrap">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {(showOnlyErrors ? preview.rows.filter((r) => !r.valid || r.warnings.length > 0) : preview.rows)
                    .slice(0, 200)
                    .map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={`border-b border-border ${!row.valid ? 'bg-destructive/5' : row.warnings.length > 0 ? 'bg-yellow-500/5' : 'hover:bg-accent/20'}`}
                      >
                        <td className="py-2 px-3 whitespace-nowrap text-muted-foreground">{row.rowIndex}</td>
                        <td className="py-2 px-3 whitespace-nowrap"><RowBadge row={row} /></td>
                        {activeFields.map((f) => (
                          <td key={f} className="py-2 px-3 whitespace-nowrap font-mono">
                            {row.data[f] !== null && row.data[f] !== undefined ? String(row.data[f]) : <span className="text-muted-foreground/50">-</span>}
                          </td>
                        ))}
                        <td className="py-2 px-3 min-w-[200px]">
                          {row.errors.length > 0 && (
                            <div className="space-y-0.5">
                              {row.errors.map((e, i) => (
                                <p key={i} className="text-destructive text-xs"><XCircle className="inline h-3 w-3 mr-1" />{e}</p>
                              ))}
                            </div>
                          )}
                          {row.warnings.map((w, i) => (
                            <p key={i} className="text-yellow-600 dark:text-yellow-400 text-xs"><AlertTriangle className="inline h-3 w-3 mr-1" />{w}</p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  {preview.rows.length === 0 && (
                    <tr><td colSpan={activeFields.length + 3} className="py-10 text-center text-muted-foreground">No data rows found</td></tr>
                  )}
                </tbody>
              </table>
              {preview.rows.length > 200 && (
                <p className="text-xs text-muted-foreground p-3 border-t border-border">
                  Showing first 200 of {preview.rows.length} rows — all rows will be imported.
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col md:flex-row items-start md:items-center gap-3 pt-2">
            {preview.invalidRows > 0 && preview.validRows > 0 && (
              <Button
                variant="outline"
                onClick={() => handleImport(true)}
                disabled={importing}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                Import {preview.validRows} valid rows (skip {preview.invalidRows} errors)
              </Button>
            )}
            {preview.validRows > 0 && preview.invalidRows === 0 && (
              <Button
                onClick={() => handleImport(false)}
                disabled={importing}
                className="gap-2"
              >
                {importing
                  ? <><div className="animate-spin h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full" /> Importing…</>
                  : <><Upload className="h-4 w-4" /> Import {preview.validRows} rows</>}
              </Button>
            )}
            {preview.validRows > 0 && preview.invalidRows > 0 && (
              <Button
                onClick={() => handleImport(false)}
                disabled={importing}
                className="gap-2"
              >
                {importing
                  ? <><div className="animate-spin h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full" /> Importing…</>
                  : <><Upload className="h-4 w-4" /> Import all {preview.totalRows} rows</>}
              </Button>
            )}
            {preview.validRows === 0 && (
              <p className="text-sm text-destructive flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0" /> No valid rows to import — fix the errors in your file and re-upload.
              </p>
            )}
            <Button variant="ghost" onClick={() => setStep('upload')} className="text-muted-foreground">
              ← Re-upload
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Result ──────────────────────────────────────────────── */}
      {step === 'result' && result && (
        <div className="max-w-lg space-y-4">
          <div className={`rounded-lg border p-6 space-y-3 ${result.errors.length === 0 ? 'border-green-500/30 bg-green-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
            <div className="flex items-center gap-3">
              {result.errors.length === 0
                ? <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400 shrink-0" />
                : <AlertTriangle className="h-8 w-8 text-yellow-500 shrink-0" />}
              <div>
                <p className="font-semibold text-base">
                  {result.errors.length === 0 ? 'Import successful' : 'Import completed with issues'}
                </p>
                <p className="text-sm text-muted-foreground capitalize">{importType} records processed</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2">
              {[
                { label: 'Inserted / Updated', value: result.inserted + result.updated, cls: 'text-green-600 dark:text-green-400' },
                { label: 'Failed', value: result.failed, cls: result.failed > 0 ? 'text-destructive' : 'text-muted-foreground' },
                { label: 'Errors', value: result.errors.length, cls: result.errors.length > 0 ? 'text-yellow-500' : 'text-muted-foreground' },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 space-y-1">
              <p className="text-sm font-medium text-destructive mb-2">Import errors:</p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-destructive flex items-start gap-1.5">
                  <XCircle className="h-3 w-3 mt-0.5 shrink-0" />{e}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={reset} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Import More Data
            </Button>
            <Button variant="outline" onClick={() => navigate('/containers')}>
              View {importType === 'containers' ? 'Containers' : 'Cargo'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
