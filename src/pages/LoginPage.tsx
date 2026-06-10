import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Ship, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA step state
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const mfaInputRef = useRef<HTMLInputElement>(null);

  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname || '/';

  // Fire a silent warm-up ping as soon as the login page mounts.
  // Supabase free-tier suspends the DB after ~5 min idle; this cold-start
  // can add 5-15 s to the first signInWithPassword call. By hitting the DB
  // now (while the user is still typing), it's warm before Sign In is clicked.
  useEffect(() => {
    const warmup = async () => {
      try { await supabase.from('app_settings').select('key').limit(1).maybeSingle(); }
      catch { /* silent — warm-up only */ }
    };
    warmup();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.mfaRequired && result.factorId) {
      // Password correct — now need TOTP code
      setMfaFactorId(result.factorId);
      setMfaStep(true);
      setMfaCode('');
      setTimeout(() => mfaInputRef.current?.focus(), 100);
      return;
    }

    // No MFA enrolled — login complete
    const isClerk = result.user?.role === 'Clerk';
    navigate(isClerk ? '/containers' : from, { replace: true });
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaCode.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setError('');
    setMfaLoading(true);
    const result = await verifyMfa(mfaFactorId, mfaCode);
    setMfaLoading(false);

    if (result.error) {
      setError(result.error);
      setMfaCode('');
      mfaInputRef.current?.focus();
      return;
    }

    const isClerk = result.user?.role === 'Clerk';
    navigate(isClerk ? '/containers' : from, { replace: true });
  };

  const handleBackToPassword = () => {
    setMfaStep(false);
    setMfaCode('');
    setError('');
  };

  // ── MFA step ─────────────────────────────────────────────────────────────
  if (mfaStep) {
    return (
      <div className="flex flex-1 min-h-[calc(100dvh-3.5rem)] lg:min-h-[calc(100dvh)] items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center space-y-2">
            <div className="flex items-center justify-center h-14 w-14 bg-primary/10">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Two-Factor Authentication</h1>
            <p className="text-sm text-muted-foreground text-center text-balance">
              Enter the 6-digit code from your authenticator app
            </p>
          </div>

          <form onSubmit={handleMfaSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mfaCode">Verification Code</Label>
              <Input
                id="mfaCode"
                ref={mfaInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                required
                className="bg-card border-border h-10 text-center tracking-[0.5em] text-lg font-mono"
                autoComplete="one-time-code"
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 text-center">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full h-10" disabled={mfaLoading || mfaCode.length !== 6}>
              {mfaLoading ? 'Verifying...' : 'Verify'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full h-9 text-muted-foreground gap-2"
              onClick={handleBackToPassword}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ── Password step ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-[calc(100dvh-3.5rem)] lg:min-h-[calc(100dvh)] items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <div className="flex items-center justify-center h-14 w-14 bg-primary/10">
            <Ship className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Destuffing System</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              className="bg-card border-border h-10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                className="bg-card border-border h-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 text-center">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full h-10" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
