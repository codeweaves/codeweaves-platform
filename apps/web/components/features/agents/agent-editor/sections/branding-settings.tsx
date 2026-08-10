'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAgentEditor } from '../agent-editor-context';
import { usePermissions } from '@/hooks/use-permissions';
import { FormSection } from '../form-section';
import { ColorPicker } from '../color-picker';
import { ImageUpload } from '../image-upload';

export function BrandingSettings() {
  const { can } = usePermissions();
  const { agent, themeData, updateThemeData } = useAgentEditor();

  const isAdmin = can('AgentTheme:UpdateBranding');

  if (!isAdmin) return null;

  const branding = themeData.branding;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Branding</h3>
        <p className="text-sm text-muted-foreground">
          Configure the footer branding of the widget
        </p>
      </div>

      {/* Branding Visibility */}
      <FormSection
        title="Branding Visibility"
        description="Show or hide the branding footer in the widget"
      >
        <div className="grid grid-cols-3 items-center gap-4">
          <Label className="text-sm font-medium">Show Branding</Label>
          <div className="col-span-2">
            <Switch
              checked={branding.enabled}
              onCheckedChange={(checked) =>
                updateThemeData('branding.enabled', checked)
              }
            />
          </div>
        </div>
      </FormSection>

      {branding.enabled && (
        <>
          {/* Text Prefix */}
          <FormSection
            title="Footer Text"
            description="Prefix text displayed before the brand link"
          >
            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Text Prefix</Label>
              <Input
                value={branding.textPrefix}
                onChange={(e) =>
                  updateThemeData('branding.textPrefix', e.target.value)
                }
                placeholder="Powered by"
                className="col-span-2"
              />
            </div>
          </FormSection>

          {/* Display Mode: Logo vs Text Link */}
          <FormSection
            title="Display Mode"
            description="Choose between a logo image or text link"
          >
            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Use Logo</Label>
              <div className="col-span-2">
                <Switch
                  checked={branding.useLogo}
                  onCheckedChange={(checked) =>
                    updateThemeData('branding.useLogo', checked)
                  }
                />
              </div>
            </div>

            {branding.useLogo ? (
              <div className="grid grid-cols-3 items-start gap-4">
                <Label className="pt-2 text-sm font-medium">Brand Logo</Label>
                <div className="col-span-2">
                  <ImageUpload
                    value={branding.logo}
                    onUpload={(url) => updateThemeData('branding.logo', url)}
                    onRemove={() => updateThemeData('branding.logo', undefined)}
                    agentId={agent.id}
                    purpose="brand-logo"
                    previewShape="square"
                    hint="Logo will not be a hyperlink."
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label className="text-sm font-medium">Link Text</Label>
                  <Input
                    value={branding.linkText}
                    onChange={(e) =>
                      updateThemeData('branding.linkText', e.target.value)
                    }
                    placeholder="Klivo"
                    className="col-span-2"
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label className="text-sm font-medium">Link URL</Label>
                  <Input
                    value={branding.linkUrl}
                    onChange={(e) =>
                      updateThemeData('branding.linkUrl', e.target.value)
                    }
                    placeholder="https://codeweaves.com"
                    type="url"
                    className="col-span-2"
                  />
                </div>
              </>
            )}
          </FormSection>

          {/* Colors */}
          <FormSection
            title="Branding Colors"
            description="Text and link colors for the branding footer"
          >
            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Text Color</Label>
              <ColorPicker
                value={branding.textColor}
                onChange={(color) =>
                  updateThemeData('branding.textColor', color)
                }
                className="col-span-2"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-4">
              <Label className="text-sm font-medium">Link Color</Label>
              <ColorPicker
                value={branding.linkColor}
                onChange={(color) =>
                  updateThemeData('branding.linkColor', color)
                }
                className="col-span-2"
              />
            </div>
          </FormSection>
        </>
      )}
    </div>
  );
}
