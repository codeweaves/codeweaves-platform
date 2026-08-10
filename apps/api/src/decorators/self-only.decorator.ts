import { SetMetadata } from '@nestjs/common';

export const SELF_ONLY_KEY = 'selfOnly';

/**
 * Marks a route as operating solely on the authenticated caller's own record,
 * resolved from `user.id` rather than from any request parameter.
 *
 * This is an authorization DECLARATION, not a guard: such a route needs no
 * permission because it structurally cannot reach another user's data. The
 * declaration exists so the startup route assertion can distinguish
 * "deliberately self-scoped" from "someone forgot to declare this route".
 *
 * Only valid where the handler ignores any user identifier in the path/body and
 * uses `@CurrentUser()`. If a route accepts a target id, it needs a permission.
 */
export const SelfOnly = () => SetMetadata(SELF_ONLY_KEY, true);
