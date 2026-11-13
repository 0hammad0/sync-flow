import Illustration, { Dot, Draw } from './Illustration';

/** Error: a line runs left to right, then breaks. One brand dot sits in the gap. */
export default function ErrorGeneric() {
  return (
    <Illustration>
      <Draw d="M20 76h22l14-24 16 18 12-10" />
      <Draw d="M104 56l12 10h24" delay={2} />
      <Dot cx={94} cy={58} />
    </Illustration>
  );
}
