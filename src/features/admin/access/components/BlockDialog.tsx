'use client';

import { useId, useMemo, useState } from 'react';
import ActionError from '@/shared/components/ActionError';
import { blockedError } from '@/shared/lib/blocked';
import {
  BLOCK_DURATIONS,
  BLOCK_TYPE_LABELS,
  BLOCK_TYPES,
  blockExpiry,
  blockWarnings,
  countryName,
  DEFAULT_BLOCK_DURATION,
  needsStepUp,
  normaliseBlockValue,
  selfBlockStop,
  type BlockDuration,
  type BlockType,
} from '@/shared/lib/block-values';
import AdminButton from '@/shared/ui/AdminButton';
import Checkbox from '@/shared/ui/Checkbox';
import Dialog from '@/shared/ui/Dialog';
import Input from '@/shared/ui/Input';
import SegmentedControl from '@/shared/ui/SegmentedControl';
import { blockSubject } from '../actions';
import { formatUtc } from '../format';
import type { AccessActorDto, BlockRowDto } from '../types';

const DURATION_LABELS: Record<BlockDuration, string> = { '1h': '1 h', '24h': '24 h', '7d': '7 d', '30d': '30 d', never: 'Never' };
const SUBMIT_LABELS: Record<BlockType, string> = {
  ip: 'Block IP',
  cidr: 'Block range',
  country: 'Block country',
  uid: 'Block user',
  device: 'Block device',
};
const PLACEHOLDERS: Record<BlockType, string> = {
  ip: '203.0.113.7',
  cidr: '203.0.113.0/24',
  country: 'PK',
  uid: 'User id or email',
  device: '32 hex characters',
};

let countryOptions: { code: string; name: string }[] | null = null;
/** ISO alpha-2 codes the browser can name. Built once, on first open of a country block. */
function countries() {
  if (countryOptions) return countryOptions;
  const list: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = countryName(code);
      if (name) list.push({ code, name });
    }
  }
  countryOptions = list.sort((x, y) => x.name.localeCompare(y.name));
  return countryOptions;
}

type BlockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actor: AccessActorDto;
  onCreated: (row: BlockRowDto) => void;
};

/** "New block". Validates and warns as the admin types; the server checks everything again. */
export default function BlockDialog({ open, onOpenChange, actor, onCreated }: BlockDialogProps) {
  const ids = useId();
  const [type, setType] = useState<BlockType>('ip');
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<BlockDuration>(DEFAULT_BLOCK_DURATION);
  // The "Ends …" preview is from when the length was last picked.
  const [pickedAt, setPickedAt] = useState(() => Date.now());
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const normalised = useMemo(() => normaliseBlockValue(type, value), [type, value]);
  const cleanValue = normalised.ok ? normalised.value : null;
  // uid values may be an email: the server resolves it, so only the uid itself is checked here.
  const stop = cleanValue ? selfBlockStop(type, cleanValue, actor) : null;
  const warnings = cleanValue ? blockWarnings(type, cleanValue) : [];
  const stepUp = cleanValue ? needsStepUp(type, cleanValue) : false;
  const endsAt = blockExpiry(duration, pickedAt);

  const valueError =
    serverFields.value?.[0] ?? (touched && value.trim() && !normalised.ok ? normalised.message : undefined);
  const normalisedNote =
    touched && cleanValue && cleanValue !== value.trim() && type !== 'uid' ? `Normalised to ${cleanValue}` : undefined;

  const resetFeedback = () => {
    setServerFields({});
    setFormError(null);
  };

  const submit = async () => {
    setTouched(true);
    resetFeedback();
    if (!cleanValue || stop) return;
    setPending(true);
    try {
      const result = await blockSubject({ type, value, reason, duration, acknowledged, confirm: stepUp ? confirm : undefined });
      if (result.ok) {
        onCreated(result.data);
        onOpenChange(false);
        return;
      }
      if (result.error === 'blocked') setFormError(blockedError(result));
      else if (result.error === 'invalid') setServerFields(result.fields ?? {});
      else if (result.error === 'step_up_required') {
        setFormError('Sign in again to do this. Country and wide-range blocks need a sign-in from the last 15 minutes.');
      } else if (result.error === 'forbidden') setFormError('Your role cannot create blocks.');
      else setFormError(`Could not save the block.${result.errorId ? ` Error id ${result.errorId}.` : ''}`);
    } catch (error) {
      setFormError(blockedError(error) ?? 'Could not save the block. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  const canSubmit = Boolean(cleanValue) && !stop && reason.trim().length >= 3 && (warnings.length === 0 || acknowledged) && (!stepUp || confirm.trim().toUpperCase() === cleanValue?.toUpperCase());

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New block"
      description="Blocked visitors can't upload, send or download within 60 s. Pages still open."
      footer={
        <>
          <AdminButton onClick={() => onOpenChange(false)}>Cancel</AdminButton>
          <AdminButton
            variant="danger-solid"
            type="submit"
            form={`${ids}-form`}
            disabled={!canSubmit}
            loading={pending}
            loadingText="Saving…"
          >
            {SUBMIT_LABELS[type]}
          </AdminButton>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Type</span>
          <SegmentedControl
            label="Block type"
            value={type}
            onValueChange={(next) => {
              setType(next);
              setTouched(false);
              setAcknowledged(false);
              setConfirm('');
              resetFeedback();
            }}
            items={BLOCK_TYPES.map((t) => ({ value: t, label: BLOCK_TYPE_LABELS[t] }))}
            className="flex-wrap"
          />
        </div>

        <Input
          label="Value"
          value={value}
          placeholder={PLACEHOLDERS[type]}
          autoComplete="off"
          spellCheck={false}
          list={type === 'country' ? `${ids}-countries` : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setServerFields((f) => ({ ...f, value: undefined }));
          }}
          onBlur={() => {
            setTouched(true);
            if (cleanValue && type !== 'uid') setValue(cleanValue);
          }}
          error={valueError}
          hint={
            normalisedNote ??
            (type === 'country' && cleanValue ? `${cleanValue} ${countryName(cleanValue) ?? ''}`.trim() : undefined)
          }
        />
        {type === 'country' && (
          <datalist id={`${ids}-countries`}>
            {countries().map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </datalist>
        )}

        {stop && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-text">
            {stop}
          </p>
        )}

        {warnings.length > 0 && !stop && (
          <div role="status" className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
            {warnings.map((w) => (
              <p key={w.code} className="text-sm text-warning-text">
                ⚠ {w.message}
              </p>
            ))}
            <Checkbox label="I understand" checked={acknowledged} onCheckedChange={setAcknowledged} />
            {serverFields.acknowledged?.[0] && <p className="text-xs text-danger-text">{serverFields.acknowledged[0]}</p>}
          </div>
        )}

        <Input
          label="Reason"
          value={reason}
          maxLength={200}
          placeholder="Spam uploads"
          onChange={(event) => {
            setReason(event.target.value);
            setServerFields((f) => ({ ...f, reason: undefined }));
          }}
          error={serverFields.reason?.[0]}
          hint="Required. Only admins see it."
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Ends</span>
          <SegmentedControl
            label="Block ends"
            value={duration}
            onValueChange={(next) => {
              setDuration(next);
              setPickedAt(Date.now());
            }}
            items={BLOCK_DURATIONS.map((d) => ({ value: d, label: DURATION_LABELS[d] }))}
            className="flex-wrap"
          />
          <p className="text-xs text-fg-muted">{endsAt ? `Ends ${formatUtc(endsAt)}` : 'Never ends. Unblock it by hand.'}</p>
        </div>

        {stepUp && cleanValue && !stop && (
          <Input
            label={`Type ${cleanValue} to confirm`}
            value={confirm}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setConfirm(event.target.value)}
            error={serverFields.confirm?.[0]}
            hint="Country and wide-range blocks affect many people."
          />
        )}

        {formError && (
          <p role="alert" className="text-sm text-danger-text">
            <ActionError text={formError} />
          </p>
        )}
      </form>
    </Dialog>
  );
}
