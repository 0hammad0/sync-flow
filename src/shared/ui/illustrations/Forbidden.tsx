import Illustration, { Dot, Draw, DotGrid } from './Illustration';

/** 403: a brand dot inside a closed square frame on a dot grid. The frame has no opening. */
export default function Forbidden() {
  return (
    <Illustration>
      <DotGrid
        cols={7}
        rows={5}
        x0={20}
        y0={20}
        skip={(x, y) => x > 60 && x < 100 && y > 36 && y < 84}
      />
      <Draw d="M68 44h24a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H68a4 4 0 0 1-4-4V48a4 4 0 0 1 4-4z" />
      <Dot cx={80} cy={60} />
    </Illustration>
  );
}
