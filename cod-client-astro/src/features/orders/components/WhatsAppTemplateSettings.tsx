import { useState } from "react";
import { MessageCircle, Settings2 } from "lucide-react";
import { Button, Dialog, Textarea } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import {
  DEFAULT_WA_TEMPLATE,
  WA_PLACEHOLDERS,
  loadWaTemplate,
  saveWaTemplate,
} from "@/features/orders/whatsapp";

/**
 * Gear in the orders table header: edit the WhatsApp outreach template
 * used by the per-row contact button. {placeholders} are substituted with
 * the order's data when the chat opens.
 */
export function WhatsAppTemplateSettings() {
  const t = useT("orders");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_WA_TEMPLATE);

  function show() {
    setDraft(loadWaTemplate());
    setOpen(true);
  }

  function save() {
    const value = draft.trim() ? draft : DEFAULT_WA_TEMPLATE;
    saveWaTemplate(value);
    notify.flashSuccess(t("wa_template_saved"));
    setOpen(false);
  }

  function reset() {
    setDraft(DEFAULT_WA_TEMPLATE);
    saveWaTemplate(DEFAULT_WA_TEMPLATE);
    notify.flashSuccess(t("wa_template_saved"));
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        title={t("wa_template_title")}
        aria-label={t("wa_template_title")}
        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
      >
        <Settings2 size={13} />
      </button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={t("wa_template_title")}
          description={t("wa_template_desc")}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {WA_PLACEHOLDERS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => setDraft(`${draft}{${token}}`)}
                  className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  dir="ltr"
                >
                  {`{${token}}`}
                </button>
              ))}
            </div>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              dir="rtl"
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              <MessageCircle size={14} />
              {t("wa_template_reset")}
            </Button>
            <Button type="button" onClick={save}>
              {t("wa_template_save")}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
