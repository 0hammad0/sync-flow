import { createParser, parseAsStringLiteral } from 'nuqs';
import { RANGE_KINDS, isIsoDay } from './range';

// nuqs parsers for the shared range params (client URL state). The server
// reads the same keys with range-schema.ts.

/** `YYYY-MM-DD` kept as a string (no Date, so no time-zone shift). */
export const parseAsIsoDay = createParser<string>({
  parse: (value) => (isIsoDay(value) ? value : null),
  serialize: (value) => value,
});

export const rangeParsers = {
  range: parseAsStringLiteral(RANGE_KINDS),
  from: parseAsIsoDay,
  to: parseAsIsoDay,
};
