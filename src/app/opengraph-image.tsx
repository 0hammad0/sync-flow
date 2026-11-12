import { OG_ALT, OG_SIZE, renderOgCard } from '@/features/landing/og-card';

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return renderOgCard();
}
