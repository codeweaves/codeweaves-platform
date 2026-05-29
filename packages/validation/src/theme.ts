/**
 * WidgetTheme Zod Schemas and Default Values
 * Defines the complete theme configuration for the embeddable chat widget.
 */
import { z } from 'zod';

// ============================================
// Shared Validators
// ============================================

const colorString = z.string().min(1, 'Color cannot be empty').max(50, 'Color string too long');
const cssValueString = z.string().min(1).max(200);

// ============================================
// Sub-Schemas
// ============================================

export const iconConfigSchema = z.object({
  position: z.enum(['left', 'right']),
  backgroundColor: colorString,
  hoverBackgroundColor: colorString,
  size: z.number().int().min(40).max(80),
  borderRadius: z.number().int().min(0).max(50),
  customImageUrl: z.string().url().optional(),
  shadow: cssValueString,
});
export type IconConfig = z.infer<typeof iconConfigSchema>;

export const headerConfigSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  backgroundColor: colorString,
  textColor: colorString,
  subtitleColor: colorString,
  showLogo: z.boolean(),
  logoUrl: z.string().url().optional(),
  borderRadius: z.number().int().min(0).max(50),
});
export type HeaderConfig = z.infer<typeof headerConfigSchema>;

export const messageConfigSchema = z.object({
  backgroundColor: colorString,
  textColor: colorString,
  borderRadius: z.number().int().min(0).max(50),
});
export type MessageConfig = z.infer<typeof messageConfigSchema>;

export const avatarConfigSchema = z.object({
  show: z.boolean().default(false),
  type: z.enum(['robot', 'machine', 'bot', 'support', 'custom', 'user']),
  shape: z.enum(['circle', 'square', 'rounded']),
  backgroundColor: colorString,
  color: colorString,
  customImageUrl: z.string().url().optional(),
});
export type AvatarConfig = z.infer<typeof avatarConfigSchema>;

export const inputConfigSchema = z.object({
  backgroundColor: colorString,
  textColor: colorString,
  placeholderText: z.string(),
  placeholderColor: colorString,
  borderColor: colorString,
  borderRadius: z.number().int().min(0).max(50),
});
export type InputConfig = z.infer<typeof inputConfigSchema>;

export const sendButtonConfigSchema = z.object({
  backgroundColor: colorString,
  hoverBackgroundColor: colorString,
  iconColor: colorString,
  borderRadius: z.number().int().min(0).max(50),
});
export type SendButtonConfig = z.infer<typeof sendButtonConfigSchema>;

export const bodyConfigSchema = z.object({
  backgroundColor: colorString,
});
export type BodyConfig = z.infer<typeof bodyConfigSchema>;

export const bubbleConfigSchema = z.object({
  enabled: z.boolean(),
  text: z.string(),
  backgroundColor: colorString,
  textColor: colorString,
  delayMs: z.number().int().min(0).max(30000),
});
export type BubbleConfig = z.infer<typeof bubbleConfigSchema>;

export const typographyConfigSchema = z.object({
  fontFamily: z.string(),
  baseFontSize: z.number().int().min(10).max(24),
});
export type TypographyConfig = z.infer<typeof typographyConfigSchema>;

export const animationsConfigSchema = z.object({
  transitionDuration: z.number().int().min(0).max(1000),
  showTypingIndicator: z.boolean(),
});
export type AnimationsConfig = z.infer<typeof animationsConfigSchema>;

export const timestampsConfigSchema = z.object({
  show: z.boolean(),
  format: z.enum(['12h', '24h']),
  color: colorString,
});
export type TimestampsConfig = z.infer<typeof timestampsConfigSchema>;

export const starterSchema = z.object({
  message: z.string().min(1).max(80),
});
export type Starter = z.infer<typeof starterSchema>;

export const startersConfigSchema = z.array(starterSchema).max(4);
export type StartersConfig = z.infer<typeof startersConfigSchema>;

export const brandingConfigSchema = z.object({
  enabled: z.boolean(),
  textPrefix: z.string(),
  useLogo: z.boolean(),
  linkText: z.string(),
  linkUrl: z.string().url(),
  logo: z.string().url().optional(),
  textColor: colorString,
  linkColor: colorString,
});
export type BrandingConfig = z.infer<typeof brandingConfigSchema>;

// ============================================
// Root Widget Theme Schema
// ============================================

export const widgetThemeSchema = z.object({
  icon: iconConfigSchema,
  header: headerConfigSchema,
  userMessage: messageConfigSchema,
  botMessage: messageConfigSchema,
  botAvatar: avatarConfigSchema,
  userAvatar: avatarConfigSchema,
  input: inputConfigSchema,
  sendButton: sendButtonConfigSchema,
  body: bodyConfigSchema,
  bubble: bubbleConfigSchema,
  typography: typographyConfigSchema,
  animations: animationsConfigSchema,
  timestamps: timestampsConfigSchema,
  starters: startersConfigSchema,
  branding: brandingConfigSchema,
});

export type WidgetTheme = z.infer<typeof widgetThemeSchema>;

/** Deep-partial schema for PATCH/update operations (all fields optional) */
export const partialWidgetThemeSchema = widgetThemeSchema.deepPartial();
export type PartialWidgetTheme = z.infer<typeof partialWidgetThemeSchema>;

// ============================================
// Default Theme
// ============================================

export const defaultWidgetTheme: WidgetTheme = {
  icon: {
    position: 'right',
    backgroundColor: '#3b82f6',
    hoverBackgroundColor: '#2563eb',
    size: 56,
    borderRadius: 50,
    shadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  },
  header: {
    title: 'Chat with us',
    subtitle: 'We usually reply within a few minutes',
    backgroundColor: '#3b82f6',
    textColor: '#ffffff',
    subtitleColor: '#e0e7ff',
    showLogo: false,
    borderRadius: 14,
  },
  userMessage: {
    backgroundColor: '#3b82f6',
    textColor: '#ffffff',
    borderRadius: 16,
  },
  botMessage: {
    backgroundColor: '#f3f4f6',
    textColor: '#1f2937',
    borderRadius: 16,
  },
  botAvatar: {
    show: false,
    type: 'robot',
    shape: 'circle',
    backgroundColor: '#e0e7ff',
    color: '#3b82f6',
  },
  userAvatar: {
    show: false,
    type: 'user',
    shape: 'circle',
    backgroundColor: '#dbeafe',
    color: '#3b82f6',
  },
  input: {
    backgroundColor: '#ffffff',
    textColor: '#1f2937',
    placeholderText: 'Type your message...',
    placeholderColor: '#9ca3af',
    borderColor: '#e5e7eb',
    borderRadius: 12,
  },
  sendButton: {
    backgroundColor: '#3b82f6',
    hoverBackgroundColor: '#2563eb',
    iconColor: '#ffffff',
    borderRadius: 12,
  },
  body: {
    backgroundColor: '#ffffff',
  },
  bubble: {
    enabled: true,
    text: 'Hi there! How can I help?',
    backgroundColor: '#ffffff',
    textColor: '#1f2937',
    delayMs: 3000,
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    baseFontSize: 14,
  },
  animations: {
    transitionDuration: 200,
    showTypingIndicator: true,
  },
  timestamps: {
    show: true,
    format: '12h',
    color: '#9ca3af',
  },
  starters: [],
  branding: {
    enabled: true,
    textPrefix: 'Powered by',
    useLogo: false,
    linkText: 'Klivo',
    linkUrl: 'https://codeweaves.com',
    textColor: '#9ca3af',
    linkColor: '#3b82f6',
  },
};
