import { useRef, useState } from 'react';
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const BUCKET = 'damage-photos';
const MAX_BYTES = 1024 * 1024; // 1 MB
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

async function compressToWebp(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIM = 1920;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) { height = Math.round((height / width) * MAX_DIM); width = MAX_DIM; }
        else { width = Math.round((width / height) * MAX_DIM); height = MAX_DIM; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      let quality = 0.8;
      function tryCompress() {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('Compression failed')); return; }
          if (blob.size <= MAX_BYTES || quality <= 0.2) { resolve(blob); return; }
          quality -= 0.1;
          tryCompress();
        }, 'image/webp', quality);
      }
      tryCompress();
    };
    img.onerror = reject;
    img.src = url;
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 40);
}

interface Props {
  photos: string[];         // current public URLs
  onChange: (urls: string[]) => void;
  disabled?: boolean;
  maxPhotos?: number;
}

export function DamagePhotoUploader({ photos, onChange, disabled, maxPhotos = 5 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lightbox, setLightbox] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = maxPhotos - photos.length;
    if (remaining <= 0) { toast.error(`Maximum ${maxPhotos} photos allowed`); return; }
    const toUpload = Array.from(files).slice(0, remaining);
    const invalid = toUpload.filter((f) => !ACCEPTED.includes(f.type));
    if (invalid.length) { toast.error('Only JPEG, PNG, WEBP, GIF, AVIF images are supported'); return; }

    setUploading(true);
    setProgress(0);
    const newUrls: string[] = [];

    for (let i = 0; i < toUpload.length; i++) {
      let file: File | Blob = toUpload[i];
      let compressed = false;

      if (file.size > MAX_BYTES) {
        try {
          file = await compressToWebp(toUpload[i]);
          compressed = true;
        } catch {
          toast.error(`Failed to compress ${toUpload[i].name}`);
          continue;
        }
      }

      const baseName = sanitizeFilename(toUpload[i].name.replace(/\.[^.]+$/, ''));
      const ext = compressed ? 'webp' : toUpload[i].name.split('.').pop() || 'jpg';
      const path = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${baseName}.${ext}`;

      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: compressed ? 'image/webp' : toUpload[i].type,
        upsert: false,
      });

      if (error) { toast.error(`Upload failed: ${error.message}`); continue; }

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      newUrls.push(urlData.publicUrl);

      if (compressed) {
        const kb = Math.round(file.size / 1024);
        toast.success(`Photo uploaded (compressed to ${kb} KB)`);
      } else {
        toast.success('Photo uploaded');
      }

      setProgress(Math.round(((i + 1) / toUpload.length) * 100));
    }

    onChange([...photos, ...newUrls]);
    setUploading(false);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleRemove(url: string) {
    // Extract storage path from public URL
    const parts = url.split(`/${BUCKET}/`);
    if (parts.length === 2) {
      await supabase.storage.from(BUCKET).remove([parts[1]]);
    }
    onChange(photos.filter((u) => u !== url));
  }

  return (
    <div className="space-y-2">
      {/* Upload area */}
      {photos.length < maxPhotos && (
        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer
            ${disabled || uploading ? 'opacity-50 pointer-events-none border-border' : 'border-border hover:border-primary hover:bg-primary/5'}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(',')}
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={disabled || uploading}
          />
          <div className="flex flex-col items-center gap-1.5">
            {uploading ? (
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
            ) : (
              <Upload className="h-6 w-6 text-muted-foreground" />
            )}
            <p className="text-sm font-medium text-muted-foreground">
              {uploading ? `Uploading… ${progress}%` : 'Click or drag photos here'}
            </p>
            <p className="text-xs text-muted-foreground/60">
              JPEG, PNG, WEBP, GIF, AVIF · auto-compressed if &gt;1 MB · max {maxPhotos} photos
            </p>
          </div>
          {/* Progress bar */}
          {uploading && (
            <div className="mt-2 h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1">
          {photos.map((url) => (
            <div key={url} className="relative group w-20 h-20 rounded-md overflow-hidden border border-border bg-muted shrink-0">
              <img
                src={url}
                alt="Damage photo"
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setLightbox(url)}
              />
              {!disabled && (
                <button
                  type="button"
                  className="absolute top-0.5 right-0.5 h-5 w-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); handleRemove(url); }}
                  title="Remove photo"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}
            </div>
          ))}
          {photos.length < maxPhotos && !uploading && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-20 h-20 rounded-md border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors shrink-0"
              disabled={disabled}
            >
              <ImageIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox} alt="Damage photo" className="w-full max-h-[80vh] object-contain rounded-lg" />
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 bg-black/50 text-white hover:bg-black/70"
              onClick={() => setLightbox(null)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
