import { Test, TestingModule } from "@nestjs/testing";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { FileCleanupController } from "../../../src/controllers/internal/file-cleanup.controller";
import { FilesService } from "../../../src/services/files.service";
import { InternalSecretGuard } from "../../../src/guards/internal-secret.guard";
import { IS_PUBLIC_KEY } from "../../../src/decorators/public.decorator";
import { CRON_JOBS } from "../../../src/modules/ops-console/system-status.service";

describe("FileCleanupController", () => {
  let controller: FileCleanupController;
  const triggerOrphanCleanup = jest.fn();

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FileCleanupController],
      providers: [
        { provide: FilesService, useValue: { triggerOrphanCleanup } },
      ],
    })
      .overrideGuard(InternalSecretGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(FileCleanupController);
  });

  it("starts the run in the background and answers at once (scheduler times out after 5 s)", () => {
    triggerOrphanCleanup.mockReturnValue(true);

    expect(controller.cleanup()).toEqual({ started: true });
    expect(triggerOrphanCleanup).toHaveBeenCalledTimes(1);
  });

  it("reports when a run is already going", () => {
    triggerOrphanCleanup.mockReturnValue(false);

    expect(controller.cleanup()).toEqual({ started: false });
  });

  it("answers 202 Accepted", () => {
    expect(
      Reflect.getMetadata(
        "__httpCode__",
        FileCleanupController.prototype.cleanup,
      ),
    ).toBe(202);
  });

  it("is a cron endpoint: no JWT, gated by the internal secret", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FileCleanupController)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, FileCleanupController),
    ).toContain(InternalSecretGuard);
  });

  it("is listed on the ops-console status page with the events it records", () => {
    expect(CRON_JOBS).toContainEqual(
      expect.objectContaining({
        endpoint: "/internal/files/cleanup",
        completedEvent: "FILE_CLEANUP_RUN_COMPLETED",
        failedEvent: "FILE_CLEANUP_RUN_FAILED",
        expectedEveryMinutes: 24 * 60,
      }),
    );
  });
});
