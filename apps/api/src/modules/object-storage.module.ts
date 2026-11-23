import { Global, Module } from "@nestjs/common";
import { ObjectStorageService } from "../services/object-storage.service";

@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}
