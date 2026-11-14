import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from "@nestjs/swagger";
import { ConversationLimitService } from "../../services/conversation-limit.service";
import { ZodValidationPipe } from "../../pipes/zod-validation.pipe";
import { updateOrganizationContractSchema } from "../../models/organization.dto";
import type { UpdateOrganizationContractDto } from "../../models/organization.dto";
import { RequirePermission } from "../../decorators/require-permission.decorator";
import { Resource, Action } from "../../common/rbac/rbac.types";

/**
 * An organization's contract start date and conversation limit (ADR-0022).
 * Platform staff only: the permissions are not org-allowed.
 */
@ApiTags("Organizations")
@ApiBearerAuth()
@Controller("organizations/:id/contract")
export class OrganizationContractController {
  constructor(private readonly conversationLimit: ConversationLimitService) {}

  @Get()
  @RequirePermission(Resource.OrganizationContract, Action.Read)
  @ApiOperation({
    summary:
      "Get the contract, conversation limit and usage of an organization",
  })
  @ApiParam({ name: "id", description: "Organization UUID" })
  @ApiResponse({ status: 200, description: "Contract and usage" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - platform staff only" })
  @ApiResponse({ status: 404, description: "Organization not found" })
  async get(@Param("id", ParseUUIDPipe) id: string) {
    return this.conversationLimit.getContract(id);
  }

  @Patch()
  @RequirePermission(Resource.OrganizationContract, Action.Update)
  @ApiOperation({
    summary:
      "Set the contract start date and/or conversation limit. Sending conversationLimit restarts the usage count.",
  })
  @ApiParam({ name: "id", description: "Organization UUID" })
  @ApiResponse({ status: 200, description: "Updated contract and usage" })
  @ApiResponse({ status: 400, description: "Validation failed" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - platform staff only" })
  @ApiResponse({ status: 404, description: "Organization not found" })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateOrganizationContractSchema))
    dto: UpdateOrganizationContractDto,
  ) {
    return this.conversationLimit.updateContract(id, dto);
  }
}
