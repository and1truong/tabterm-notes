export function hasCoreNotesCapability(host: { notes?: { apiVersion: number } }): boolean {
  return host.notes?.apiVersion === 1;
}
