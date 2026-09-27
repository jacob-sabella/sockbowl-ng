/** Data passed to {@link ConfirmDialogComponent} through `ConfirmDialogService.confirm`. */
export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Styles the confirm button as destructive (warn color), e.g. for a delete (PB-23). */
  destructive?: boolean;
}
