/**
 * Sensitive database work is allowed only for an unlocked local session.
 * A connected wearable is never enough on its own.
 */
export type SensitiveOperation = 'read' | 'write' | 'delete';

export type AccessDecision = 'allow' | 'unauthorized' | 'reauth';

export function decideDatabaseAccess(input: {
  unlocked: boolean;
  recentAuth: boolean;
  operation: SensitiveOperation;
  bleConnected: boolean;
}): AccessDecision {
  if (!input.unlocked) return 'unauthorized';
  if (input.operation === 'delete' && !input.recentAuth) return 'reauth';
  return 'allow';
}

/** A connected wearable does not authenticate the person holding the phone. */
export function bleConnectionGrantsAccess(bleConnected: boolean): boolean {
  void bleConnected;
  return false;
}
