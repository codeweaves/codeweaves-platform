import {
  iconConfigSchema,
  headerConfigSchema,
  messageConfigSchema,
  avatarConfigSchema,
  inputConfigSchema,
  sendButtonConfigSchema,
  bodyConfigSchema,
  bubbleConfigSchema,
  typographyConfigSchema,
  animationsConfigSchema,
  timestampsConfigSchema,
  starterSchema,
  startersConfigSchema,
  brandingConfigSchema,
  widgetThemeSchema,
  partialWidgetThemeSchema,
  defaultWidgetTheme,
} from '@repo/validation';
import type { WidgetTheme } from '@repo/validation';

describe('Theme Validation Schemas', () => {
  describe('iconConfigSchema', () => {
    it('should accept valid icon config', () => {
      const data = {
        position: 'right',
        backgroundColor: '#3b82f6',
        hoverBackgroundColor: '#2563eb',
        size: 56,
        borderRadius: 50,
        shadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      };
      expect(iconConfigSchema.parse(data)).toEqual(data);
    });

    it('should accept left position', () => {
      const data = {
        position: 'left',
        backgroundColor: '#000',
        hoverBackgroundColor: '#111',
        size: 40,
        borderRadius: 0,
        shadow: 'none',
      };
      expect(iconConfigSchema.parse(data)).toEqual(data);
    });

    it('should accept optional customImageUrl', () => {
      const data = {
        position: 'right',
        backgroundColor: '#000',
        hoverBackgroundColor: '#111',
        size: 56,
        borderRadius: 50,
        shadow: 'none',
        customImageUrl: 'https://example.com/icon.png',
      };
      expect(iconConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject invalid customImageUrl', () => {
      expect(() =>
        iconConfigSchema.parse({
          position: 'right',
          backgroundColor: '#000',
          hoverBackgroundColor: '#111',
          size: 56,
          borderRadius: 50,
          shadow: 'none',
          customImageUrl: 'not-a-url',
        }),
      ).toThrow();
    });

    it('should reject invalid position', () => {
      expect(() =>
        iconConfigSchema.parse({
          position: 'center',
          backgroundColor: '#000',
          hoverBackgroundColor: '#111',
          size: 56,
          borderRadius: 50,
          shadow: 'none',
        }),
      ).toThrow();
    });

    it('should reject size below 40', () => {
      expect(() =>
        iconConfigSchema.parse({
          position: 'right',
          backgroundColor: '#000',
          hoverBackgroundColor: '#111',
          size: 39,
          borderRadius: 50,
          shadow: 'none',
        }),
      ).toThrow();
    });

    it('should reject size above 80', () => {
      expect(() =>
        iconConfigSchema.parse({
          position: 'right',
          backgroundColor: '#000',
          hoverBackgroundColor: '#111',
          size: 81,
          borderRadius: 50,
          shadow: 'none',
        }),
      ).toThrow();
    });

    it('should reject borderRadius above 50', () => {
      expect(() =>
        iconConfigSchema.parse({
          position: 'right',
          backgroundColor: '#000',
          hoverBackgroundColor: '#111',
          size: 56,
          borderRadius: 51,
          shadow: 'none',
        }),
      ).toThrow();
    });

    it('should reject empty backgroundColor', () => {
      expect(() =>
        iconConfigSchema.parse({
          position: 'right',
          backgroundColor: '',
          hoverBackgroundColor: '#111',
          size: 56,
          borderRadius: 50,
          shadow: 'none',
        }),
      ).toThrow();
    });
  });

  describe('headerConfigSchema', () => {
    it('should accept valid header config', () => {
      const data = {
        title: 'Chat with us',
        subtitle: 'We reply fast',
        backgroundColor: '#3b82f6',
        textColor: '#ffffff',
        subtitleColor: '#e0e7ff',
        showLogo: false,
        borderRadius: 14,
      };
      expect(headerConfigSchema.parse(data)).toEqual(data);
    });

    it('should accept without optional subtitle and logoUrl', () => {
      const data = {
        title: 'Chat',
        backgroundColor: '#000',
        textColor: '#fff',
        subtitleColor: '#ccc',
        showLogo: true,
        borderRadius: 14,
      };
      expect(headerConfigSchema.parse(data)).toEqual(data);
    });

    it('should accept optional logoUrl', () => {
      const data = {
        title: 'Chat',
        backgroundColor: '#000',
        textColor: '#fff',
        subtitleColor: '#ccc',
        showLogo: true,
        logoUrl: 'https://example.com/logo.png',
        borderRadius: 14,
      };
      expect(headerConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject missing title', () => {
      expect(() =>
        headerConfigSchema.parse({
          backgroundColor: '#000',
          textColor: '#fff',
          subtitleColor: '#ccc',
          showLogo: false,
          borderRadius: 14,
        }),
      ).toThrow();
    });
  });

  describe('messageConfigSchema', () => {
    it('should accept valid message config', () => {
      const data = { backgroundColor: '#3b82f6', textColor: '#ffffff', borderRadius: 16 };
      expect(messageConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject borderRadius above 50', () => {
      expect(() =>
        messageConfigSchema.parse({ backgroundColor: '#000', textColor: '#fff', borderRadius: 51 }),
      ).toThrow();
    });

    it('should reject borderRadius below 0', () => {
      expect(() =>
        messageConfigSchema.parse({ backgroundColor: '#000', textColor: '#fff', borderRadius: -1 }),
      ).toThrow();
    });

    it('should reject empty color strings', () => {
      expect(() =>
        messageConfigSchema.parse({ backgroundColor: '', textColor: '#fff', borderRadius: 12 }),
      ).toThrow();
      expect(() =>
        messageConfigSchema.parse({ backgroundColor: '#000', textColor: '', borderRadius: 12 }),
      ).toThrow();
    });
  });

  describe('avatarConfigSchema', () => {
    it('should accept valid avatar config', () => {
      const data = {
        type: 'robot',
        shape: 'circle',
        backgroundColor: '#e0e7ff',
        color: '#3b82f6',
      };
      expect(avatarConfigSchema.parse(data)).toEqual(data);
    });

    it('should accept all valid types', () => {
      for (const type of ['robot', 'machine', 'bot', 'support', 'custom', 'user']) {
        expect(
          avatarConfigSchema.parse({
            type,
            shape: 'circle',
            backgroundColor: '#000',
            color: '#fff',
          }),
        ).toBeDefined();
      }
    });

    it('should accept all valid shapes', () => {
      for (const shape of ['circle', 'square', 'rounded']) {
        expect(
          avatarConfigSchema.parse({
            type: 'robot',
            shape,
            backgroundColor: '#000',
            color: '#fff',
          }),
        ).toBeDefined();
      }
    });

    it('should reject invalid type', () => {
      expect(() =>
        avatarConfigSchema.parse({
          type: 'invalid',
          shape: 'circle',
          backgroundColor: '#000',
          color: '#fff',
        }),
      ).toThrow();
    });

    it('should reject invalid shape', () => {
      expect(() =>
        avatarConfigSchema.parse({
          type: 'robot',
          shape: 'hexagon',
          backgroundColor: '#000',
          color: '#fff',
        }),
      ).toThrow();
    });

    it('should reject invalid customImageUrl', () => {
      expect(() =>
        avatarConfigSchema.parse({
          type: 'custom',
          shape: 'circle',
          backgroundColor: '#000',
          color: '#fff',
          customImageUrl: 'not-a-url',
        }),
      ).toThrow();
    });
  });

  describe('inputConfigSchema', () => {
    it('should accept valid input config', () => {
      const data = {
        backgroundColor: '#ffffff',
        textColor: '#1f2937',
        placeholderText: 'Type your message...',
        placeholderColor: '#9ca3af',
        borderColor: '#e5e7eb',
        borderRadius: 12,
      };
      expect(inputConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject borderRadius above 50', () => {
      expect(() =>
        inputConfigSchema.parse({
          backgroundColor: '#fff',
          textColor: '#000',
          placeholderText: 'Type...',
          placeholderColor: '#aaa',
          borderColor: '#ccc',
          borderRadius: 51,
        }),
      ).toThrow();
    });
  });

  describe('sendButtonConfigSchema', () => {
    it('should accept valid send button config', () => {
      const data = {
        backgroundColor: '#3b82f6',
        hoverBackgroundColor: '#2563eb',
        iconColor: '#ffffff',
        borderRadius: 12,
      };
      expect(sendButtonConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject borderRadius above 50', () => {
      expect(() =>
        sendButtonConfigSchema.parse({
          backgroundColor: '#000',
          hoverBackgroundColor: '#111',
          iconColor: '#fff',
          borderRadius: 51,
        }),
      ).toThrow();
    });
  });

  describe('bodyConfigSchema', () => {
    it('should accept valid body config', () => {
      expect(bodyConfigSchema.parse({ backgroundColor: '#ffffff' })).toEqual({
        backgroundColor: '#ffffff',
      });
    });

    it('should reject missing backgroundColor', () => {
      expect(() => bodyConfigSchema.parse({})).toThrow();
    });

    it('should reject empty backgroundColor', () => {
      expect(() => bodyConfigSchema.parse({ backgroundColor: '' })).toThrow();
    });
  });

  describe('bubbleConfigSchema', () => {
    it('should accept valid bubble config', () => {
      const data = {
        enabled: true,
        text: 'Hi there!',
        backgroundColor: '#ffffff',
        textColor: '#1f2937',
        delayMs: 3000,
      };
      expect(bubbleConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject negative delayMs', () => {
      expect(() =>
        bubbleConfigSchema.parse({
          enabled: true,
          text: 'Hi',
          backgroundColor: '#fff',
          textColor: '#000',
          delayMs: -1,
        }),
      ).toThrow();
    });

    it('should reject delayMs above 30000', () => {
      expect(() =>
        bubbleConfigSchema.parse({
          enabled: true,
          text: 'Hi',
          backgroundColor: '#fff',
          textColor: '#000',
          delayMs: 30001,
        }),
      ).toThrow();
    });

    it('should accept delayMs at max boundary', () => {
      const data = {
        enabled: true,
        text: 'Hi',
        backgroundColor: '#fff',
        textColor: '#000',
        delayMs: 30000,
      };
      expect(bubbleConfigSchema.parse(data)).toEqual(data);
    });
  });

  describe('typographyConfigSchema', () => {
    it('should accept valid typography config', () => {
      const data = { fontFamily: 'Inter, sans-serif', baseFontSize: 14 };
      expect(typographyConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject baseFontSize below 10', () => {
      expect(() => typographyConfigSchema.parse({ fontFamily: 'Arial', baseFontSize: 9 })).toThrow();
    });

    it('should reject baseFontSize above 24', () => {
      expect(() => typographyConfigSchema.parse({ fontFamily: 'Arial', baseFontSize: 25 })).toThrow();
    });
  });

  describe('animationsConfigSchema', () => {
    it('should accept valid animations config', () => {
      const data = { transitionDuration: 200, showTypingIndicator: true };
      expect(animationsConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject transitionDuration above 1000', () => {
      expect(() =>
        animationsConfigSchema.parse({ transitionDuration: 1001, showTypingIndicator: true }),
      ).toThrow();
    });
  });

  describe('timestampsConfigSchema', () => {
    it('should accept valid timestamps config', () => {
      const data = { show: true, format: '12h', color: '#9ca3af' };
      expect(timestampsConfigSchema.parse(data)).toEqual(data);
    });

    it('should accept 24h format', () => {
      expect(timestampsConfigSchema.parse({ show: false, format: '24h', color: '#000' })).toBeDefined();
    });

    it('should reject invalid format', () => {
      expect(() => timestampsConfigSchema.parse({ show: true, format: 'am/pm', color: '#000' })).toThrow();
    });
  });

  describe('starterSchema / startersConfigSchema', () => {
    it('should accept valid starter', () => {
      const data = { message: 'Hi there' };
      expect(starterSchema.parse(data)).toEqual(data);
    });

    it('should accept array of up to 4 starters', () => {
      const starters = [
        { message: 'a' },
        { message: 'b' },
        { message: 'c' },
        { message: 'd' },
      ];
      expect(startersConfigSchema.parse(starters)).toEqual(starters);
    });

    it('should accept empty starters array', () => {
      expect(startersConfigSchema.parse([])).toEqual([]);
    });

    it('should reject more than 4 starters', () => {
      const starters = Array.from({ length: 5 }, (_, i) => ({ message: `m${i}` }));
      expect(() => startersConfigSchema.parse(starters)).toThrow();
    });

    it('should reject empty message string', () => {
      expect(() => starterSchema.parse({ message: '' })).toThrow();
    });

    it('should reject message exceeding 80 characters', () => {
      expect(() => starterSchema.parse({ message: 'a'.repeat(81) })).toThrow();
    });

    it('should accept message at 80 character limit', () => {
      const data = { message: 'a'.repeat(80) };
      expect(starterSchema.parse(data)).toEqual(data);
    });
  });

  describe('brandingConfigSchema', () => {
    it('should accept valid branding config', () => {
      const data = {
        enabled: true,
        textPrefix: 'Powered by',
        useLogo: false,
        linkText: 'CodeWeaves',
        linkUrl: 'https://codeweaves.com',
        textColor: '#9ca3af',
        linkColor: '#3b82f6',
      };
      expect(brandingConfigSchema.parse(data)).toEqual(data);
    });

    it('should accept optional logo URL', () => {
      const data = {
        enabled: true,
        textPrefix: 'Powered by',
        useLogo: true,
        linkText: 'Test',
        linkUrl: 'https://test.com',
        logo: 'https://test.com/logo.png',
        textColor: '#000',
        linkColor: '#111',
      };
      expect(brandingConfigSchema.parse(data)).toEqual(data);
    });

    it('should reject invalid linkUrl', () => {
      expect(() =>
        brandingConfigSchema.parse({
          enabled: true,
          textPrefix: 'Powered by',
          useLogo: false,
          linkText: 'Test',
          linkUrl: 'not-a-url',
          textColor: '#000',
          linkColor: '#111',
        }),
      ).toThrow();
    });
  });

  describe('widgetThemeSchema', () => {
    it('should accept the full defaultWidgetTheme', () => {
      const result = widgetThemeSchema.parse(defaultWidgetTheme);
      expect(result).toEqual(defaultWidgetTheme);
    });

    it('should reject when a required section is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { icon: _icon, ...incomplete } = defaultWidgetTheme;
      expect(() => widgetThemeSchema.parse(incomplete)).toThrow();
    });

    it('should reject when a nested field is invalid', () => {
      const invalid = {
        ...defaultWidgetTheme,
        icon: { ...defaultWidgetTheme.icon, size: 999 },
      };
      expect(() => widgetThemeSchema.parse(invalid)).toThrow();
    });
  });

  describe('partialWidgetThemeSchema', () => {
    it('should accept a full theme', () => {
      const result = partialWidgetThemeSchema.parse(defaultWidgetTheme);
      expect(result).toEqual(defaultWidgetTheme);
    });

    it('should accept an empty object', () => {
      const result = partialWidgetThemeSchema.parse({});
      expect(result).toEqual({});
    });

    it('should accept a single section', () => {
      const result = partialWidgetThemeSchema.parse({
        icon: { backgroundColor: '#ff0000' },
      });
      expect(result).toEqual({ icon: { backgroundColor: '#ff0000' } });
    });

    it('should accept partial nested fields', () => {
      const result = partialWidgetThemeSchema.parse({
        header: { title: 'New Title' },
        bubble: { enabled: false },
      });
      expect(result).toEqual({
        header: { title: 'New Title' },
        bubble: { enabled: false },
      });
    });

    it('should still validate field constraints on provided values', () => {
      expect(() =>
        partialWidgetThemeSchema.parse({
          icon: { size: 999 },
        }),
      ).toThrow();
    });
  });

  describe('defaultWidgetTheme', () => {
    it('should be a valid WidgetTheme', () => {
      const result = widgetThemeSchema.safeParse(defaultWidgetTheme);
      expect(result.success).toBe(true);
    });

    it('should have all required top-level keys', () => {
      const keys: (keyof WidgetTheme)[] = [
        'icon', 'header', 'userMessage', 'botMessage', 'botAvatar', 'userAvatar',
        'input', 'sendButton', 'body', 'bubble', 'typography', 'animations',
        'timestamps', 'starters', 'branding',
      ];
      for (const key of keys) {
        expect(defaultWidgetTheme).toHaveProperty(key);
      }
    });

    it('should have empty starters by default', () => {
      expect(defaultWidgetTheme.starters).toEqual([]);
    });
  });
});
