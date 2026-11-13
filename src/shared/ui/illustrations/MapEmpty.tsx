import Illustration, { Dot, Draw } from './Illustration';

/** No locations: a faint graticule (3 latitude lines, 4 longitude arcs), one brand dot, no countries. */
export default function MapEmpty() {
  return (
    <Illustration>
      <Draw d="M28 38q52-10 104 0M18 60h124M28 82q52 10 104 0" />
      <Draw d="M48 24q-26 36 0 72M68 20q-12 40 0 80M92 20q12 40 0 80M112 24q26 36 0 72" delay={1} />
      <Dot cx={100} cy={48} />
    </Illustration>
  );
}
