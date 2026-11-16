import { z } from 'zod';

import { normalisePath } from './normalise-path';

/**
 * Wire format of a tracker flush to `/api/e`. Shared by client and server:
 * the tracker imports the types only (`import type`), the server parses with
 * these schemas and never trusts the client beyond them.
 *
 * Events are strict: an event with an unknown key is dropped, so nothing the
 * tracker did not mean to send (typed text, message content) can ride along.
 * Click events (`click`, `rage`, `dead`, phase 4) carry no free text but the
 * visible label of a button or link, capped at 40 characters.
 *
 * Spec: docs/admin/01-architecture/07-tracker.md ("Events"), 03-data-model.md.
 */

/** Hard caps, checked before parsing. */
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_EVENTS = 50;

const MAX_PAGE_MS = 60 * 60_000;
const MAX_VITAL_MS = 10 * 60_000;

/** Session id: 16 random bytes as 32 lower-case hex characters (per tab, `sessionStorage`). */
export const sessionIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

/** Page-view id inside one session; links `engage` events to their page. */
const pageViewId = z.string().regex(/^[a-z0-9]{1,16}$/);

/** Client clock, epoch ms. The server clamps it to its own clock. */
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const utmValue = z.string().trim().min(1).max(100).optional();

/** `path` is normalised on parse; an unknown or private path fails, so the event is dropped. */
const routePath = z
  .string()
  .max(2048)
  .transform((raw, ctx) => {
    const path = normalisePath(raw);
    if (path === null) {
      ctx.issues.push({ code: 'custom', message: 'Not a tracked page', input: raw });
      return z.NEVER;
    }
    return path;
  });

export const pageviewEventSchema = z.strictObject({
  type: z.literal('pageview'),
  t: timestamp,
  pv: pageViewId,
  path: routePath,
  /** Referrer host (or URL; the server keeps the host only). */
  ref: z.string().max(2048).nullable().optional(),
  utm_source: utmValue,
  utm_medium: utmValue,
  utm_campaign: utmValue,
  vw: z.number().int().min(0).max(20_000),
  vh: z.number().int().min(0).max(20_000),
});

export const engageEventSchema = z.strictObject({
  type: z.literal('engage'),
  t: timestamp,
  pv: pageViewId,
  /** Visible milliseconds on this page since the last send. */
  ms: z.number().int().min(0).max(MAX_PAGE_MS),
  /** Deepest scroll bucket reached on this page so far. */
  scroll: z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100)]),
});

const vitalMs = z.number().min(0).max(MAX_VITAL_MS).nullable().optional();

export const vitalsEventSchema = z.strictObject({
  type: z.literal('vitals'),
  t: timestamp,
  lcp: vitalMs,
  inp: vitalMs,
  cls: z.number().min(0).max(100).nullable().optional(),
});

/** Click caps (03-data-model.md "Click fields"). Longer = tampered: the event is dropped, never cut. */
export const MAX_CLICK_TARGET = 120;
export const MAX_CLICK_LABEL = 40;
/** Page coordinates in px; far beyond any real page. */
const MAX_PAGE_PX = 1_000_000;

/** Viewport width bucket at the click: `sm` < 640, `md` < 1024, `lg` ≥ 1024. */
export const VW_BUCKETS = ['sm', 'md', 'lg'] as const;
export type VwBucket = (typeof VW_BUCKETS)[number];

const clickFields = {
  t: timestamp,
  path: routePath,
  /** `data-track` id, else a short CSS selector. */
  target: z.string().trim().min(1).max(MAX_CLICK_TARGET),
  /** Visible text of the button or link; null inside inputs or `[data-private]`. Empty → null. */
  label: z
    .string()
    .max(MAX_CLICK_LABEL)
    .nullable()
    .optional()
    .transform((v) => v?.trim() || null),
  /** x as % of the page width (0–100). */
  x_pct: z.number().min(0).max(100),
  /** y in px from the top of the page. */
  y: z.number().int().min(0).max(MAX_PAGE_PX),
  /** Page height in px when measured. */
  doc_h: z.number().int().min(0).max(MAX_PAGE_PX),
  vw_bucket: z.enum(VW_BUCKETS),
};

export const clickEventSchema = z.strictObject({ type: z.literal('click'), ...clickFields });
/** ≥ 3 clicks within 600 ms within 30 px (tracker rule). */
export const rageEventSchema = z.strictObject({ type: z.literal('rage'), ...clickFields });
/** No DOM change or navigation within 1 s after a click (tracker rule). */
export const deadEventSchema = z.strictObject({ type: z.literal('dead'), ...clickFields });

export const trackerEventSchema = z.discriminatedUnion('type', [
  pageviewEventSchema,
  engageEventSchema,
  vitalsEventSchema,
  clickEventSchema,
  rageEventSchema,
  deadEventSchema,
]);

/**
 * One flush. `events` is checked item by item (see `parseBeacon`), so one bad
 * event never drops the whole batch.
 */
export const beaconEnvelopeSchema = z.object({
  sid: sessionIdSchema,
  /** Flush number in this session, from 0. `0` = a new session. */
  seq: z.number().int().min(0).max(100_000),
  /** `true` on `pagehide`: the last flush of this session. */
  final: z.boolean().optional().default(false),
  /** The chat device id (localStorage), if any. Hashed on the server, for device blocks. */
  did: z.string().min(1).max(128).optional(),
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS),
});

export type PageviewEvent = z.infer<typeof pageviewEventSchema>;
export type EngageEvent = z.infer<typeof engageEventSchema>;
export type VitalsEvent = z.infer<typeof vitalsEventSchema>;
/** `click`, `rage` or `dead`: same fields, the type says which. */
export type ClickEvent = z.infer<typeof clickEventSchema> | z.infer<typeof rageEventSchema> | z.infer<typeof deadEventSchema>;
export type TrackerEvent = z.infer<typeof trackerEventSchema>;
/** What the tracker sends (before server-side normalisation). */
export type TrackerEventInput = z.input<typeof trackerEventSchema>;
export type BeaconInput = Omit<z.input<typeof beaconEnvelopeSchema>, 'events'> & { events: TrackerEventInput[] };

/** A parsed flush: valid events only, with the count of dropped ones. */
export type Beacon = {
  sid: string;
  seq: number;
  final: boolean;
  did: string | null;
  events: TrackerEvent[];
  /** Events dropped by the schema (bad shape, unknown key, private path, oversize string). */
  invalid: number;
};

/**
 * Parses a flush. Returns `null` when the envelope itself is unusable
 * (not JSON-shaped, bad session id, no events, more than MAX_EVENTS);
 * otherwise keeps the valid events and counts the rest.
 */
export function parseBeacon(json: unknown): Beacon | null {
  const envelope = beaconEnvelopeSchema.safeParse(json);
  if (!envelope.success) return null;
  const events: TrackerEvent[] = [];
  let invalid = 0;
  for (const raw of envelope.data.events) {
    const parsed = trackerEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
    else invalid += 1;
  }
  return {
    sid: envelope.data.sid,
    seq: envelope.data.seq,
    final: envelope.data.final,
    did: envelope.data.did ?? null,
    events,
    invalid,
  };
}
