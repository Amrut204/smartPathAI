# Multi-Provider AI Failover

This project now supports server-side LLM failover with caching.

## Provider Priority

Default order:
1. `gemini`
2. `groq`
3. `openrouter`

Override with:
`AI_PROVIDER_ORDER=gemini,groq,openrouter`

## Environment Variables

Add to `.env`:

```env
GEMINI_API_KEY=...
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
AI_PROVIDER_ORDER=gemini,groq,openrouter
AI_TIMEOUT_MS=12000
AI_CACHE_TTL_SEC=21600
GROQ_MODEL=llama-3.3-70b-versatile
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct:free
```

## Behavior

- All AI calls are server-side.
- On `429`, `5xx`, timeout, or network error, service switches to next provider.
- On non-retryable provider errors (e.g., malformed request), request fails immediately.
- In non-production only, if all providers are unavailable, a local fallback answer is returned.
- Answers are cached using:
  - in-memory cache (L1)
  - Mongo collection `ai_response_cache` (L2, TTL)

## Main Files

- `server/src/services/ai/failover.service.ts`
- `server/src/services/ai/cache.service.ts`
- `server/src/services/ai/providers/gemini.provider.ts`
- `server/src/services/ai/providers/groq.provider.ts`
- `server/src/services/ai/providers/openrouter.provider.ts`
- `server/src/services/ai.service.ts`

## Notes

- System instruction enforces concise tutor responses and clarification for unclear prompts.
- Final answer is trimmed to keep response length low (token saving).
