import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { cx } from "../../components/ui";
import { SettingsCard, SettingsRow } from "./primitives";

export function McpControlSection({
  settings,
  saveSettings,
}: {
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const [saving, setSaving] = useState(false);
  const enabled = settings.mcpControlEnabled === true;

  const toggle = async () => {
    setSaving(true);
    try {
      await saveSettings({ mcpControlEnabled: !enabled });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard title={t("settings.mcpControlTitle")}>
      <SettingsRow
        title={t("settings.mcpControlEnabled")}
        description={t("settings.mcpControlDesc")}
      >
        <button
          type="button"
          className={cx("settings-toggle", enabled && "on")}
          role="switch"
          aria-checked={enabled}
          aria-label={t("settings.mcpControlEnabled")}
          disabled={saving}
          onClick={() => void toggle()}
        >
          <span className="settings-toggle-thumb" />
        </button>
      </SettingsRow>
    </SettingsCard>
  );
}
