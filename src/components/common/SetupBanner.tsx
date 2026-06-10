import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldOff, ExternalLink, X, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';

type BannerMode = 'no-tables' | 'rls-blocked';

const RLS_DISABLE_SQL = `-- Disable Row Level Security (auth-bypass mode)
ALTER TABLE public.containers         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.container_yard     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifest_library   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ooc_notes          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_audit_log    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_settings  DISABLE ROW LEVEL SECURITY;

-- Re-grant access to anon + authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;`;

/**
 * Shown automatically when:
 *   - 'no-tables': the migration hasn't been run yet
 *   - 'rls-blocked': tables exist but RLS is blocking anon access
 */
export function SetupBanner() {
  const [mode, setMode] = useState<BannerMode | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem('setup_banner_dismissed') === '1'
  );

  useEffect(() => {
    if (dismissed) return;
    supabase.from('containers').select('container_id').limit(1).maybeSingle().then(({ error }) => {
      if (!error) return; // all good
      if (error.message.includes('schema cache') || error.message.includes('does not exist') || error.code === 'PGRST205') {
        setMode('no-tables');
      } else if (error.code === '42501' || error.message.toLowerCase().includes('row-level security') || error.message.toLowerCase().includes('rls')) {
        setMode('rls-blocked');
      } else {
        // Probe for RLS by attempting a write to a known table
        supabase.from('app_settings').select('key').limit(1).then(({ error: e2 }) => {
          if (e2?.code === '42501') setMode('rls-blocked');
        });
      }
    });

    // Also detect RLS via a separate probe (SELECT can return [] silently)
    supabase.from('app_settings').insert({ key: '__rls_probe__', value: '1' }).then(({ error }) => {
      if (error?.code === '42501') setMode('rls-blocked');
      // clean up if it somehow inserted
      if (!error) supabase.from('app_settings').delete().eq('key', '__rls_probe__');
    });
  }, [dismissed]);

  if (!mode || dismissed) return null;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const projectRef = supabaseUrl?.replace('https://', '').replace('.supabase.co', '') ?? '';
  const dashboardUrl = `https://supabase.com/dashboard/project/${projectRef}/sql/new`;

  function dismiss() {
    sessionStorage.setItem('setup_banner_dismissed', '1');
    setDismissed(true);
  }

  function copySQL() {
    navigator.clipboard.writeText(RLS_DISABLE_SQL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isRLS = mode === 'rls-blocked';

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl">
      <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/60 shadow-lg">
        {/* Header row */}
        <div className="flex items-start gap-3 p-4">
          {isRLS
            ? <ShieldOff className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            : <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          }
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {isRLS ? 'Database access blocked — RLS is enabled' : 'Database setup required'}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
              {isRLS
                ? 'Row Level Security is blocking the app. Run the SQL below in your Supabase SQL Editor to fix it.'
                : 'Tables not found. Run migration.sql in your Supabase SQL Editor to initialise the database.'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
              onClick={() => setExpanded(v => !v)}
              title={expanded ? 'Collapse' : 'Show steps'}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
              onClick={dismiss}
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="border-t border-amber-200 dark:border-amber-800 px-4 py-3 space-y-3">
            {isRLS ? (
              <>
                <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">
                  Quick fix — paste and run in the{' '}
                  <a href={dashboardUrl} target="_blank" rel="noopener noreferrer"
                    className="underline inline-flex items-center gap-0.5">
                    SQL Editor <ExternalLink className="h-3 w-3" />
                  </a>:
                </p>
                <div className="relative">
                  <pre className="rounded bg-amber-100 dark:bg-amber-900/60 p-3 text-[10px] font-mono text-amber-900 dark:text-amber-100 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto">
                    {RLS_DISABLE_SQL}
                  </pre>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2 h-6 w-6 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800"
                    onClick={copySQL}
                    title="Copy SQL"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </>
            ) : (
              <ol className="space-y-2 text-xs text-amber-800 dark:text-amber-200 list-decimal list-inside">
                <li>
                  Open the{' '}
                  <a href={dashboardUrl} target="_blank" rel="noopener noreferrer"
                    className="underline inline-flex items-center gap-0.5 font-medium">
                    Supabase SQL Editor <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  for project <span className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">{projectRef}</span>
                </li>
                <li>Copy the contents of <span className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">tasks/migration.sql</span> and paste it in</li>
                <li>Click <strong>Run</strong> — then refresh this page</li>
              </ol>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button size="sm"
                className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white border-0"
                onClick={() => window.open(dashboardUrl, '_blank')}>
                Open SQL Editor <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
              {isRLS && (
                <Button size="sm" variant="ghost"
                  className="h-7 text-xs text-amber-700 dark:text-amber-300 border border-amber-400/40"
                  onClick={copySQL}>
                  {copied ? <><Check className="h-3 w-3 mr-1" />Copied!</> : <><Copy className="h-3 w-3 mr-1" />Copy SQL</>}
                </Button>
              )}
              <Button size="sm" variant="ghost"
                className="h-7 text-xs text-amber-700 dark:text-amber-300"
                onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
