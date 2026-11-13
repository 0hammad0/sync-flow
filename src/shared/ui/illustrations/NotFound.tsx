import Illustration, { Dashed, Draw, DotGrid } from './Illustration';

/** 404: a path walks across the grid and stops at an empty dashed circle. */
export default function NotFound() {
  return (
    <Illustration>
      <DotGrid cols={7} rows={5} x0={20} y0={20} skip={(x, y) => y === 60 && (x === 100 || x === 120)} />
      <Draw d="M20 100h20V80h40V60h20" />
      <Dashed d="M100 60a10 10 0 1 0 20 0a10 10 0 1 0-20 0" />
    </Illustration>
  );
}
