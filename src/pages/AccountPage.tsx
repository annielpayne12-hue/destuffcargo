import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldOff, ScanLine, Copy, CheckCircle2, AlertTriangle, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useAuth, type MfaFactor } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── Step indicator ──────────────────────────────────────────────────────────
function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold border-2 transition-colors
      ${done ? 'bg-primary border-primary text-primary-foreground'
        : active ? 'border-primary text-primary bg-primary/10'
        : 'border-border text-muted-foreground bg-background'}`}>
      {done ? <CheckCircle2 className="h-4 w-4" /> : n}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function AccountPage() {
  const { user, requiresMfaSetup, listMfaFactors, enrollMfa, verifyMfaEnrollment, unenrollMfa, disableMfa, refreshMfaStatus } = useAuth();

  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loadingFactors, setLoadingFactors] = useState(true);

  // Enroll dialog state
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollStep, setEnrollStep] = useState<1 | 2>(1);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [pendingFactorId, setPendingFactorId] = useState('');
  const [enrollCode, setEnrollCode] = useState('');
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollError, setEnrollError] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Disable dialog state
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableFactor, setDisableFactor] = useState<MfaFactor | null>(null);
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState('');

  async function loadFactors() {
    setLoadingFactors(true);
    const list = await listMfaFactors();
    setFactors(list);
    setLoadingFactors(false);
  }

  useEffect(() => {
    loadFactors();
  }, []);

  const verifiedFactor = factors.find((f) => f.status === 'verified');
  const has2fa = !!verifiedFactor;

  // ── Enroll flow ─────────────────────────────────────────────────────────
  async function handleOpenEnroll() {
    setEnrollStep(1);
    setEnrollCode('');
    setEnrollError('');
    setEnrollLoading(true);
    setEnrollOpen(true);

    // Clean up any unverified leftover factors first
    const unverified = factors.filter((f) => f.status === 'unverified');
    for (const f of unverified) {
      await unenrollMfa(f.id);
    }

    const result = await enrollMfa();
    setEnrollLoading(false);
    if (result.error) {
      toast.error(result.error);
      setEnrollOpen(false);
      return;
    }
    setQrCode(result.qrCode);
    setSecret(result.secret);
    setPendingFactorId(result.factorId);
  }

  async function handleVerifyEnrollment() {
    if (enrollCode.length !== 6) {
      setEnrollError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setEnrollError('');
    setEnrollLoading(true);
    const result = await verifyMfaEnrollment(pendingFactorId, enrollCode);
    setEnrollLoading(false);
    if (result.error) {
      setEnrollError(result.error);
      return;
    }
    toast.success('Two-factor authentication enabled!');
    setEnrollOpen(false);
    loadFactors();
    await refreshMfaStatus();
  }

  function handleCopySecret() {
    navigator.clipboard.writeText(secret).then(() => {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    });
  }

  // ── Disable flow ────────────────────────────────────────────────────────
  function handleOpenDisable(factor: MfaFactor) {
    setDisableFactor(factor);
    setDisableCode('');
    setDisableError('');
    setDisableOpen(true);
  }

  async function handleDisable() {
    if (!disableFactor) return;
    if (disableCode.length !== 6) {
      setDisableError('Please enter your 6-digit authenticator code.');
      return;
    }
    setDisableLoading(true);
    setDisableError('');
    const result = await disableMfa(disableFactor.id, disableCode);
    setDisableLoading(false);
    if (result.error) {
      setDisableError(result.error);
      return;
    }
    toast.success('Two-factor authentication disabled.');
    setDisableOpen(false);
    setDisableFactor(null);
    setDisableCode('');
    loadFactors();
    await refreshMfaStatus();
  }

  return (
    <div className="flex flex-col min-h-full bg-background">
      <div className="border-b border-border px-4 md:px-8 py-4 md:py-6">
        <h1 className="text-lg md:text-xl font-semibold text-foreground text-balance">My Account</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your security settings
        </p>
      </div>

      <div className="flex-1 px-4 md:px-8 py-6 md:py-8 max-w-2xl space-y-6">

        {requiresMfaSetup && (
          <div className="bg-destructive/10 border border-destructive/25 rounded-lg p-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">
                Two-factor authentication is required for your role
              </p>
              <p className="text-xs text-destructive/80">
                Admin and Manager accounts must have 2FA enabled.
                Set it up below to unlock the rest of the application.
              </p>
            </div>
          </div>
        )}

        {/* Profile card */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Profile</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <span className="text-muted-foreground">Username</span>
            <span className="font-medium">{user?.username}</span>
            <span className="text-muted-foreground">Full Name</span>
            <span className="font-medium">{user?.full_name || '—'}</span>
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium">{user?.role}</span>
          </div>
        </div>

        {/* 2FA card */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                Two-Factor Authentication (2FA)
              </h2>
              <p className="text-xs text-muted-foreground text-pretty">
                Use an authenticator app (Google Authenticator, Authy, or similar)
                to generate a one-time code each time you sign in.
              </p>
            </div>
            {loadingFactors ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0 mt-0.5" />
            ) : (
              <Badge
                className={`shrink-0 ${has2fa
                  ? 'bg-[#2ecc71]/15 text-[#2ecc71] border-[#2ecc71]/30'
                  : 'bg-muted text-muted-foreground border-border'}`}
                variant="outline"
              >
                {has2fa ? 'Enabled' : 'Disabled'}
              </Badge>
            )}
          </div>

          {!loadingFactors && (
            has2fa ? (
              <div className="flex items-center gap-3 pt-1">
                <div className="flex items-center gap-2 flex-1 min-w-0 bg-[#2ecc71]/10 border border-[#2ecc71]/25 rounded px-3 py-2">
                  <ShieldCheck className="h-4 w-4 text-[#2ecc71] shrink-0" />
                  <span className="text-xs text-[#2ecc71] font-medium truncate">
                    Authenticator app active
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive h-9"
                  onClick={() => handleOpenDisable(verifiedFactor!)}
                >
                  <ShieldOff className="h-4 w-4 mr-1.5" />
                  Disable
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="w-full sm:w-auto h-9 gap-2"
                onClick={handleOpenEnroll}
              >
                <ShieldCheck className="h-4 w-4" />
                Enable Two-Factor Authentication
              </Button>
            )
          )}
        </div>
      </div>

      {/* ── Enroll Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={enrollOpen} onOpenChange={(open) => {
        if (!open && !enrollLoading) {
          // Clean up unverified factor if user cancels
          if (pendingFactorId && enrollStep === 1) {
            unenrollMfa(pendingFactorId);
          }
          setEnrollOpen(false);
        }
      }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-primary" />
              Set Up Two-Factor Authentication
            </DialogTitle>
            <DialogDescription>
              Scan the QR code with your authenticator app, then verify with a code.
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 py-1">
            <StepDot n={1} active={enrollStep === 1} done={enrollStep > 1} />
            <div className={`h-0.5 flex-1 rounded ${enrollStep > 1 ? 'bg-primary' : 'bg-border'}`} />
            <StepDot n={2} active={enrollStep === 2} done={false} />
          </div>

          {enrollLoading && enrollStep === 1 ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generating QR code…</p>
            </div>
          ) : enrollStep === 1 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Open your authenticator app and scan this QR code:
              </p>
              {/* QR code rendered from data URI returned by Supabase */}
              <div className="flex justify-center">
                <div className="bg-white p-3 rounded-lg border border-border inline-block">
                  <img
                    src={qrCode}
                    alt="2FA QR Code"
                    className="h-44 w-44 object-contain"
                    draggable={false}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Can't scan? Enter this secret key manually:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 bg-muted text-xs px-3 py-2 rounded font-mono truncate border border-border">
                    {secret}
                  </code>
                  <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleCopySecret}>
                    {copiedSecret ? <CheckCircle2 className="h-4 w-4 text-[#2ecc71]" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code shown in your authenticator app to confirm setup:
              </p>
              <div className="space-y-2">
                <Label htmlFor="enrollCode">Verification Code</Label>
                <Input
                  id="enrollCode"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="bg-background border-border h-10 text-center tracking-[0.5em] text-lg font-mono"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>
              {enrollError && (
                <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {enrollError}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {enrollStep === 1 ? (
              <>
                <Button variant="outline" onClick={() => {
                  if (pendingFactorId) unenrollMfa(pendingFactorId);
                  setEnrollOpen(false);
                }} disabled={enrollLoading}>
                  Cancel
                </Button>
                <Button
                  onClick={() => { setEnrollStep(2); setEnrollError(''); }}
                  disabled={enrollLoading || !qrCode}
                >
                  I've scanned it — Next
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setEnrollStep(1); setEnrollError(''); }} disabled={enrollLoading}>
                  Back
                </Button>
                <Button
                  onClick={handleVerifyEnrollment}
                  disabled={enrollLoading || enrollCode.length !== 6}
                >
                  {enrollLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verifying…</> : 'Verify & Enable'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Disable Confirmation ───────────────────────────────────────────── */}
      <AlertDialog open={disableOpen} onOpenChange={(open) => { if (!disableLoading) setDisableOpen(open); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Disable Two-Factor Authentication?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your account will be protected by password only. To confirm, enter
              the 6-digit code from your authenticator app.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 py-1">
            <Label htmlFor="disable-code" className="text-sm font-medium">
              Authenticator code
            </Label>
            <Input
              id="disable-code"
              value={disableCode}
              onChange={(e) => {
                setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setDisableError('');
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDisable(); }}
              inputMode="numeric"
              placeholder="000000"
              maxLength={6}
              className="h-10 text-center tracking-[0.4em] text-lg font-mono bg-background border-border"
              disabled={disableLoading}
              autoFocus
            />
            {disableError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />{disableError}
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={disableLoading}>Keep Enabled</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDisable}
              disabled={disableLoading || disableCode.length !== 6}
            >
              {disableLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Disabling…</> : 'Yes, Disable 2FA'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
