import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { updateProfile } from '@/database';
import { validatePassword } from '@/lib/auth-errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserAvatar } from '@/components/ui/user-avatar';
import { FieldError, FormError } from '@/components/auth/AuthLayout';
import RoleBadge from '@/components/team/RoleBadge';

function timeZones(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : ['UTC'];
  return zones.includes(current) ? zones : [current, ...zones];
}

// the zones TBB's team and clients actually work in, offered first
const COMMON_ZONES = ['Asia/Dhaka', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney', 'UTC'];

const labelCache = new Map<string, string>();

/** "Asia/Dhaka (GMT+6)": the zone's current offset beside its name (computed once per zone). */
function zoneLabel(zone: string): string {
  const cached = labelCache.get(zone);
  if (cached) return cached;
  const label = computeZoneLabel(zone);
  labelCache.set(zone, label);
  return label;
}

function computeZoneLabel(zone: string): string {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return offset ? `${zone.replace(/_/g, ' ')} (${offset})` : zone;
  } catch {
    return zone;
  }
}

const Profile: React.FC = () => {
  const { profile, role, workspace, refresh, updatePassword } = useAuth();
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'UTC');
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwErrors, setPwErrors] = useState<{ password?: string | null; confirm?: string | null }>({});
  const [pwFormError, setPwFormError] = useState<string | null>(null);
  const [changingPw, setChangingPw] = useState(false);

  const zones = useMemo(() => timeZones(profile?.timezone ?? 'UTC'), [profile?.timezone]);

  useEffect(() => {
    document.title = 'Profile · TBB Workspace';
  }, []);

  useEffect(() => {
    setFullName(profile?.fullName ?? '');
    setPhone(profile?.phone ?? '');
    setTimezone(profile?.timezone ?? 'UTC');
  }, [profile]);

  if (!profile) return null;

  const onSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setNameError('Enter your name.');
      return;
    }
    setNameError(null);
    setProfileError(null);
    setSaving(true);
    try {
      // Only display fields: role, e-mail and active status are protected by the database.
      await updateProfile(profile.id, { fullName: fullName.trim(), phone: phone.trim() || null, timezone });
      await refresh();
      toast.success('Profile saved');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Your profile could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = {
      password: validatePassword(password),
      confirm: confirm === password ? null : 'Passwords do not match.',
    };
    setPwErrors(next);
    if (next.password || next.confirm) return;
    setChangingPw(true);
    setPwFormError(null);
    const result = await updatePassword(password);
    setChangingPw(false);
    if (!result.ok) {
      setPwFormError(result.message);
      return;
    }
    setPassword('');
    setConfirm('');
    toast.success('Password changed');
  };

  return (
    <div className="max-w-2xl space-y-6">
      <header className="flex items-center gap-4 pt-1">
        <UserAvatar name={profile.fullName} src={profile.avatarUrl ?? undefined} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate page-title">{profile.fullName}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{profile.email}</span>
            {role && <RoleBadge role={role} />}
            {workspace && <span>· {workspace.name}</span>}
          </div>
        </div>
      </header>

      <form onSubmit={onSaveProfile} noValidate className="space-y-4 surface-card p-4">
        <h2 className="section-label">Personal details</h2>
        <FormError message={profileError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="full-name" className="text-xs">
              Full name
            </Label>
            <Input
              id="full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'full-name-error' : undefined}
              className="h-9 text-sm"
            />
            <FieldError id="full-name-error" message={nameError} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs">
              Phone
            </Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timezone" className="text-xs">
              Time zone
            </Label>
            {/* Native select: ~600 options render instantly and are keyboard-searchable. */}
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="focus-soft h-10 w-full rounded-control border border-input bg-background px-3 text-sm outline-none transition-shadow"
            >
              <optgroup label="Common">
                {COMMON_ZONES.map((z) => (
                  <option key={`c-${z}`} value={z}>
                    {zoneLabel(z)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All time zones">
                {zones
                  .filter((z) => !COMMON_ZONES.includes(z))
                  .map((z) => (
                    <option key={z} value={z}>
                      {zoneLabel(z)}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Your e-mail address and role are managed by TBB administrators.
        </p>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </form>

      <form onSubmit={onChangePassword} noValidate className="space-y-4 surface-card p-4">
        <h2 className="section-label">Change password</h2>
        <FormError message={pwFormError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs">
              New password
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!pwErrors.password}
              aria-describedby="new-password-error"
              className="h-9 text-sm"
            />
            <FieldError id="new-password-error" message={pwErrors.password} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="text-xs">
              Confirm new password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={!!pwErrors.confirm}
              aria-describedby="confirm-password-error"
              className="h-9 text-sm"
            />
            <FieldError id="confirm-password-error" message={pwErrors.confirm} />
          </div>
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={changingPw}>
          {changingPw && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Update password
        </Button>
      </form>
    </div>
  );
};

export default Profile;
