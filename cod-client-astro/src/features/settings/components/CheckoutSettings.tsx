import { useState } from "react";
import { MapPin } from "lucide-react";
import { useT } from "@/i18n/react";
import type { StoreConfig } from "@/features/settings/types";
import { SettingsSection } from "@/features/settings/components/SettingsSection";

export function CheckoutSettings({
  storeConfig,
  onSave,
}: {
  storeConfig: StoreConfig;
  onSave: (payload: { showCommune?: boolean }) => Promise<void>;
}) {
  const t = useT("settings");
  const [showCommune, setShowCommune] = useState(storeConfig.showCommune ?? true);

  return (
    <SettingsSection
      icon={MapPin}
      title={t("store.checkout_title")}
      subtitle={t("store.checkout_subtitle")}
      onSave={async () => {
        await onSave({ showCommune });
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <span className="text-sm font-semibold text-foreground">
            {t("store.show_commune_label")}
          </span>
          <p className="text-xs text-muted-foreground">{t("store.show_commune_hint")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showCommune}
          onClick={() => setShowCommune((current) => !current)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            showCommune ? "bg-primary" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform ${
              showCommune ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </SettingsSection>
  );
}
