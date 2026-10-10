import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import { Action, Resource } from "../../common/rbac/rbac.types";
import {
  CurrentUser,
  type CurrentUserData,
} from "../../decorators/current-user.decorator";
import { RequirePermission } from "../../decorators/require-permission.decorator";
import {
  createProviderPriceSchema,
  type CreateProviderPrice,
} from "../../models/usage.dto";
import { ZodValidationPipe } from "../../pipes/zod-validation.pipe";
import {
  PriceAdminService,
  type PriceList,
  type PriceRow,
} from "./price-admin.service";

/**
 * The provider price list for platform staff (ADR-0012). Reading needs
 * `Usage:Read`; adding a row needs `Price:Create` (super admin only). There is
 * no update or delete: a price change is a new effective-dated row.
 */
@ApiTags("Admin: prices")
@ApiBearerAuth()
@Controller("admin/prices")
export class PriceAdminController {
  constructor(private readonly prices: PriceAdminService) {}

  @Get()
  @RequirePermission(Resource.Usage, Action.Read)
  @ApiOperation({
    summary: "Current and past prices, plus recent calls with no price",
  })
  list(): Promise<PriceList> {
    return this.prices.list();
  }

  @Post()
  @HttpCode(201)
  @RequirePermission(Resource.Price, Action.Create)
  @ApiOperation({ summary: "Add a new effective-dated price row" })
  @ApiResponse({ status: 201, description: "Price row added" })
  @ApiResponse({
    status: 409,
    description:
      "A row for this provider, model, unit and start already exists",
  })
  create(
    @Body(new ZodValidationPipe(createProviderPriceSchema))
    body: CreateProviderPrice,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PriceRow> {
    return this.prices.create(body, user);
  }
}
