import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ObjectStorageService } from "../../../src/services/object-storage.service";
import { ProviderEventLogger } from "../../../src/common/events/provider.logger";

// Only the network client is replaced. The command classes stay real, so the
// tests assert on the exact request each call would send.
jest.mock("@aws-sdk/client-s3", () => {
  const actual = jest.requireActual("@aws-sdk/client-s3");
  return { ...actual, S3Client: jest.fn() };
});

const MockedS3Client = S3Client as unknown as jest.Mock;

const R2_ENV: Record<string, string> = {
  STORAGE_PROVIDER: "r2",
  STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  STORAGE_BUCKET: "klivo-assets",
  STORAGE_ACCESS_KEY_ID: "AKID",
  STORAGE_SECRET_ACCESS_KEY: "SECRET",
  STORAGE_PUBLIC_BASE_URL: "https://assets.getklivo.com/",
};

describe("ObjectStorageService", () => {
  const env = new Map<string, string | undefined>();
  const mockConfig = { get: jest.fn() };
  const mockProviderLog = { log: jest.fn() };
  const send = jest.fn();

  async function build(values: Record<string, string> = R2_ENV) {
    env.clear();
    Object.entries(values).forEach(([k, v]) => env.set(k, v));
    const moduleRef = await Test.createTestingModule({
      providers: [
        ObjectStorageService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: ProviderEventLogger, useValue: mockProviderLog },
      ],
    }).compile();
    const service = moduleRef.get(ObjectStorageService);
    service.onModuleInit();
    return service;
  }

  // jest.config.cjs sets resetMocks, which wipes implementations before each
  // test, so they are installed here rather than at declaration.
  beforeEach(() => {
    mockConfig.get.mockImplementation((k: string) => env.get(k));
    MockedS3Client.mockImplementation(() => ({ send }));
    send.mockResolvedValue({});
  });

  describe("onModuleInit()", () => {
    it("builds the client from STORAGE_* env only", async () => {
      const service = await build();

      expect(MockedS3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "https://acc.r2.cloudflarestorage.com",
          region: "auto",
          credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
          forcePathStyle: false,
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
          maxAttempts: 2,
        }),
      );
      expect(service.bucket).toBe("klivo-assets");
    });

    it("stays unconfigured for AWS S3 (no endpoint) without a region", async () => {
      const values = { ...R2_ENV };
      delete values.STORAGE_ENDPOINT;
      const service = await build(values);

      expect(MockedS3Client).not.toHaveBeenCalled();
      await expect(
        service.upload("k", Buffer.from("x"), "image/png"),
      ).rejects.toThrow("Object storage is not configured");
    });

    it("works for AWS S3: no endpoint, real region, path style when asked", async () => {
      await build({
        STORAGE_BUCKET: "b",
        STORAGE_ACCESS_KEY_ID: "a",
        STORAGE_SECRET_ACCESS_KEY: "s",
        STORAGE_PUBLIC_BASE_URL: "https://assets.example.com",
        STORAGE_REGION: "ap-south-1",
        STORAGE_FORCE_PATH_STYLE: "true",
      });

      expect(MockedS3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: undefined,
          region: "ap-south-1",
          forcePathStyle: true,
        }),
      );
    });

    it.each([
      "STORAGE_BUCKET",
      "STORAGE_ACCESS_KEY_ID",
      "STORAGE_SECRET_ACCESS_KEY",
      "STORAGE_PUBLIC_BASE_URL",
    ])("stays unconfigured when %s is missing", async (missing) => {
      const values = { ...R2_ENV };
      delete values[missing];
      const service = await build(values);

      expect(MockedS3Client).not.toHaveBeenCalled();
      await expect(
        service.upload("k", Buffer.from("x"), "image/png"),
      ).rejects.toThrow("Object storage is not configured");
    });
  });

  describe("upload()", () => {
    it("puts the object with an immutable cache header and returns our public URL", async () => {
      const service = await build();
      const body = Buffer.from("png-bytes");

      const url = await service.upload(
        "agent-assets/org/agent/bot-avatar/1-my logo.png",
        body,
        "image/png",
      );

      expect(send).toHaveBeenCalledTimes(1);
      const cmd = send.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(PutObjectCommand);
      expect(cmd.input).toEqual({
        Bucket: "klivo-assets",
        Key: "agent-assets/org/agent/bot-avatar/1-my logo.png",
        Body: body,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000, immutable",
      });
      // Trailing slash on the base is trimmed; each path segment is encoded.
      expect(url).toBe(
        "https://assets.getklivo.com/agent-assets/org/agent/bot-avatar/1-my%20logo.png",
      );
      expect(mockProviderLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "STORAGE_UPLOAD_COMPLETED",
          // Fixed label so log filters survive a vendor change.
          provider: "STORAGE",
          requestPayload: expect.objectContaining({ vendor: "R2" }),
          success: true,
        }),
      );
    });

    it("logs the failure and throws when the provider rejects", async () => {
      const service = await build();
      send.mockRejectedValueOnce(new Error("AccessDenied"));

      await expect(
        service.upload("k", Buffer.from("x"), "image/png"),
      ).rejects.toThrow("Storage upload failed: AccessDenied");
      expect(mockProviderLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "STORAGE_UPLOAD_FAILED",
          success: false,
          errorMessage: "AccessDenied",
        }),
      );
    });
  });

  describe("remove()", () => {
    it("does nothing for an empty key list", async () => {
      const service = await build();
      await service.remove("klivo-assets", []);
      expect(send).not.toHaveBeenCalled();
      expect(mockProviderLog.log).not.toHaveBeenCalled();
    });

    it("sends one DeleteObject per key (works on every S3 provider)", async () => {
      const service = await build();
      const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);

      await service.remove("klivo-assets", keys);

      expect(send).toHaveBeenCalledTimes(10);
      const sent = send.mock.calls.map(([cmd]) => {
        expect(cmd).toBeInstanceOf(DeleteObjectCommand);
        return cmd.input;
      });
      expect(sent).toEqual(
        keys.map((Key) => ({ Bucket: "klivo-assets", Key })),
      );
      expect(mockProviderLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "STORAGE_REMOVE_COMPLETED",
          provider: "STORAGE",
          requestPayload: {
            vendor: "R2",
            bucket: "klivo-assets",
            keyCount: 10,
          },
          success: true,
        }),
      );
    });

    it("never throws: deletes the rest and logs the failures", async () => {
      const service = await build();
      send
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("SlowDown"))
        .mockResolvedValueOnce({});

      await expect(
        service.remove("klivo-assets", ["a", "b", "c"]),
      ).resolves.toBeUndefined();

      expect(send).toHaveBeenCalledTimes(3);
      expect(mockProviderLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "STORAGE_REMOVE_FAILED",
          success: false,
          errorMessage: "1 of 3 deletes failed: SlowDown",
        }),
      );
    });

    it("reports objects in another bucket as failed, without deleting anything", async () => {
      const service = await build();

      await expect(
        service.remove("agent_assets", ["old/a.png", "old/b.png"]),
      ).resolves.toBeUndefined();

      expect(send).not.toHaveBeenCalled();
      expect(mockProviderLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "STORAGE_REMOVE_FAILED",
          success: false,
          requestPayload: { vendor: "R2", bucket: "agent_assets", keyCount: 2 },
          errorMessage: expect.stringContaining('bucket "agent_assets"'),
        }),
      );
    });

    it("throws when storage is not configured, so callers keep their rows", async () => {
      const service = await build({});
      await expect(service.remove("klivo-assets", ["a"])).rejects.toThrow(
        "Object storage is not configured",
      );
      expect(send).not.toHaveBeenCalled();
    });
  });
});
