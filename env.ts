export interface Env {
  PROVIDER?: 'openrouter' | 'lm-studio';
  OPENROUTER_BASE_URL?: string;
  MODEL_OVERRIDE?: string;
  OPENROUTER_API_KEY?: string;
  LM_STUDIO_BASE_URL?: string;
  LM_STUDIO_MODEL?: string;
}
