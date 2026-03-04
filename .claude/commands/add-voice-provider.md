Create a new voice provider implementation for $ARGUMENTS.

Steps:
1. Determine provider type: STT (speech-to-text) or TTS (text-to-speech)
2. For STT: create `packages/voice/src/stt/$ARGUMENTS.ts` implementing `ISTTProvider`
   - Must implement: `transcribe(audio: Buffer): Promise<TranscriptionResult>`
3. For TTS: create `packages/voice/src/tts/$ARGUMENTS.ts` implementing `ITTSProvider`
   - Must implement: `synthesize(text: string, voiceId: string, options?: TTSOptions): Promise<Buffer>` (returns audio as a Buffer)
4. Export from `packages/voice/src/index.ts`
5. Add factory entry in `apps/desktop/electron/orchestrator.ts`:
   - STT: add a key to the `sttFactories` inline class-property record
   - TTS: add a key to the `ttsFactories` inline class-property record
6. Add catalog entries to `apps/desktop/src/constants/provider-catalog.ts`:
   - STT: add to `STT_MODELS` record
   - TTS: add to `TTS_VOICES` record
   - Add to `VOICE_PROVIDERS` if it's a new provider organization
7. Run `yarn typecheck && yarn build` to verify

Reference implementations:
- STT: `packages/voice/src/stt/whisper.ts`, `packages/voice/src/stt/elevenlabs.ts`
- TTS: `packages/voice/src/tts/elevenlabs.ts`, `packages/voice/src/tts/openai.ts`
