/**
 * Model ids are exact strings — never append a date suffix.
 *
 * The capability flags are not cosmetic: the API rejects requests that send a
 * parameter the model does not accept, so the executor must consult these
 * rather than sending the same body to every model.
 */
export interface ModelCapabilities {
  id: string;
  label: string;
  /**
   * Accepts `thinking: { type: "adaptive" }`. Models without it use the older
   * `budget_tokens` form, which this app does not send — it simply omits
   * `thinking` for them.
   */
  adaptiveThinking: boolean;
  /** Accepts `output_config.effort`. Sending it to a model without it is a 400. */
  effort: boolean;
}

export const MODELS: readonly ModelCapabilities[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", adaptiveThinking: true, effort: true },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", adaptiveThinking: true, effort: true },
  // Haiku 4.5 predates both adaptive thinking and effort; sending either errors.
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", adaptiveThinking: false, effort: false },
] as const;

export const DEFAULT_MODEL = "claude-opus-5";

export const MODEL_OPTIONS = MODELS.map((m) => ({ value: m.id, label: m.label }));

export function getModel(id: string): ModelCapabilities {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function isKnownModel(id: string): boolean {
  return MODELS.some((m) => m.id === id);
}
