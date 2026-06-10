import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, KeyRound, Users, Shield, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { validateUsername, validatePassword } from '@/lib/security';
import { TablePagination } from '@/components/common/TablePagination';
import type { Profile, UserRole } from '@/types/types';

const PAGE_SIZE = 20;

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'Clerk' as UserRole });
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [page, setPage] = useState(1);
  const { user } = useAuth();

  async function fetchUsers() {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id,username,full_name,role,created_at')
      .order('created_at', { ascending: false });
    setUsers(Array.isArray(data) ? (data as Profile[]) : []);
    setLoading(false);
  }

  useEffect(() => {
    const handle = (window.requestIdleCallback ?? setTimeout)(() => fetchUsers(), { timeout: 400 });
    return () => {
      if (typeof handle === 'number') clearTimeout(handle);
      else (window.cancelIdleCallback ?? clearTimeout)(handle);
    };
  }, []);

  function openAdd() {
    setEditingUser(null);
    setForm({ username: '', password: '', full_name: '', role: 'Clerk' });
    setDialogOpen(true);
  }

  function openEdit(u: Profile) {
    setEditingUser(u);
    setForm({ username: u.username, password: '', full_name: u.full_name || '', role: u.role });
    setDialogOpen(true);
  }

  function openReset(u: Profile) {
    setResetTarget(u);
    setResetPassword('');
    setResetDialogOpen(true);
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    const pwCheck = validatePassword(resetPassword);
    if (!pwCheck.valid) {
      toast.error(pwCheck.message);
      return;
    }
    setResetLoading(true);
    const { error } = await supabase.rpc('admin_reset_password', {
      target_user_id: resetTarget.id,
      new_password: resetPassword,
    });
    setResetLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Password reset for ${resetTarget.username}`);
    setResetDialogOpen(false);
    setResetTarget(null);
    setResetPassword('');
  }

  async function handleSave() {
    const usernameCheck = validateUsername(form.username);
    if (!usernameCheck.valid) {
      toast.error(usernameCheck.message);
      return;
    }

    if (!editingUser) {
      const pwCheck = validatePassword(form.password);
      if (!pwCheck.valid) {
        toast.error(pwCheck.message);
        return;
      }
    }

    if (editingUser) {
      const updates: any = {
        username: form.username.trim(),
        full_name: form.full_name.trim() || null,
        role: form.role,
      };
      const { error } = await supabase.from('profiles').update(updates).eq('id', editingUser.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success('User updated successfully');
    } else {
      // Create user via secure Edge Function (keeps service-role key server-side only)
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          username: form.username.trim(),
          password: form.password,
          full_name: form.full_name.trim() || null,
          role: form.role,
        },
      });
      if (error) {
        const msg = await error?.context?.text?.().catch(() => null);
        toast.error(msg || error.message || 'Failed to create user');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success('User created successfully');
    }
    setDialogOpen(false);
    fetchUsers();
  }

  async function handleDelete(userId: string) {
    if (!confirm('Delete this user?')) return;
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('User deleted');
    fetchUsers();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-xl">User Management</h1>
          <p className="text-sm text-muted-foreground">Manage system users and roles</p>
        </div>
        <Button onClick={openAdd} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      <div className="w-full max-w-full overflow-x-auto bg-card">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">User ID</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Username</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Full Name</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Role</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground uppercase text-xs whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-3 px-4"><div className="h-4 w-20 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-24 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-32 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-24 bg-muted rounded animate-pulse" /></td>
                    <td className="py-3 px-4"><div className="h-4 w-20 bg-muted rounded animate-pulse ml-auto" /></td>
                  </tr>
                ))
              : users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((u) => (
                  <tr key={u.id} className="border-b border-border hover:bg-accent/30">
                    <td className="py-3 px-4 whitespace-nowrap font-medium">{u.id.slice(0, 8)}...</td>
                    <td className="py-3 px-4 whitespace-nowrap">{u.username}</td>
                    <td className="py-3 px-4 whitespace-nowrap">{u.full_name || '-'}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Shield className={`h-4 w-4 ${u.role === 'Clerk' ? 'text-muted-foreground' : 'text-primary'}`} />
                        {u.role}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        {u.id !== user?.id && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openReset(u)} title="Reset Password">
                            <KeyRound className="h-4 w-4" />
                            <span className="sr-only">Reset Password</span>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)} title="Edit">
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(u.id)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
            }
            {users.length === 0 && !loading && (
              <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">No users found</td></tr>
            )}
          </tbody>
        </table>
        <TablePagination
          currentPage={page}
          totalPages={Math.ceil(users.length / PAGE_SIZE)}
          totalItems={users.length}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          className="px-4 pb-3"
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Add User'}</DialogTitle>
            <DialogDescription>{editingUser ? 'Update user details' : 'Create a new user account'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="uname">Username *</Label>
              <Input id="uname" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!editingUser} className="bg-background border-border h-10" />
            </div>
            {!editingUser && (
              <div className="space-y-2">
                <Label htmlFor="upass">Password *</Label>
                <Input id="upass" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="bg-background border-border h-10" />
                {form.password && (
                  <div className="space-y-1 text-xs">
                    <div className={`flex items-center gap-1 ${form.password.length >= 8 ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                      <span>{form.password.length >= 8 ? '✓' : '○'}</span> At least 8 characters
                    </div>
                    <div className={`flex items-center gap-1 ${/[A-Z]/.test(form.password) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                      <span>{/[A-Z]/.test(form.password) ? '✓' : '○'}</span> One uppercase letter
                    </div>
                    <div className={`flex items-center gap-1 ${/[a-z]/.test(form.password) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                      <span>{/[a-z]/.test(form.password) ? '✓' : '○'}</span> One lowercase letter
                    </div>
                    <div className={`flex items-center gap-1 ${/[0-9]/.test(form.password) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                      <span>{/[0-9]/.test(form.password) ? '✓' : '○'}</span> One number
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="ufull">Full Name</Label>
              <Input id="ufull" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="bg-background border-border h-10" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as UserRole })}>
                <SelectTrigger className="bg-background border-border h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Admin">Admin</SelectItem>
                  <SelectItem value="Manager">Manager</SelectItem>
                  <SelectItem value="Supervisor">Supervisor</SelectItem>
                  <SelectItem value="Clerk">Clerk</SelectItem>
                  <SelectItem value="Data Entry Clerk">Data Entry Clerk</SelectItem>
                  <SelectItem value="Shipping Agent">Shipping Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingUser ? 'Update' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Set a new password for this user</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Reset password for <strong>{resetTarget?.username}</strong>
            </p>
            <div className="space-y-2">
              <Label htmlFor="resetPass">New Password *</Label>
              <Input
                id="resetPass"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Enter new password"
                className="bg-background border-border h-10"
              />
              {resetPassword && (
                <div className="space-y-1 text-xs">
                  <div className={`flex items-center gap-1 ${resetPassword.length >= 8 ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                    <span>{resetPassword.length >= 8 ? '✓' : '○'}</span> At least 8 characters
                  </div>
                  <div className={`flex items-center gap-1 ${/[A-Z]/.test(resetPassword) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                    <span>{/[A-Z]/.test(resetPassword) ? '✓' : '○'}</span> One uppercase letter
                  </div>
                  <div className={`flex items-center gap-1 ${/[a-z]/.test(resetPassword) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                    <span>{/[a-z]/.test(resetPassword) ? '✓' : '○'}</span> One lowercase letter
                  </div>
                  <div className={`flex items-center gap-1 ${/[0-9]/.test(resetPassword) ? 'text-[#2ecc71]' : 'text-muted-foreground'}`}>
                    <span>{/[0-9]/.test(resetPassword) ? '✓' : '○'}</span> One number
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetLoading}>
              {resetLoading ? 'Resetting...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
