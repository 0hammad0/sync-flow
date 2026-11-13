import Illustration, { Dashed, Draw } from './Illustration';

/** Offline: two nodes joined by a line; the middle third is dashed and has a gap. */
export default function Offline() {
  return (
    <Illustration>
      <Draw d="M24 60a8 8 0 1 0 16 0a8 8 0 1 0-16 0M40 60h24" />
      <Draw d="M136 60a8 8 0 1 1-16 0a8 8 0 1 1 16 0M120 60H96" delay={1} />
      <Dashed d="M64 60h8M88 60h8" />
    </Illustration>
  );
}
