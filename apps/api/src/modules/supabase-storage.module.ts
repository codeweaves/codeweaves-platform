import { Global, Module } from '@nestjs/common';
import { SupabaseStorageService } from '../services/supabase-storage.service';

@Global()
@Module({
  providers: [SupabaseStorageService],
  exports: [SupabaseStorageService],
})
export class SupabaseStorageModule {}
