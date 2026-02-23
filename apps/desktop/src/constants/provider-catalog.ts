/**
 * Shared catalogs for STT models, TTS voices, AI agent models, and agent colors.
 * Single source of truth — imported by SettingsContainer, AgentConfigForm, OnboardingContainer.
 */

export type STTProvider = 'openai' | 'elevenlabs';
export type TTSProvider = 'openai' | 'elevenlabs';
export type VoiceSensitivity = 'low' | 'medium' | 'high';

export interface CatalogEntry {
  id: string;
  label: string;
}

export const STT_MODELS: Record<STTProvider, CatalogEntry[]> = {
  openai: [
    { id: 'whisper-1', label: 'Whisper v1' },
    { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
    { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe' },
  ],
  elevenlabs: [
    { id: 'scribe_v1', label: 'Scribe v1 (Recommended)' },
    { id: 'scribe_v1_experimental', label: 'Scribe v1 Experimental' },
  ],
};

export const TTS_VOICES: Record<TTSProvider, CatalogEntry[]> = {
  openai: [
    { id: 'alloy', label: 'Alloy' },
    { id: 'ash', label: 'Ash' },
    { id: 'ballad', label: 'Ballad' },
    { id: 'coral', label: 'Coral' },
    { id: 'echo', label: 'Echo' },
    { id: 'fable', label: 'Fable' },
    { id: 'nova', label: 'Nova' },
    { id: 'onyx', label: 'Onyx' },
    { id: 'sage', label: 'Sage' },
    { id: 'shimmer', label: 'Shimmer' },
  ],
  elevenlabs: [
    { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (Deep, Narration)' },
    { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella (Soft, Feminine)' },
    { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel (Authoritative, British)' },
    { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi (Strong, Feminine)' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli (Friendly, Young)' },
    { id: 'jsCqWAovK2LkecY7zXl4', label: 'Freya (Expressive, Nordic)' },
    { id: 'oWAxZDx7w5VEj9dCyTzz', label: 'Grace (Southern, Warm)' },
    { id: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum (Intense, Transatlantic)' },
    { id: 'IKne3meq5aSn9XLyUdCD', label: 'Charlie (Natural, Australian)' },
    { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte (Swedish, Seductive)' },
    { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (Calm, American)' },
    { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam (Raspy, American)' },
    { id: 'ThT5KcBeYPX3keUQqHPh', label: 'Dorothy (Pleasant, British)' },
    { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold (Crisp, American)' },
    { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni (Well-rounded)' },
  ],
};

export const AGENT_MODELS: CatalogEntry[] = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'o4-mini', label: 'OpenAI o4-mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
];

export const AGENT_COLORS = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ec4899', '#06b6d4',
];

export const VOICE_PROVIDERS: Array<{ id: TTSProvider; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
];
