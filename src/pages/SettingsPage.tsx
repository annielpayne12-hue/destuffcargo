import { useState, useEffect } from 'react';
import { Settings, Clock, Save, Loader2, AlertTriangle, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const MIN_MINUTES = 5;
const MAX_MINUTES = 240;

export default function SettingsPage() {
  const { sessionTimeoutMinutes, refreshSessionTimeout } = useAuth();
  const [currentValue, setCurrentValue] = useState(sessionTimeoutMinutes);
  const [inputValue, setInputValue] = useState(String(sessionTimeoutMinutes));
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Shed area settings
  const [shed6Input, setShed6Input] = useState('');
  const [shed7Input, setShed7Input] = useState('');
  const [shedSaving, setShedSaving] = useState(false);
  const [shedLoaded, setShedLoaded] = useState(false);

  useEffect(() => {
    setCurrentValue(sessionTimeoutMinutes);
    setInputValue(String(sessionTimeoutMinutes));
    setHasChanges(false);
  }, [sessionTimeoutMinutes]);

  useEffect(() => {
    async function loadShedAreas() {
      const { data } = await supabase
        .from('app_settings')
        .select('key,value')
        .in('key', ['shed6_area_m2', 'shed7_area_m2']);
      if (Array.isArray(data)) {
        data.forEach((row) => {
          if (row.key === 'shed6_area_m2') setShed6Input(row.value === '0' ? '' : row.value);
          if (row.key === 'shed7_area_m2') setShed7Input(row.value === '0' ? '' : row.value);
        });
      }
      setShedLoaded(true);
    }
    loadShedAreas();
  }, []);

  function handleInputChange(value: string) {
    setInputValue(value);
    const num = parseInt(value, 10);
    setHasChanges(!isNaN(num) && num !== currentValue);
  }

  async function handleSave() {
    const minutes = parseInt(inputValue, 10);
    if (isNaN(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      toast.error(`Session timeout must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`);
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('app_settings')
      .update({ value: String(minutes), updated_at: new Date().toISOString() })
      .eq('key', 'session_timeout_minutes');
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`Session timeout updated to ${minutes} minutes.`);
    setCurrentValue(minutes);
    setHasChanges(false);
    await refreshSessionTimeout();
  }

  async function handleSaveShedAreas() {
    const s6 = parseFloat(shed6Input);
    const s7 = parseFloat(shed7Input);
    if (shed6Input && (isNaN(s6) || s6 < 0)) { toast.error('Shed 6 area must be a positive number.'); return; }
    if (shed7Input && (isNaN(s7) || s7 < 0)) { toast.error('Shed 7 area must be a positive number.'); return; }

    setShedSaving(true);
    const updates = [
      { key: 'shed6_area_m2', value: shed6Input.trim() || '0' },
      { key: 'shed7_area_m2', value: shed7Input.trim() || '0' },
    ];
    for (const u of updates) {
      const { error } = await supabase
        .from('app_settings')
        .update({ value: u.value, updated_at: new Date().toISOString() })
        .eq('key', u.key);
      if (error) { toast.error(error.message); setShedSaving(false); return; }
    }
    setShedSaving(false);
    toast.success('Shed storage areas saved.');
  }

  const minutes = parseInt(inputValue, 10);
  const isValid = !isNaN(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES;
  const totalShedArea = (parseFloat(shed6Input) || 0) + (parseFloat(shed7Input) || 0);

  return (
    <div className="flex flex-col min-h-full bg-background">
      <div className="border-b border-border px-4 md:px-8 py-4 md:py-6">
        <h1 className="text-lg md:text-xl font-semibold text-foreground text-balance flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          System Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure application-wide behaviour
        </p>
      </div>

      <div className="flex-1 px-4 md:px-8 py-6 md:py-8 max-w-2xl space-y-6">

        {/* Session timeout card */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Session Timeout</h2>
                <p className="text-xs text-muted-foreground text-pretty">
                  Idle time before a user is automatically signed out.
                </p>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0">
              {currentValue} min
            </Badge>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeoutInput">Timeout (minutes)</Label>
            <div className="flex items-center gap-3">
              <Input
                id="timeoutInput"
                type="number"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                className="bg-background border-border h-10 w-40"
              />
              <Button
                onClick={handleSave}
                disabled={!hasChanges || !isValid || saving}
                className="h-10 gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save
                  </>
                )}
              </Button>
            </div>
            {!isValid && inputValue !== '' && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Must be between {MIN_MINUTES} and {MAX_MINUTES} minutes.
              </p>
            )}
          </div>

          <div className="text-xs text-muted-foreground bg-muted rounded p-3 border border-border">
            <p className="font-medium mb-1">How it works</p>
            <p>
              The timer resets on every click, keystroke, scroll, or touch.
              When the timeout expires, the user is signed out automatically.
            </p>
          </div>
        </div>

        {/* Shed Area card */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0">
              <Warehouse className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Shed Storage Areas</h2>
              <p className="text-xs text-muted-foreground text-pretty">
                Used automatically in the Productivity Report for Shed Area calculations (m² / year).
              </p>
            </div>
          </div>

          {!shedLoaded ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="shed6">Shed 6 Area (m²)</Label>
                  <Input
                    id="shed6"
                    type="number"
                    min={0}
                    value={shed6Input}
                    onChange={(e) => setShed6Input(e.target.value)}
                    placeholder="e.g. 2500"
                    className="bg-background border-border h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shed7">Shed 7 Area (m²)</Label>
                  <Input
                    id="shed7"
                    type="number"
                    min={0}
                    value={shed7Input}
                    onChange={(e) => setShed7Input(e.target.value)}
                    placeholder="e.g. 2500"
                    className="bg-background border-border h-10"
                  />
                </div>
              </div>

              {totalShedArea > 0 && (
                <p className="text-xs text-muted-foreground">
                  Combined area: <span className="font-semibold text-foreground">{totalShedArea.toLocaleString()} m²</span>
                </p>
              )}

              <Button
                onClick={handleSaveShedAreas}
                disabled={shedSaving}
                className="h-10 gap-2"
              >
                {shedSaving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
                ) : (
                  <><Save className="h-4 w-4" />Save Shed Areas</>
                )}
              </Button>

              <div className="text-xs text-muted-foreground bg-muted rounded p-3 border border-border">
                <p className="font-medium mb-1">How it works</p>
                <p>
                  The Productivity Report automatically reads these values to calculate
                  Tonnes/m²/year, Containers/m²/year, and TEUs/m²/year. Set them once here
                  and the report always uses them.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
