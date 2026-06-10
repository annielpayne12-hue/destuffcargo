import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, FileText, Trash2, ExternalLink, Search, FileSpreadsheet,
  FilePlus2, Download, Calendar, User, HardDrive, StickyNote, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ManifestLibraryEntry } from '@/types/types';

const ALLOWED_EXTS = ['pdf', 'xlsx', 'xls', 'csv', 'txt', 'doc', 'docx'] as const;
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

function formatBytes(b: number | null) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fileTypeIcon(fileType: string) {
  if (fileType === 'pdf') return <FileText className="h-5 w-5 text-red-500" />;
  if (['xlsx', 'xls', 'csv'].includes(fileType)) return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
  if (['doc', 'docx'].includes(fileType)) return <FileText className="h-5 w-5 text-blue-500" />;
  return <FileText className="h-5 w-5 text-muted-foreground" />;
}

function fileTypeBadge(fileType: string) {
  const colorMap: Record<string, string> = {
    pdf:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    xlsx: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    xls:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    csv:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    txt:  'bg-muted text-muted-foreground',
    doc:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    docx: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  const cls = colorMap[fileType] ?? 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
      {fileType}
    </span>
  );
}

export default function ManifestsPage() {
  const { user, isAdmin, canManageContainers } = useAuth();

  // Roles that may upload: Admin, Manager, Supervisor, Data Entry Clerk (not Clerk)
  const canUpload = canManageContainers || user?.role === 'Data Entry Clerk';

  const [entries, setEntries] = useState<ManifestLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Upload dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ManifestLibraryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('manifest_library')
      .select('*')
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) { toast.error('Failed to load manifests: ' + error.message); return; }
    setEntries((data as ManifestLibraryEntry[]) ?? []);
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // ── Upload ────────────────────────────────────────────────────────────────
  function handleFileSelect(f: File) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!(ALLOWED_EXTS as readonly string[]).includes(ext)) {
      toast.error(`Unsupported file type: .${ext}. Allowed: ${ALLOWED_EXTS.join(', ')}`);
      return;
    }
    if (f.size > MAX_SIZE_BYTES) {
      toast.error('File exceeds the 20 MB limit');
      return;
    }
    setUploadFile(f);
  }

  async function handleUpload() {
    if (!uploadFile || !user) return;
    setUploading(true);
    const ext = uploadFile.name.split('.').pop()?.toLowerCase() ?? '';
    const storagePath = `library/${Date.now()}_${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    try {
      // Upload to Supabase Storage (reuse existing 'manifests' bucket)
      const { error: upErr } = await supabase.storage
        .from('manifests')
        .upload(storagePath, uploadFile, { upsert: false });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('manifests').getPublicUrl(storagePath);

      const { error: dbErr } = await supabase.from('manifest_library').insert({
        file_name:    uploadFile.name,
        file_type:    ext,
        storage_path: storagePath,
        public_url:   urlData.publicUrl,
        file_size:    uploadFile.size,
        description:  description.trim() || null,
        uploaded_by:  user.id,
        uploader_name: user.full_name || user.username,
      });
      if (dbErr) throw dbErr;

      toast.success(`"${uploadFile.name}" added to manifest library`);
      setUploadOpen(false);
      setUploadFile(null);
      setDescription('');
      fetchEntries();
    } catch (err: any) {
      toast.error('Upload failed: ' + (err.message ?? String(err)));
    } finally {
      setUploading(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Remove from storage
      await supabase.storage.from('manifests').remove([deleteTarget.storage_path]);
      // Remove DB record
      const { error } = await supabase.from('manifest_library').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast.success(`"${deleteTarget.file_name}" removed from library`);
      setDeleteTarget(null);
      fetchEntries();
    } catch (err: any) {
      toast.error('Delete failed: ' + (err.message ?? String(err)));
    } finally {
      setDeleting(false);
    }
  }

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = entries.filter((e) => {
    const q = search.toLowerCase();
    return (
      e.file_name.toLowerCase().includes(q) ||
      (e.description ?? '').toLowerCase().includes(q) ||
      (e.uploader_name ?? '').toLowerCase().includes(q) ||
      e.file_type.includes(q)
    );
  });

  return (
    <div className="flex flex-col min-h-full p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground text-balance">Manifest Library</h1>
          <p className="text-sm text-muted-foreground mt-0.5 text-pretty">
            Central repository for all cargo manifest files. Upload once, attach to any container.
          </p>
        </div>
        {canUpload && (
          <Button onClick={() => setUploadOpen(true)} className="gap-2 shrink-0">
            <FilePlus2 className="h-4 w-4" />
            Upload Manifest
          </Button>
        )}
      </div>

      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by filename, description or uploader…"
          className="pl-9"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Stats badge */}
      {!loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{entries.length} manifest{entries.length !== 1 ? 's' : ''} in library</Badge>
          {search && filtered.length !== entries.length && (
            <Badge variant="outline">{filtered.length} matching</Badge>
          )}
        </div>
      )}

      {/* Table / grid */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 border-b border-border">
              <tr>
                <th className="py-2.5 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">File</th>
                <th className="py-2.5 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Type</th>
                <th className="py-2.5 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Description</th>
                <th className="py-2.5 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Size</th>
                <th className="py-2.5 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Uploaded By</th>
                <th className="py-2.5 px-4 text-left font-medium text-muted-foreground whitespace-nowrap">Date</th>
                <th className="py-2.5 px-4 text-right font-medium text-muted-foreground whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-3 px-4" colSpan={7}><Skeleton className="h-5 w-full bg-muted" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-muted-foreground">
                    {search
                      ? `No manifests match "${search}"`
                      : (
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                            <FileText className="h-7 w-7 text-muted-foreground/50" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground text-sm">No manifests uploaded yet</p>
                            {canUpload && (
                              <p className="text-xs mt-1">Click <strong>Upload Manifest</strong> to add the first file.</p>
                            )}
                          </div>
                        </div>
                      )
                    }
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => {
                  const canDeleteThis = isAdmin || entry.uploaded_by === user?.id;
                  return (
                    <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      {/* File name */}
                      <td className="py-3 px-4 max-w-[200px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="shrink-0">{fileTypeIcon(entry.file_type)}</span>
                          <span className="truncate font-medium text-foreground" title={entry.file_name}>
                            {entry.file_name}
                          </span>
                        </div>
                      </td>
                      {/* Type badge */}
                      <td className="py-3 px-4 whitespace-nowrap">{fileTypeBadge(entry.file_type)}</td>
                      {/* Description */}
                      <td className="py-3 px-4 max-w-[220px]">
                        {entry.description
                          ? <span className="text-foreground/80 truncate block" title={entry.description}>{entry.description}</span>
                          : <span className="italic text-muted-foreground/50 text-xs">—</span>
                        }
                      </td>
                      {/* Size */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {formatBytes(entry.file_size)}
                      </td>
                      {/* Uploader */}
                      <td className="py-3 px-4 whitespace-nowrap text-muted-foreground text-xs">
                        {entry.uploader_name ?? '—'}
                      </td>
                      {/* Date */}
                      <td className="py-3 px-4 whitespace-nowrap text-muted-foreground text-xs">
                        {formatDate(entry.created_at)}
                      </td>
                      {/* Actions */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={entry.public_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View / Download"
                          >
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10">
                              <Download className="h-4 w-4" />
                            </Button>
                          </a>
                          {canDeleteThis && (
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              title="Delete"
                              onClick={() => setDeleteTarget(entry)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Upload dialog ──────────────────────────────────────────────────── */}
      <Dialog open={uploadOpen} onOpenChange={(o) => { if (!uploading) { setUploadOpen(o); if (!o) { setUploadFile(null); setDescription(''); } } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Upload Manifest to Library
            </DialogTitle>
            <DialogDescription>
              Upload a manifest file to the shared library. It will be available to attach to any container.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFileSelect(f);
              }}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`cursor-pointer border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-3 transition-colors
                ${dragOver ? 'border-primary bg-primary/10' : uploadFile ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'}
                ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              {uploadFile ? (
                <div className="flex items-center gap-3 w-full">
                  <span className="shrink-0">{fileTypeIcon(uploadFile.name.split('.').pop()?.toLowerCase() ?? '')}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{uploadFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(uploadFile.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-medium text-sm">Drop file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, Excel (.xlsx/.xls), CSV, TXT, Word (.docx) — max 20 MB</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.xlsx,.xls,.csv,.txt,.doc,.docx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }}
            />

            {/* Optional description */}
            <div className="space-y-1.5">
              <Label htmlFor="manifest-desc" className="text-sm font-normal">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="manifest-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. MV Atlantic Star — Voyage 47, arrived June 2026"
                rows={2}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setUploadOpen(false); setUploadFile(null); setDescription(''); }} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploading} className="gap-2">
              {uploading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload to Library
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Manifest?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{deleteTarget?.file_name}</strong> will be permanently removed from the
              library and cannot be recovered. Containers that were already imported using this manifest are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
