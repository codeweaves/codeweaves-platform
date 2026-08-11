-- Masked-display support for the PII vault: store the last 4 significant chars
-- so the dashboard can show "****9012" without decrypting the full value.
-- Nullable + additive; existing rows keep NULL until re-tokenised.
ALTER TABLE "pii_tokens" ADD COLUMN "last4" TEXT;
