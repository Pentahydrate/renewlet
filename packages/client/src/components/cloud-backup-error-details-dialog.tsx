import { RawErrorResponseDialog } from "@/components/raw-error-response-dialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { CloudBackupErrorDetailsView } from "@/lib/cloud-backup-error-details";

interface CloudBackupErrorDetailsDialogProps {
  open: boolean;
  details: CloudBackupErrorDetailsView | null;
  onOpenChange: (open: boolean) => void;
}

export function CloudBackupErrorDetailsDialog({ open, details, onOpenChange }: CloudBackupErrorDetailsDialogProps) {
  const { t } = useI18n();
  return (
    <RawErrorResponseDialog
      open={open}
      details={details}
      onOpenChange={onOpenChange}
      title={t("settings.cloudBackupUpstreamTitle")}
      description={t("settings.cloudBackupUpstreamDescription")}
      testId="cloud-backup-error-details-dialog"
    />
  );
}
