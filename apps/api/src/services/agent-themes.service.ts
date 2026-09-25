import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { AgentLoggerService } from "../common/logger/agent.logger";
import { AppLogger } from "../common/logger/app-logger";
import type { CurrentUserData } from "../decorators/current-user.decorator";
import { defaultWidgetTheme } from "../models/agent-theme.dto";
import type {
  WidgetTheme,
  PartialWidgetTheme,
} from "../models/agent-theme.dto";
import { PermissionCatalogService } from "../common/rbac/permission-catalog.service";
import { isOrgScoped } from "../utils/tenant-filter";
import {
  consentAuditView,
  readConsentConfig,
  withNormalizedConsent,
} from "../utils/consent-notice";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const sourceVal = source[key];
    if (
      sourceVal &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal)
    ) {
      result[key] = deepMerge(
        (target[key] as Record<string, unknown>) || {},
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

@Injectable()
export class AgentThemesService {
  private readonly log = new AppLogger(AgentThemesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentLogger: AgentLoggerService,
    private readonly catalog: PermissionCatalogService,
  ) {}

  async getTheme(agentId: string, user: CurrentUserData) {
    await this.ensureAgentAccess(agentId, user);

    const theme = await this.prisma.agentTheme.findUnique({
      where: { agentId },
    });

    if (!theme) {
      return { config: defaultWidgetTheme, version: 0 };
    }

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  async updateTheme(
    agentId: string,
    config: WidgetTheme,
    user: CurrentUserData,
  ) {
    const agent = await this.ensureAgentAccess(agentId, user);

    const existing = await this.prisma.agentTheme.findUnique({
      where: { agentId },
      select: { config: true },
    });
    this.assertConsentUnchangedUnlessPermitted(config, existing?.config, user);
    const safeConfig = this.preserveConsentUnlessPermitted(
      this.preserveBrandingUnlessPermitted(config, existing?.config, user),
      existing?.config,
      user,
    );
    // Judge what will actually be stored: a caller without the consent
    // permission cannot change the notice, so their copy of it is irrelevant.
    this.assertConsentValid(safeConfig);
    // Store the consent section fully defaulted, so the stored wording is
    // exactly what the widget shows and the consent rows snapshot.
    const jsonConfig = toJsonValue(withNormalizedConsent(safeConfig));

    const theme = await this.prisma.agentTheme.upsert({
      where: { agentId },
      create: { agentId, config: jsonConfig, version: 1 },
      update: { config: jsonConfig, version: { increment: 1 } },
    });

    await this.agentLogger.logThemeUpdated(agentId, user.id);
    await this.logConsentChange(
      agentId,
      user.id,
      existing?.config,
      safeConfig,
      agent.organizationId,
    );
    this.log.info("updateTheme", "theme replaced", {
      agentId,
      version: theme.version,
    });

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  async patchTheme(
    agentId: string,
    partialConfig: PartialWidgetTheme,
    user: CurrentUserData,
  ) {
    const agent = await this.ensureAgentAccess(agentId, user);

    let previousConfig: unknown;
    const theme = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.agentTheme.findUnique({
        where: { agentId },
      });
      previousConfig = existing?.config;

      const currentConfig = existing
        ? (existing.config as WidgetTheme)
        : defaultWidgetTheme;

      const merged = deepMerge(currentConfig, partialConfig) as WidgetTheme;
      // Branding is granted deliberately. See preserveBrandingUnlessPermitted.
      if (!this.canEditBranding(user)) {
        merged.branding = currentConfig.branding ?? defaultWidgetTheme.branding;
      }
      // The privacy notice likewise. See preserveConsentUnlessPermitted.
      this.assertConsentUnchangedUnlessPermitted(
        merged,
        existing?.config,
        user,
      );
      if (!this.canEditConsent(user)) {
        merged.consent = currentConfig.consent ?? defaultWidgetTheme.consent;
      }
      // After the merge: a PATCH can turn the notice on in one call and set
      // the link in another, so only the merged result can be judged.
      this.assertConsentValid(merged);
      const jsonConfig = toJsonValue(withNormalizedConsent(merged));

      return tx.agentTheme.upsert({
        where: { agentId },
        create: { agentId, config: jsonConfig, version: 1 },
        update: { config: jsonConfig, version: { increment: 1 } },
      });
    });

    await this.agentLogger.logThemeUpdated(agentId, user.id);
    await this.logConsentChange(
      agentId,
      user.id,
      previousConfig,
      theme.config,
      agent.organizationId,
    );
    this.log.info("patchTheme", "theme patched", {
      agentId,
      version: theme.version,
    });

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  async resetTheme(agentId: string, user: CurrentUserData) {
    const agent = await this.ensureAgentAccess(agentId, user);

    const existing = await this.prisma.agentTheme.findUnique({
      where: { agentId },
      select: { config: true },
    });
    // A reset must not become a back door: without the consent permission it
    // resets everything EXCEPT the privacy notice, which would otherwise be
    // switched off by one click on "Reset theme".
    const resetConfig = this.preserveConsentUnlessPermitted(
      defaultWidgetTheme,
      existing?.config,
      user,
    );
    const jsonConfig = toJsonValue(resetConfig);

    const theme = await this.prisma.agentTheme.upsert({
      where: { agentId },
      create: { agentId, config: jsonConfig, version: 1 },
      update: { config: jsonConfig, version: { increment: 1 } },
    });

    await this.agentLogger.logThemeReset(agentId, user.id);
    // A permitted reset turns the notice off; record it like any other change.
    await this.logConsentChange(
      agentId,
      user.id,
      existing?.config,
      resetConfig,
      agent.organizationId,
    );
    this.log.info("resetTheme", "theme reset to default", {
      agentId,
      version: theme.version,
    });

    return { config: theme.config as WidgetTheme, version: theme.version };
  }

  /** Does this caller hold the privacy-notice permission? */
  private canEditConsent(user: CurrentUserData): boolean {
    return this.catalog
      .resolvePermissions(user.roleKeys ?? [])
      .has("AgentTheme:UpdateConsent");
  }

  /**
   * Keep the stored privacy notice unless the caller may change it.
   *
   * The notice is the client's legal wording and policy link (ADR-0004), so it
   * is granted via `org.agent_privacy`, not with ordinary theme access. Same
   * field-level rule as branding, for the same reason: the notice shares one
   * JSONB column and one endpoint with appearance. The editor sends the whole
   * theme on every save, so the section is kept silently instead of refusing
   * the save; the editor hides the section from these users.
   */
  private preserveConsentUnlessPermitted(
    config: WidgetTheme,
    storedConfig: unknown,
    user: CurrentUserData,
  ): WidgetTheme {
    if (this.canEditConsent(user)) return config;
    const storedConsent = storedConfig
      ? (storedConfig as WidgetTheme).consent
      : undefined;
    return { ...config, consent: storedConsent ?? defaultWidgetTheme.consent };
  }

  /**
   * Refuse, loudly, an attempt to CHANGE the notice without the permission.
   *
   * The editor sends the whole theme on every save, so a caller without the
   * permission normally sends the stored notice back unchanged, and that save
   * goes through. Only a real change is refused. Dropping it silently with a
   * 200 left an owner believing the notice was live when it was not.
   * Compared after schema defaults, so a stored theme that predates the
   * consent key equals the editor's defaulted copy.
   */
  private assertConsentUnchangedUnlessPermitted(
    incoming: WidgetTheme,
    storedConfig: unknown,
    user: CurrentUserData,
  ): void {
    if (this.canEditConsent(user)) return;
    const before = JSON.stringify(readConsentConfig(storedConfig));
    const after = JSON.stringify(readConsentConfig(incoming));
    if (before === after) return;
    this.log.warn(
      "assertConsentUnchangedUnlessPermitted",
      "privacy notice write denied",
      {
        userId: user.id,
      },
    );
    throw new ForbiddenException(
      "You do not have permission to change the privacy notice",
    );
  }

  /** Does this caller hold the branding permission? */
  private canEditBranding(user: CurrentUserData): boolean {
    return this.catalog
      .resolvePermissions(user.roleKeys ?? [])
      .has("AgentTheme:UpdateBranding");
  }

  /**
   * Keep the stored branding unless the caller may change it.
   *
   * Branding is the "Powered by Klivo" footer, so it is the white-label lever and
   * granted deliberately via `org.agent_branding` rather than coming with
   * ordinary theme access. It cannot be gated by the route's permission the way
   * other sections are, because appearance, chat interface and branding all live
   * in the SAME JSONB column and one endpoint writes the whole thing. A
   * permission decides whether a call is allowed; it cannot decide which keys
   * inside one value a caller may set. So this is a field-level rule, kept at the
   * single place that writes the column.
   *
   * The editor hides the section for these users; this is the boundary that
   * holds when someone calls the API directly.
   */
  private preserveBrandingUnlessPermitted(
    config: WidgetTheme,
    storedConfig: unknown,
    user: CurrentUserData,
  ): WidgetTheme {
    if (this.canEditBranding(user)) return config;

    const storedBranding = storedConfig
      ? (storedConfig as WidgetTheme).branding
      : undefined;

    return {
      ...config,
      branding: storedBranding ?? defaultWidgetTheme.branding,
    };
  }

  /**
   * A privacy notice without the client's own policy link does not meet DPDP
   * Rule 3(c), and the widget would not show it. Refuse to turn it on rather
   * than save a notice that silently does nothing.
   */
  private assertConsentValid(config: WidgetTheme): void {
    const consent = readConsentConfig(config);
    if (consent.enabled && consent.privacyPolicyUrl === "") {
      throw new BadRequestException(
        "Add your privacy policy link before you turn on the privacy notice.",
      );
    }
  }

  /** Audit a notice change, and only a real one (see logConsentNoticeUpdated). */
  private async logConsentChange(
    agentId: string,
    userId: string,
    before: unknown,
    after: unknown,
    organizationId: string,
  ): Promise<void> {
    const beforeView = consentAuditView(readConsentConfig(before));
    const afterView = consentAuditView(readConsentConfig(after));
    if (JSON.stringify(beforeView) === JSON.stringify(afterView)) return;
    await this.agentLogger.logConsentNoticeUpdated(
      agentId,
      userId,
      beforeView,
      afterView,
      organizationId,
    );
  }

  private async ensureAgentAccess(agentId: string, user: CurrentUserData) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        deletedAt: null,
        ...(isOrgScoped(user) && { organizationId: user.organizationId! }),
      },
    });

    if (!agent) {
      throw new NotFoundException("Agent not found");
    }

    return agent;
  }
}
