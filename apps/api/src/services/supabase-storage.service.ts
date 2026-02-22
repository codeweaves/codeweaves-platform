import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private client!: SupabaseClient;

  constructor(private readonly configService: ConfigService) {}

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

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType, upsert: true });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    return this.getPublicUrl(bucket, path);
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;

    const supabase = this.ensureClient();

    const { error } = await supabase.storage.from(bucket).remove(paths);

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
