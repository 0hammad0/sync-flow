import Illustration, { Dot, DotGrid } from './Illustration';

/** First-use empty: a 6×4 dot grid, one brand dot in the middle. `waiting` makes it breathe. */
export default function NoDataYet({ waiting = false }: { waiting?: boolean }) {
  return (
    <Illustration>
      <DotGrid cols={6} rows={4} x0={30} y0={30} />
      <Dot cx={80} cy={60} breathe={waiting} />
    </Illustration>
  );
}
