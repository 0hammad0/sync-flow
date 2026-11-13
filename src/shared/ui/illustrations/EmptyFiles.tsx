import Illustration, { Dot, Draw } from './Illustration';

// Visible edges of a file sheet at (x, y) that sits behind the next one (offset 10, -10).
const back = (x: number, y: number) =>
  `M${x} ${y + 10}V${y}h32l12 12v44h-10M${x + 32} ${y}v12h12`;

/** First-use files: three file outlines stacked and offset, folded corners. Brand dot on the top one. */
export default function EmptyFiles() {
  return (
    <Illustration>
      <Draw d={back(68, 24)} />
      <Draw d={back(58, 34)} delay={1} />
      <Draw d="M48 44h32l12 12v44H48zM80 44v12h12" delay={2} />
      <Dot cx={70} cy={78} />
    </Illustration>
  );
}
