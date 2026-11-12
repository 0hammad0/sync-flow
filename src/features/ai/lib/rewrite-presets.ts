// Composer rewrite presets. Shared by the UI (labels) and /api/ai (the
// instruction text): the client only ever sends a preset id, so nobody can
// inject their own instruction into the system prompt.

export const REWRITE_PRESETS = [
  { id: 'shorter', label: 'Shorter', instruction: 'Make it shorter and punchier' },
  { id: 'friendlier', label: 'Friendlier', instruction: 'Make it warmer and friendlier' },
  { id: 'professional', label: 'Professional', instruction: 'Make it polished and professional' },
  {
    id: 'grammar',
    label: 'Fix grammar',
    instruction: 'Fix grammar, spelling, and punctuation without changing the meaning or tone',
  },
  { id: 'english', label: '→ English', instruction: 'Translate it to English' },
] as const;

export type RewritePresetId = (typeof REWRITE_PRESETS)[number]['id'];

export function rewriteInstruction(id: unknown): string | null {
  return REWRITE_PRESETS.find((p) => p.id === id)?.instruction ?? null;
}
