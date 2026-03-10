import type { Role } from '@prisma/client';

export enum Resource {
  User = 'User',
  Organization = 'Organization',
  Agent = 'Agent',
  AgentTheme = 'AgentTheme',
  AgentSecret = 'AgentSecret',
  ChatSession = 'ChatSession',
  ChatMessage = 'ChatMessage',
  Analytics = 'Analytics',
  AuditLog = 'AuditLog',
  Invitation = 'Invitation',
  File = 'File',
}

export enum Action {
  Create = 'Create',
  Read = 'Read',
  ReadAll = 'ReadAll',
  Update = 'Update',
  Delete = 'Delete',
  Export = 'Export',
}

export type PermissionKey = `${Resource}:${Action}`;

export interface PermissionEntry {
  resource: Resource;
  action: Action;
  roles: Role[];
}
