import Illustration, { Dashed, Draw, DotGrid } from './Illustration';

// Lens centre and radius. Grid dots under the lens are missing.
const CX = 90;
const CY = 56;
const R = 22;

/** No results: a dashed lens over a dot grid, with no dots inside it. */
export default function NoResults() {
  return (
    <Illustration>
      <DotGrid
        cols={7}
        rows={5}
        x0={20}
        y0={20}
        skip={(x, y) => (x - CX) ** 2 + (y - CY) ** 2 < (R + 4) ** 2}
      />
      <Dashed d={`M${CX - R} ${CY}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0`} />
      <Draw d="M106 72l14 14" />
    </Illustration>
  );
}
