import { PipeTransform, Injectable, BadRequestException } from "@nestjs/common";
import { z } from "zod";

@Injectable()
export class ZodValidationPipe<
  T extends z.ZodType = z.ZodType,
> implements PipeTransform {
  constructor(private schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors = result.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));

      throw new BadRequestException({
        message: "Validation failed",
        errors,
      });
    }

    return result.data;
  }
}
