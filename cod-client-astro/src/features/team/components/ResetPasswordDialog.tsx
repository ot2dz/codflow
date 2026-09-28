import { useState } from "react";
import { Check, Copy, KeySquare, ShieldAlert } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";

/** Shows a freshly reset temporary password once, with copy + warning. */
export function ResetPasswordDialog({
  open,
  tempPassword,
  userName,
  onClose,
}: {
  open: boolean;
  tempPassword: string | null;
  userName: string | null;
  onClose: () => void;
}) {
  const t = useT("team");
  const common = useT("common");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      notify.success(t("reset_password_dialog.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      notify.error(common("feedback.copy_failed"));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <KeySquare size={16} />
          </span>
          <span>
            {t("reset_password_dialog.title")}
            {userName && (
              <span className="ms-2 text-xs font-medium text-muted-foreground">
                {t("reset_password_dialog.subtitle").replace("{name}", userName)}
              </span>
            )}
          </span>
        </span>
      }
      className="max-w-sm"
      showClose={false}
    >
      {tempPassword && (
        <>
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 select-all truncate rounded-lg border border-border bg-muted/60 px-3 py-2.5 font-mono text-xs text-foreground"
              dir="ltr"
            >
              {tempPassword}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleCopy()}
              aria-label={t("reset_password_dialog.copied")}
            >
              {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
            </Button>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-xs font-semibold leading-relaxed text-amber-700 dark:text-amber-400">
              {t("reset_password_dialog.warning")}
            </p>
          </div>
          <div className="mt-6">
            <Button type="button" className="w-full" onClick={onClose}>
              {t("reset_password_dialog.done")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
