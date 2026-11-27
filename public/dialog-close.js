export function backdropCloses(downTarget, clickTarget, dialog) {
  return Boolean(dialog) && downTarget === dialog && clickTarget === dialog;
}
