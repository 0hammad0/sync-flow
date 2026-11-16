'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Info } from 'lucide-react';
import type { ActionResult } from '@/server/errors';
import { rateLimitedNotice } from '@/features/admin/rate-limited';
import { blockedError } from '@/shared/lib/blocked';
import AdminButton from '@/shared/ui/AdminButton';
import Select from '@/shared/ui/Select';
import Switch from '@/shared/ui/Switch';
import { updateSettings } from '../actions';
import {
  CONSENT_LABELS,
  CONSENT_MODE_CHOICES,
  CONSENT_PREVIEW,
  IP_RETENTION,
  RAW_RETENTION,
  SETTINGS_MESSAGES,
  type ConsentModeChoice,
} from '../constants';
import type { SettingsDto, SettingsSavedDto, SettingsValues } from '../types';

async function toast(kind: 'success' | 'error', title: string) {
  const { toast: t } = await import('sonner');
  t[kind](title);
}

type Failure = Exclude<ActionResult<SettingsSavedDto>, { ok: true }>;

function pickValues(s: SettingsDto): SettingsValues {
  return {
    trackingEnabled: s.trackingEnabled,
    consentMode: s.consentMode,
    ipRetentionDays: s.ipRetentionDays,
    rawRetentionDays: s.rawRetentionDays,
  };
}

/** The listed options, plus the stored value if it was set outside this screen. */
function dayOptions(options: readonly number[], current: number) {
  const all = options.includes(current) ? [...options] : [...options, current].sort((a, b) => a - b);
  return all.map((d) => ({ value: String(d), label: `${d} ${d === 1 ? 'day' : 'days'}` }));
}

function failureText(result: Failure): string {
  const limited = rateLimitedNotice(result);
  if (limited) return limited;
  if (result.error === 'blocked') return blockedError(result) ?? "You can't do this right now.";
  if (result.message) return result.message;
  if (result.error === 'forbidden') return 'Only owners can change settings.';
  if (result.error === 'invalid') return Object.values(result.fields ?? {})[0]?.[0] ?? 'Check the form and try again.';
  return `Could not save. Try again.${result.errorId ? ` Error id ${result.errorId}.` : ''}`;
}

/**
 * Tracking + Retention in one form with one Save (15-settings.md
 * "Interactions"). No optimistic update: the Save button spins until the
 * server answers. The page keys this form by `updatedAt`, so a refresh after
 * a save (or a conflict reload) starts again from the stored values.
 */
export default function SettingsForm({ initial }: { initial: SettingsDto }) {
  const router = useRouter();
  const base = pickValues(initial);
  const [values, setValues] = useState<SettingsValues>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const consentId = useId();

  const dirty = (Object.keys(base) as (keyof SettingsValues)[]).some((k) => base[k] !== values[k]);
  const canSave = dirty || !initial.stored;
  const ipTooLong = values.ipRetentionDays > values.rawRetentionDays;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
  };

  const save = async () => {
    if (saving || ipTooLong) return;
    setSaving(true);
    setError(null);
    const result = await updateSettings({ ...values, expectedUpdatedAt: initial.updatedAt }).catch(
      (e: unknown): Failure => ({ ok: false, error: 'internal', message: blockedError(e) ?? 'Check your connection and try again.' }),
    );
    setSaving(false);
    if (result.ok) {
      void toast('success', 'Settings saved. They apply within 60 seconds.');
      router.refresh();
      return;
    }
    setError({ text: failureText(result), conflict: result.error === 'conflict' && result.message === SETTINGS_MESSAGES.conflict });
  };

  const trackingOffPending = base.trackingEnabled && !values.trackingEnabled;
  const ipShrinks = values.ipRetentionDays < base.ipRetentionDays;
  const rawShrinks = values.rawRetentionDays < base.rawRetentionDays;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-8"
    >
      {!initial.stored && (
        <p className="flex items-start gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          <Info aria-hidden="true" strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
          Using defaults. Save to store them.
        </p>
      )}

      <section id="tracking" aria-labelledby="tracking-heading" className="flex scroll-mt-20 flex-col gap-4">
        <h2 id="tracking-heading" className="text-[15px] font-semibold text-fg">
          Tracking
        </h2>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Switch
              className="flex-1"
              label="Record visits"
              description="New visits are recorded. Off stops the tracker within 60 s. Old data stays."
              checked={values.trackingEnabled}
              onCheckedChange={(v) => set('trackingEnabled', v)}
            />
            <span aria-hidden="true" className="w-6 text-xs text-fg-muted">
              {values.trackingEnabled ? 'On' : 'Off'}
            </span>
          </div>
          {trackingOffPending && (
            <p className="flex items-start gap-1.5 text-xs text-warning-text">
              <AlertTriangle aria-hidden="true" strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
              Tracking will stop within 60 seconds.
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-2" aria-describedby={`${consentId}-preview`}>
          <legend className="mb-1 text-sm font-medium text-fg">Consent banner</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {CONSENT_MODE_CHOICES.map((mode: ConsentModeChoice) => (
              <label key={mode} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-fg pointer-coarse:min-h-11">
                <input
                  type="radio"
                  name="consentMode"
                  value={mode}
                  checked={values.consentMode === mode}
                  onChange={() => set('consentMode', mode)}
                  className="size-4 accent-brand"
                />
                {CONSENT_LABELS[mode]}
              </label>
            ))}
          </div>
          <p id={`${consentId}-preview`} className="text-xs text-fg-muted">
            {CONSENT_PREVIEW[values.consentMode]} Visitors who already answered the region check get the change within a day.
            {values.consentMode === 'none' &&
              ' The privacy page says EU, EEA and UK visitors are asked first: update it before choosing None.'}
          </p>
        </fieldset>
      </section>

      <section id="retention" aria-labelledby="retention-heading" className="flex scroll-mt-20 flex-col gap-4">
        <h2 id="retention-heading" className="text-[15px] font-semibold text-fg">
          Retention
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Select
              label={`Full IP kept (${IP_RETENTION.min}–${IP_RETENTION.max} days)`}
              value={String(values.ipRetentionDays)}
              onValueChange={(v) => set('ipRetentionDays', Number(v))}
              options={dayOptions(IP_RETENTION.options, values.ipRetentionDays)}
              error={ipTooLong ? SETTINGS_MESSAGES.ipLongerThanRaw : undefined}
            />
            {ipShrinks && (
              <p className="text-xs text-warning-text">
                Full IPs older than {values.ipRetentionDays} days will be shortened tonight.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Select
              label={`Raw events kept (${RAW_RETENTION.min}–${RAW_RETENTION.max} days)`}
              value={String(values.rawRetentionDays)}
              onValueChange={(v) => set('rawRetentionDays', Number(v))}
              options={dayOptions(RAW_RETENTION.options, values.rawRetentionDays)}
            />
            {rawShrinks && (
              <p className="text-xs text-warning-text">
                Data older than {values.rawRetentionDays} days will be deleted tonight.
              </p>
            )}
          </div>
        </div>
        <p className="text-sm text-fg-muted">Audit log kept 2 years (fixed). Daily totals hold no IP or account and are kept.</p>
      </section>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-danger px-3 py-2 text-sm text-danger-text">
          <span className="flex-1">{error.text}</span>
          {error.conflict && (
            <AdminButton size="sm" onClick={() => router.refresh()}>
              Reload
            </AdminButton>
          )}
        </div>
      )}

      {canSave && (
        <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t border-edge bg-surface px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
          {dirty && (
            <AdminButton variant="ghost" onClick={() => setValues(base)} disabled={saving}>
              Discard
            </AdminButton>
          )}
          <AdminButton type="submit" variant="primary" loading={saving} loadingText="Saving…" disabled={ipTooLong}>
            Save
          </AdminButton>
        </div>
      )}
    </form>
  );
}
