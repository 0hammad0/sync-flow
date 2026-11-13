// Empty-state copy of the Geography table (06-states.md 6.1 / 6.2,
// 07-geography.md "States"). Pure, so the choice is tested.
import { placeCountryName, regionLabel, type GeoLevel, type GeoTarget } from './drill';

export type GeoEmpty = {
  title: string;
  body: string;
  /** Offer "Last 30 days": the range is shorter, so a longer one may have visits. */
  offerLongerRange: boolean;
  /** Picture: the map one at world level, the plain one below it. */
  illustration: 'map' | 'none';
};

/** Days below which a longer range is worth offering (the button picks 30). */
const LONGER_RANGE_DAYS = 30;

export function geoEmptyCopy(input: {
  level: GeoLevel;
  target: GeoTarget;
  rangeDays: number;
  /** Visitors of the drilled place at the level above (0 when it had none in this range). */
  parentVisitors: number;
}): GeoEmpty {
  const { level, target, rangeDays, parentVisitors } = input;
  const short = rangeDays < LONGER_RANGE_DAYS;

  if (level === 'country') {
    // New tracking or a short range: say what fills the screen, and how to see more.
    return short
      ? { title: 'No visits in this range', body: 'Places show here once people visit the site. Try a longer range.', offerLongerRange: true, illustration: 'map' }
      : { title: 'No locations yet', body: 'Locations come from visits. None in this range.', offerLongerRange: false, illustration: 'map' };
  }

  const country = placeCountryName(target.country ?? '');
  if (parentVisitors <= 0) {
    const place = level === 'city' && target.region ? `${regionLabel(target.region)}, ${country}` : country;
    return { title: `No visits from ${place} in this range`, body: short ? 'Try a longer range.' : 'Pick another range or place.', offerLongerRange: short, illustration: 'none' };
  }
  // Visits exist, but the location lookup did not name a region or city for them.
  return level === 'region'
    ? { title: 'No region data for this country', body: 'Visits from here came without a region.', offerLongerRange: false, illustration: 'none' }
    : { title: 'No city data for this region', body: 'Visits from here came without a city.', offerLongerRange: false, illustration: 'none' };
}
