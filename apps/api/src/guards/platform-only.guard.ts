import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { isOrgScoped } from "../utils/tenant-filter";

/**
 * Second lock for endpoints that read every tenant's data (the usage and price
 * console). Their permissions are already platform-only in the catalog; this
 * stops a future mis-grant of such a permission to an org role from leaking
 * other tenants' rows. Same rule as `assertPlatformCaller` in the ops console.
 *
 * Apply with @UseGuards(PlatformOnlyGuard). Runs after the global guards, so
 * `request.user` is set.
 */
@Injectable()
export class PlatformOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user || isOrgScoped(user)) {
      throw new ForbiddenException("This console is platform-only");
    }
    return true;
  }
}
