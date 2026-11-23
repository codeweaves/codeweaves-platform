import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";

import { Public } from "../../decorators/public.decorator";
import { InternalSecretGuard } from "../../guards/internal-secret.guard";
import { FilesService } from "../../services/files.service";

/**
 * Internal trigger for the daily uploaded-file cleanup: deletes agent images
 * that no saved theme uses and that are older than 7 days (uploads that were
 * never saved, and anything a theme save could not delete).
 *
 * Same pattern and auth as the other internal jobs: a scheduler (pg_cron)
 * POSTs here once a day with the shared secret:
 *
 *   curl -X POST https://<api-host>/internal/files/cleanup \
 *        -H "x-internal-secret: $INTERNAL_API_SECRET"
 *
 * @Public(): no JWT, the caller is a cron. InternalSecretGuard is the gate.
 * Returns 202 at once and runs in the background, like the classifier: the
 * scheduler's HTTP call times out after 5 s, and a run can take up to ~25 s.
 * The outcome is the FILE_CLEANUP_RUN_COMPLETED / _FAILED event.
 */
@ApiTags("Internal")
@Public()
@UseGuards(InternalSecretGuard)
@Controller("internal/files")
export class FileCleanupController {
  constructor(private readonly files: FilesService) {}

  @Post("cleanup")
  @HttpCode(202)
  @ApiExcludeEndpoint()
  cleanup(): { started: boolean } {
    return { started: this.files.triggerOrphanCleanup() };
  }
}
