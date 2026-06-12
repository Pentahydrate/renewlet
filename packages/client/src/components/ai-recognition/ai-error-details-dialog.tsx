import { RawErrorResponseDialog } from "@/components/raw-error-response-dialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { AIErrorDetails } from "@/lib/ai-error-details";

interface AIErrorDetailsDialogProps {
  open: boolean;
  details: AIErrorDetails | null;
  onOpenChange: (open: boolean) => void;
}

export function AIErrorDetailsDialog({ open, details, onOpenChange }: AIErrorDetailsDialogProps) {
  const { t } = useI18n();
  return (
    <RawErrorResponseDialog
      open={open}
      details={details}
      onOpenChange={onOpenChange}
      title={t("aiRecognition.errorDetailsTitle")}
      description={details?.message ?? t("aiRecognition.errorDetailsDescription")}
      testId="ai-error-details-dialog"
    />
  );
}
