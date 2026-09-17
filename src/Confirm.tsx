import { useCallback, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "./i18n";

interface ConfirmOptions {
  title?: string;
  /** Label of the confirming button. Defaults to a generic "Confirm". */
  confirmLabel?: string;
  /** Styles the confirming button as destructive. */
  danger?: boolean;
}

type Pending = ConfirmOptions & {
  message: ReactNode;
  resolve: (value: boolean) => void;
};

/**
 * In-app replacement for window.confirm. Returns a `confirm` function that
 * resolves to the user's choice, and the dialog element to render once.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm(t("removeEmployeeConfirm"), { danger: true }))) return;
 */
export function useConfirm(): [
  (message: ReactNode, options?: ConfirmOptions) => Promise<boolean>,
  ReactNode,
] {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const confirm = useCallback(
    (message: ReactNode, options: ConfirmOptions = {}) =>
      new Promise<boolean>((resolve) => {
        // A second request while one is open cancels the first.
        pendingRef.current?.resolve(false);
        const next = { ...options, message, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );
  const settle = (value: boolean) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  };
  const dialog = pending ? (
    <>
      <button
        type="button"
        className="drawer-scrim"
        onClick={() => settle(false)}
        aria-label={t("cancel")}
      />
      <div
        className="adjustment-modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="shift-modal-header">
          <div className="confirm-dialog-heading">
            <span
              className={`confirm-dialog-icon ${pending.danger ? "danger" : ""}`}
              aria-hidden="true"
            >
              <AlertTriangle size={18} />
            </span>
            <h2 id="confirm-dialog-title">
              {pending.title ?? t("confirmTitle")}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => settle(false)}
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </div>
        <p id="confirm-dialog-message" className="modal-intro">
          {pending.message}
        </p>
        <div className="shift-modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => settle(false)}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className={pending.danger ? "reject-button" : "primary-button"}
            autoFocus
            onClick={() => settle(true)}
          >
            {pending.confirmLabel ?? t("confirmAction")}
          </button>
        </div>
      </div>
    </>
  ) : null;
  return [confirm, dialog];
}
