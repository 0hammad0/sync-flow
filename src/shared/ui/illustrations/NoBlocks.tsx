import Illustration, { Dot, Draw, DotGrid } from './Illustration';

/** No blocks: a row of dots passes freely between two short bars (an open gate). */
export default function NoBlocks() {
  return (
    <Illustration>
      <DotGrid cols={11} rows={1} x0={20} y0={60} step={12} skip={(x) => x === 80} />
      <Draw d="M74 44v32M86 44v32" />
      <Dot cx={80} cy={60} />
    </Illustration>
  );
}
