/**
 * Shared constants for the conversation-classifier queue. Kept in their own
 * file to avoid a circular import between
 *   - `conversation-classifier.module.ts` (registers the queue + repeatable job)
 *   - `conversation-classifier.processor.ts` (the `@Processor(...)` decorator)
 *
 * If the constants live in the module file, the processor's `@Processor`
 * decorator evaluates to `undefined` during the cyclic load, BullMQ throws
 * "Queue name must be provided" at boot.
 */
export const CLASSIFIER_QUEUE = 'conversation-classifier';
export const CLASSIFIER_JOB = 'run-batch';
