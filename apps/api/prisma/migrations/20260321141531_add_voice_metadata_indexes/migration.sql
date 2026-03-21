-- Expression indexes for voice analytics JSONB queries (Story 10-14)
-- These indexes accelerate the WHERE clauses used in voice analytics aggregation queries.

-- Index for filtering voice messages by inputType
CREATE INDEX IF NOT EXISTS idx_chat_messages_voice_input_type
  ON chat_messages ((metadata->>'inputType'))
  WHERE metadata->>'inputType' = 'voice';

-- Index for TTS error counting on assistant messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_tts_error
  ON chat_messages ((metadata->>'ttsError'))
  WHERE metadata->>'ttsError' IS NOT NULL AND role = 'ASSISTANT';

-- Index for language distribution queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_detected_language
  ON chat_messages ((metadata->>'detectedLanguage'))
  WHERE metadata->>'inputType' = 'voice' AND metadata->>'detectedLanguage' IS NOT NULL;
