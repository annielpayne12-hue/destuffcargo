import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Package, Clock, CheckCircle2, Ship, AlertTriangle, Boxes, ArrowRight, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface Stats {
  scheduled: number;
  inProcess: number;
  completed: number;
  totalCargo: number;
  totalQuantity: number;
  damaged: number;
}

// Columns needed for the Recent Containers table — never select *
const CONTAINER_COLS = 'container_id,vessel_name,arrival_date,status';

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    scheduled: 0,
    inProcess: 0,
    completed: 0,
    totalCargo: 0,
    totalQuantity: 0,
    damaged: 0,
  });
  const [recentContainers, setRecentContainers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user, isClerk } = useAuth();

  useEffect(() => {
    async function fetchData() {
      const [statsResult, recentResult] = await Promise.all([
        supabase.rpc('get_dashboard_stats'),
        supabase.from('containers').select(CONTAINER_COLS).order('arrival_date', { ascending: false }).limit(5),
      ]);

      const s = (statsResult.data ?? {}) as Record<string, number>;
      setStats({
        scheduled:     s.scheduled      ?? 0,
        inProcess:     s.in_process     ?? 0,
        completed:     s.completed      ?? 0,
        totalCargo:    s.total_cargo    ?? 0,
        totalQuantity: s.total_quantity ?? 0,
        damaged:       s.damaged_cargo  ?? 0,
      });

      setRecentContainers(Array.isArray(recentResult.data) ? recentResult.data : []);
      setLoading(false);
    }

    // Initial fetch deferred so skeleton shows first
    const handle = (window.requestIdleCallback ?? setTimeout)(() => fetchData(), { timeout: 400 });
    // Poll every 30 s instead of using Realtime (Realtime is incompatible with sb_publishable_ keys)
    const poll = setInterval(fetchData, 30_000);

    return () => {
      if (typeof handle === 'number') clearTimeout(handle);
      else (window.cancelIdleCallback ?? clearTimeout)(handle);
      clearInterval(poll);
    };
  }, []);

  const STAT_CARDS = [
    { label: 'Scheduled',    icon: <Calendar className="h-4 w-4 text-[#3498db]" />,  value: stats.scheduled },
    { label: 'In Process',   icon: <Clock className="h-4 w-4 text-[#ff6b35]" />,     value: stats.inProcess },
    { label: 'Completed',    icon: <CheckCircle2 className="h-4 w-4 text-[#2ecc71]" />, value: stats.completed },
    { label: 'Cargo Items',  icon: <Boxes className="h-4 w-4 text-primary" />,        value: stats.totalCargo },
    { label: 'Total Qty',    icon: <Package className="h-4 w-4 text-primary" />,      value: stats.totalQuantity.toLocaleString() },
    { label: 'Damaged',      icon: <AlertTriangle className="h-4 w-4 text-[#f39c12]" />, value: stats.damaged },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold md:text-xl">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of destuffing operations</p>
      </div>

      {/* Stat cards — show skeleton placeholders while loading, real values after */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {STAT_CARDS.map(({ label, icon, value }) => (
          <Card key={label} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
              {icon}
            </CardHeader>
            <CardContent>
              {loading
                ? <div className="h-7 w-12 bg-muted rounded animate-pulse" />
                : <div className="text-xl font-bold">{value}</div>
              }
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      {!isClerk && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer" onClick={() => navigate('/containers')}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Container className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">View Containers</p>
                  <p className="text-xs text-muted-foreground">Manage containers and cargo</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
          <Card className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer" onClick={() => navigate('/reports')}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">View Reports</p>
                  <p className="text-xs text-muted-foreground">Summary, damage, and daily reports</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base">Recent Containers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full max-w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground whitespace-nowrap uppercase text-xs">Container ID</th>
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground whitespace-nowrap uppercase text-xs">Vessel</th>
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground whitespace-nowrap uppercase text-xs">Arrival</th>
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground whitespace-nowrap uppercase text-xs">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="py-3 px-2"><div className="h-4 w-28 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-2"><div className="h-4 w-32 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-2"><div className="h-4 w-20 bg-muted rounded animate-pulse" /></td>
                        <td className="py-3 px-2"><div className="h-4 w-16 bg-muted rounded animate-pulse" /></td>
                      </tr>
                    ))
                  : recentContainers.length > 0
                    ? recentContainers.map((c) => (
                        <tr key={c.container_id} className="border-b border-border last:border-0 hover:bg-accent/50">
                          <td className="py-3 px-2 whitespace-nowrap font-medium">{c.container_id}</td>
                          <td className="py-3 px-2 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Ship className="h-3 w-3 text-muted-foreground" />
                              {c.vessel_name}
                            </div>
                          </td>
                          <td className="py-3 px-2 whitespace-nowrap text-muted-foreground">{c.arrival_date}</td>
                          <td className="py-3 px-2 whitespace-nowrap">
                            <span className="status-badge" data-status={c.status}>{c.status}</span>
                          </td>
                        </tr>
                      ))
                    : (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-muted-foreground">No containers found</td>
                        </tr>
                      )
                }
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
