import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Container,
  PackageSearch,
  Users,
  LogOut,
  LogIn,
  Menu,
  Ship,
  ClipboardList,
  Lock,
  KeyRound,
  MapPin,
  UserCircle,
  Settings,
  Upload,
  FileText,
  ParkingSquare,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';

interface NavItem {
  name: string;
  path: string;
  icon: React.ElementType;
  manageOnly?: boolean;
  clerkVisible?: boolean;
  adminOnly?: boolean;
  clerkAndAdminOnly?: boolean; // hidden from Manager and Supervisor
  adminAndShippingAgentOnly?: boolean; // only Admin and Shipping Agent
  adminManagerSupervisorOnly?: boolean; // Admin, Manager, Supervisor only
}

const navItems: NavItem[] = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, clerkVisible: false },
  { name: 'Containers', path: '/containers', icon: Container },
  { name: 'Manifests', path: '/manifests', icon: BookOpen, clerkVisible: false },
  { name: 'Locations', path: '/locations', icon: MapPin, clerkAndAdminOnly: true },
  { name: 'Reports', path: '/reports', icon: PackageSearch, clerkVisible: false },
  { name: 'Documentation', path: '/documentation', icon: FileText, adminAndShippingAgentOnly: true },
  { name: 'Container Yard', path: '/container-yard', icon: ParkingSquare, adminManagerSupervisorOnly: true },
  { name: 'Import Data', path: '/import', icon: Upload, adminOnly: true },
  { name: 'User Management', path: '/users', icon: Users, manageOnly: true },
  { name: 'Audit Log', path: '/audit-log', icon: ClipboardList, adminOnly: true },
  { name: 'Settings', path: '/settings', icon: Settings, adminOnly: true },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, canManageContainers, isAdminOrManager, logout, isShippingAgent } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changing, setChanging] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleLogin = () => {
    navigate('/login');
    onNavigate?.();
  };

  async function handleChangePassword() {
    if (!newPw || !confirmPw) {
      toast.error('All fields are required');
      return;
    }
    if (newPw !== confirmPw) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPw.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(newPw)) {
      toast.error('Password must contain at least one uppercase letter');
      return;
    }
    if (!/[a-z]/.test(newPw)) {
      toast.error('Password must contain at least one lowercase letter');
      return;
    }
    if (!/[0-9]/.test(newPw)) {
      toast.error('Password must contain at least one number');
      return;
    }
    setChanging(true);
    const { error } = await supabase.auth.updateUser({
      password: newPw,
    });
    setChanging(false);
    if (error) {
      const msg = error.status === 422 || (error as any).code === 'same_password'
        ? 'New password must be different from your current password'
        : error.message;
      toast.error(msg);
      return;
    }
    toast.success('Password changed successfully');
    setChangePwOpen(false);
    setNewPw('');
    setConfirmPw('');
  }

  const visibleItems = navItems.filter((item) => {
    if (!user) return true;
    // Shipping Agent: Containers, Manifests, and Documentation
    if (isShippingAgent) {
      return item.path === '/containers' || item.path === '/manifests' || item.adminAndShippingAgentOnly === true;
    }
    if (item.adminAndShippingAgentOnly) return user.role === 'Admin';
    if (item.manageOnly && !canManageContainers) return false;
    if (item.clerkVisible === false && !canManageContainers) return false;
    if (item.adminOnly && !isAdminOrManager) return false;
    if (item.clerkAndAdminOnly && user.role !== 'Clerk' && user.role !== 'Admin') return false;
    if (item.adminManagerSupervisorOnly && !['Admin', 'Manager', 'Supervisor'].includes(user.role)) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground w-64">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <Ship className="h-6 w-6 text-primary shrink-0" />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold truncate">Destuffing System</h1>
          <p className="text-xs text-sidebar-foreground/60 truncate">Cargo Management</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.path;
          if (!user) {
            return (
              <button
                key={item.path}
                onClick={handleLogin}
                className={`flex items-center gap-3 px-3 py-3 text-sm font-medium transition-colors w-full text-left ${
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.name}</span>
                <Lock className="h-3 w-3 ml-auto opacity-50" />
              </button>
            );
          }
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-3 text-sm font-medium transition-colors ${
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-sidebar-border space-y-1">
        {user ? (
          <>
            <div className="mb-3 px-2">
              <p className="text-sm font-medium truncate">{user?.full_name || user?.username}</p>
              <p className="text-xs text-sidebar-foreground/60">{user?.role}</p>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => setChangePwOpen(true)}
            >
              <KeyRound className="h-5 w-5 shrink-0" />
              <span>Change Password</span>
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              asChild
            >
              <Link to="/account" onClick={onNavigate}>
                <UserCircle className="h-5 w-5 shrink-0" />
                <span>My Account</span>
              </Link>
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={handleLogout}
            >
              <LogOut className="h-5 w-5 shrink-0" />
              <span>Logout</span>
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={handleLogin}
          >
            <LogIn className="h-5 w-5 shrink-0" />
            <span>Sign In</span>
          </Button>
        )}

        {/* Change Password Dialog */}
        <Dialog open={changePwOpen} onOpenChange={setChangePwOpen}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
            <DialogHeader>
              <DialogTitle>Change Password</DialogTitle>
              <DialogDescription>Update your account password</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="newPw">New Password</Label>
                <Input
                  id="newPw"
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="bg-background border-border h-10"
                />
                {newPw && (
                  <div className="space-y-1 text-xs">
                    <div className={`flex items-center gap-1 ${newPw.length >= 8 ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                      <span>{newPw.length >= 8 ? '✓' : '○'}</span> At least 8 characters
                    </div>
                    <div className={`flex items-center gap-1 ${/[A-Z]/.test(newPw) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                      <span>{/[A-Z]/.test(newPw) ? '✓' : '○'}</span> One uppercase letter
                    </div>
                    <div className={`flex items-center gap-1 ${/[a-z]/.test(newPw) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                      <span>{/[a-z]/.test(newPw) ? '✓' : '○'}</span> One lowercase letter
                    </div>
                    <div className={`flex items-center gap-1 ${/[0-9]/.test(newPw) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                      <span>{/[0-9]/.test(newPw) ? '✓' : '○'}</span> One number
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPw">Confirm New Password</Label>
                <Input
                  id="confirmPw"
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="bg-background border-border h-10"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setChangePwOpen(false)}>Cancel</Button>
              <Button onClick={handleChangePassword} disabled={changing}>
                {changing ? 'Changing...' : 'Change Password'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 fixed inset-y-0 left-0 z-40">
        <Sidebar />
      </aside>

      {/* Mobile sidebar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-sidebar border-b border-sidebar-border">
        <div className="flex items-center px-4 h-14">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-sidebar-foreground">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64 bg-sidebar border-r-0">
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 ml-3 min-w-0">
            <Ship className="h-5 w-5 text-primary shrink-0" />
            <span className="text-sm font-semibold truncate">Destuffing System</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col lg:ml-64">
        <main className="flex-1 overflow-x-hidden pt-14 lg:pt-0">
          <div className="p-4 md:p-6 max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
