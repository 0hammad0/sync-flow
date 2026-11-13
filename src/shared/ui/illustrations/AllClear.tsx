import Illustration, { Draw } from './Illustration';

/** Health ok: a flat baseline with 5 even ticks, and a brand ring at the right end. */
export default function AllClear() {
  return (
    <Illustration>
      <Draw d="M20 72h96M28 72v-6M46 72v-6M64 72v-6M82 72v-6M100 72v-6" />
      <Draw d="M124 72a8 8 0 1 0 16 0a8 8 0 1 0-16 0" delay={2} accent />
    </Illustration>
  );
}
