import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ProviderEventLogger } from '../common/events/provider.logger';

@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private client!: SupabaseClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly providerLog: ProviderEventLogger,
  ) {}

  onModuleInit() {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !key) {
      this.logger.warn(
        'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — file uploads will be unavailable',
      );
      return;
    }

    this.client = createClient(url, key, {
      auth: { persistSession: false },
    });
    this.logger.log('SupabaseStorageService initialized');
  }

  private ensureClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase Storage is not configured');
    }
    return this.client;
  }

  async upload(
    bucket: string,
    path: string,
    file: Buffer,
    contentType: string,
  ): Promise<string> {
    const supabase = this.ensureClient();

    const start = performance.now();
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType, upsert: true });

    this.providerLog.log({
      channel: 'DASHBOARD',
      eventName: error
        ? 'SUPABASE_STORAGE_UPLOAD_FAILED'
        : 'SUPABASE_STORAGE_UPLOAD_COMPLETED',
      direction: 'OUTBOUND',
      provider: 'SUPABASE',
      requestPayload: { bucket, path, sizeBytes: file.length, contentType },
      latencyMs: Math.round(performance.now() - start),
      success: !error,
      errorMessage: error?.message,
    });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    return this.getPublicUrl(bucket, path);
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;

    const supabase = this.ensureClient();

    const start = performance.now();
    const { error } = await supabase.storage.from(bucket).remove(paths);

    this.providerLog.log({
      channel: 'DASHBOARD',
      eventName: error
        ? 'SUPABASE_STORAGE_REMOVE_FAILED'
        : 'SUPABASE_STORAGE_REMOVE_COMPLETED',
      direction: 'OUTBOUND',
      provider: 'SUPABASE',
      requestPayload: { bucket, pathCount: paths.length },
      latencyMs: Math.round(performance.now() - start),
      success: !error,
      errorMessage: error?.message,
    });

    if (error) {
      this.logger.warn(`Storage remove failed: ${error.message}`);
    }
  }

  getPublicUrl(bucket: string, path: string): string {
    const supabase = this.ensureClient();

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);

    return data.publicUrl;
  }
}
