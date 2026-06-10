import { useEffect, useState } from 'react';
import { ClipboardList, Search, Shield, LogIn, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { exportToExcel, exportToCSV, printTable } from '@/lib/export';
import { ExportMenu } from '@/components/common/ExportMenu';
import { TablePagination } from '@/components/common/TablePagination';
import type { AuditLogEntry, LoginAuditEntry } from '@/types/types';

type Tab = 'audit' | 'login';

const PAGE_SIZE = 50;
// Safety cap — never pull more than this many rows from the DB in one shot.
// At scale, use server-side pagination if you need to see older records.
const MAX_ROWS = 1000;

export default function AuditLogPage() {
  const [activeTab, setActiveTab] = useState<Tab>('audit');

  // ── Audit log state ───────────────────────────────────────────────────
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [filtered, setFiltered] = useState<AuditLogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [tableFilter, setTableFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [auditPage, setAuditPage] = useState(1);

  // ── Login history state ───────────────────────────────────────────────
  const [loginLogs, setLoginLogs] = useState<LoginAuditEntry[]>([]);
  const [filteredLogin, setFilteredLogin] = useState<LoginAuditEntry[]>([]);
  const [loginSearch, setLoginSearch] = useState('');
  const [loginFilter, setLoginFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginPage, setLoginPage] = useState(1);

  async function fetchLogs() {
    setLoading(true);
    const { data, error } = await supabase
      .from('audit_log')
      .select('id,table_name,record_id,action,old_data,new_data,user_id,performed_at')
      .order('performed_at', { ascending: false })
      .limit(MAX_ROWS);

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const rows = Array.isArray(data) ? (data as AuditLogEntry[]) : [];
    setLogs(rows);
    setFiltered(rows);
    setLoading(false);
  }

  async function fetchLoginLogs() {
    setLoginLoading(true);
    const { data, error } = await supabase
      .from('login_audit_log')
      .select('id,user_id,username,role,success,failure_reason,ip_address,user_agent,created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);

    if (error) {
      toast.error(error.message);
      setLoginLoading(false);
      return;
    }

    const rows = Array.isArray(data) ? (data as LoginAuditEntry[]) : [];
    setLoginLogs(rows);
    setFilteredLogin(rows);
    setLoginLoading(false);
  }

  useEffect(() => {
    const handle = (window.requestIdleCallback ?? setTimeout)(() => fetchLogs(), { timeout: 400 });
    return () => {
      if (typeof handle === 'number') clearTimeout(handle);
      else (window.cancelIdleCallback ?? clearTimeout)(handle);
    };
  }, []);
  useEffect(() => { if (activeTab === 'login' && loginLogs.length === 0) fetchLoginLogs(); }, [activeTab]);

  useEffect(() => {
    let result = logs;
    const s = search.toLowerCase().trim();
    if (s) {
      result = result.filter(
        (l) =>
          (l.record_id || '').toLowerCase().includes(s) ||
          (l.table_name || '').toLowerCase().includes(s) ||
          (l.user_id || '').toLowerCase().includes(s) ||
          JSON.stringify(l.old_data).toLowerCase().includes(s) ||
          JSON.stringify(l.new_data).toLowerCase().includes(s)
      );
    }
    if (tableFilter !== 'all') result = result.filter((l) => l.table_name === tableFilter);
    if (actionFilter !== 'all') result = result.filter((l) => l.action === actionFilter);
    setFiltered(result);
    setAuditPage(1);
  }, [search, tableFilter, actionFilter, logs]);

  useEffect(() => {
    let result = loginLogs;
    const s = loginSearch.toLowerCase().trim();
    if (s) {
      result = result.filter(
        (l) =>
          l.username.toLowerCase().includes(s) ||
          (l.role || '').toLowerCase().includes(s) ||
          (l.failure_reason || '').toLowerCase().includes(s)
      );
    }
    if (loginFilter === 'success') result = result.filter((l) => l.success);
    if (loginFilter === 'failed') result = result.filter((l) => !l.success);
    setFilteredLogin(result);
    setLoginPage(1);
  }, [loginSearch, loginFilter, loginLogs]);

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function actionColor(action: string) {
    switch (action) {
      case 'INSERT': return 'bg-[#2ecc71]/10 text-[#2ecc71]';
      case 'UPDATE': return 'bg-[#3498db]/10 text-[#3498db]';
      case 'DELETE': return 'bg-destructive/10 text-destructive';
      default: return 'bg-muted text-muted-foreground';
    }
  }

  // ── Export handlers ─────────────────────────────────────────────────────
  async function handleExcelExport() {
    if (activeTab === 'audit') {
      if (!filtered.length) { toast.error('No data to export'); return; }
      await exportToExcel(filtered.map((l) => ({
        'ID': l.id, 'Timestamp': l.performed_at, 'Table': l.table_name,
        'Action': l.action, 'Record ID': l.record_id || '',
        'User ID': l.user_id || '', 'Before': JSON.stringify(l.old_data),
        'After': JSON.stringify(l.new_data),
      })), 'Audit_Log');
    } else {
      if (!filteredLogin.length) { toast.error('No data to export'); return; }
      await exportToExcel(filteredLogin.map((l) => ({
        'Timestamp': l.created_at, 'Username': l.username,
        'Role': l.role || '', 'Result': l.success ? 'Success' : 'Failed',
        'Reason': l.failure_reason || '', 'Browser/Device': l.user_agent || '',
      })), 'Login_History');
    }
    toast.success('Exported to Excel');
  }

  function handleCsvExport() {
    if (activeTab === 'audit') {
      if (!filtered.length) { toast.error('No data to export'); return; }
      exportToCSV(filtered.map((l) => ({
        'ID': l.id, 'Timestamp': l.performed_at, 'Table': l.table_name,
        'Action': l.action, 'Record ID': l.record_id || '',
        'User ID': l.user_id || '', 'Before': JSON.stringify(l.old_data),
        'After': JSON.stringify(l.new_data),
      })), 'Audit_Log');
    } else {
      if (!filteredLogin.length) { toast.error('No data to export'); return; }
      exportToCSV(filteredLogin.map((l) => ({
        'Timestamp': l.created_at, 'Username': l.username,
        'Role': l.role || '', 'Result': l.success ? 'Success' : 'Failed',
        'Reason': l.failure_reason || '', 'Browser/Device': l.user_agent || '',
      })), 'Login_History');
    }
    toast.success('Exported to CSV');
  }

  function handlePrint() {
    if (activeTab === 'audit') {
      if (!filtered.length) { toast.error('No data to print'); return; }
      printTable(
        'Audit Log', `${filtered.length} record(s)`,
        ['ID', 'Timestamp', 'Table', 'Action', 'Record ID', 'User'],
        filtered.map((l) => [l.id, formatDate(l.performed_at), l.table_name, l.action, l.record_id, l.user_id?.slice(0, 8)]),
      );
    } else {
      if (!filteredLogin.length) { toast.error('No data to print'); return; }
      printTable(
        'Login History', `${filteredLogin.length} event(s)`,
        ['Timestamp', 'Username', 'Role', 'Result', 'Reason'],
        filteredLogin.map((l) => [formatDate(l.created_at), l.username, l.role, l.success ? 'Success' : 'Failed', l.failure_reason]),
      );
    }
  }

  const auditPageRows   = filtered.slice((auditPage - 1) * PAGE_SIZE, auditPage * PAGE_SIZE);
  const loginPageRows   = filteredLogin.slice((loginPage - 1) * PAGE_SIZE, loginPage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-xl">Audit Log</h1>
          <p className="text-sm text-muted-foreground">Track all changes and login activity</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Admin/Manager Only</span>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'audit'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          Data Changes
        </button>
        <button
          onClick={() => setActiveTab('login')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'login'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <LogIn className="h-4 w-4" />
          Login History
        </button>
      </div>

      {/* ── DATA CHANGES TAB ─────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by container ID, table, or data..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card border-border"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(['all', 'containers', 'cargo'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTableFilter(t)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    tableFilter === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'all' ? 'All Tables' : t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(['all', 'INSERT', 'UPDATE', 'DELETE'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setActionFilter(a)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    actionFilter === a
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {a === 'all' ? 'All Actions' : a}
                </button>
              ))}
            </div>
            <Button variant="outline" onClick={fetchLogs} className="shrink-0">Refresh</Button>
            <ExportMenu
              onExcelExport={handleExcelExport}
              onCsvExport={handleCsvExport}
              onPrint={handlePrint}
              disabled={loading}
            />
          </div>

          <div className="w-full max-w-full overflow-x-auto bg-card border border-border">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">ID</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Timestamp</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Table</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Action</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Record ID</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">User</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Before</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">After</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="py-3 px-4"><div className="h-4 w-8 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-32 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-20 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-5 w-16 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-16 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-20 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-28 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-28 bg-muted rounded animate-pulse" /></td>
                      </tr>
                    ))
                  : auditPageRows.map((log) => (
                      <tr key={log.id} className="border-b border-border hover:bg-accent/30">
                        <td className="py-3 px-4 whitespace-nowrap font-medium">{log.id}</td>
                        <td className="py-3 px-4 whitespace-nowrap">{formatDate(log.performed_at)}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <ClipboardList className="h-3 w-3 text-muted-foreground" />
                            {log.table_name}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColor(log.action)}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-mono text-xs">{log.record_id || '-'}</td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs text-muted-foreground">{log.user_id ? log.user_id.slice(0, 8) + '...' : 'system'}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {log.old_data ? (
                            <pre className="text-xs text-muted-foreground max-w-[200px] truncate font-mono">{JSON.stringify(log.old_data)}</pre>
                          ) : <span className="text-muted-foreground text-xs">-</span>}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {log.new_data ? (
                            <pre className="text-xs text-muted-foreground max-w-[200px] truncate font-mono">{JSON.stringify(log.new_data)}</pre>
                          ) : <span className="text-muted-foreground text-xs">-</span>}
                        </td>
                      </tr>
                    ))
                }
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">No audit records found</td>
                  </tr>
                )}
              </tbody>
            </table>
            <TablePagination
              currentPage={auditPage}
              totalPages={Math.ceil(filtered.length / PAGE_SIZE)}
              totalItems={filtered.length}
              pageSize={PAGE_SIZE}
              onPageChange={setAuditPage}
              className="px-4 pb-3"
            />
          </div>
        </>
      )}

      {/* ── LOGIN HISTORY TAB ─────────────────────────────────────────── */}
      {activeTab === 'login' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by username, role, or reason..."
                value={loginSearch}
                onChange={(e) => setLoginSearch(e.target.value)}
                className="pl-9 bg-card border-border"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(['all', 'success', 'failed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setLoginFilter(f)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    loginFilter === f
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <Button variant="outline" onClick={fetchLoginLogs} className="shrink-0">Refresh</Button>
            <ExportMenu
              onExcelExport={handleExcelExport}
              onCsvExport={handleCsvExport}
              onPrint={handlePrint}
              disabled={loginLoading}
            />
          </div>

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Attempts', value: loginLogs.length, cls: 'text-foreground' },
              { label: 'Successful', value: loginLogs.filter((l) => l.success).length, cls: 'text-green-600 dark:text-green-400' },
              { label: 'Failed', value: loginLogs.filter((l) => !l.success).length, cls: 'text-destructive' },
            ].map((s) => (
              <div key={s.label} className="bg-card border border-border rounded-lg p-4 text-center">
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="w-full max-w-full overflow-x-auto bg-card border border-border">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Timestamp</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Username</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Role</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Result</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Reason</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Browser / Device</th>
                </tr>
              </thead>
              <tbody>
                {loginLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="py-3 px-4"><div className="h-4 w-32 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-24 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-5 w-16 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-16 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-20 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-4"><div className="h-4 w-40 bg-muted rounded animate-pulse" /></td>
                      </tr>
                    ))
                  : loginPageRows.map((log) => (
                      <tr key={log.id} className="border-b border-border hover:bg-accent/30">
                        <td className="py-3 px-4 whitespace-nowrap text-sm">{formatDate(log.created_at)}</td>
                        <td className="py-3 px-4 whitespace-nowrap font-medium">{log.username}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {log.role ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                              {log.role}
                            </span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {log.success ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                              <XCircle className="h-3.5 w-3.5" /> Failed
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs text-muted-foreground">{log.failure_reason || '-'}</td>
                        <td className="py-3 px-4 whitespace-nowrap max-w-[240px] truncate text-xs text-muted-foreground" title={log.user_agent || ''}>
                          {log.user_agent || '-'}
                        </td>
                      </tr>
                    ))
                }
                {filteredLogin.length === 0 && !loginLoading && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">No login records found</td>
                  </tr>
                )}
              </tbody>
            </table>
            <TablePagination
              currentPage={loginPage}
              totalPages={Math.ceil(filteredLogin.length / PAGE_SIZE)}
              totalItems={filteredLogin.length}
              pageSize={PAGE_SIZE}
              onPageChange={setLoginPage}
              className="px-4 pb-3"
            />
          </div>
        </>
      )}
    </div>
  );
}
