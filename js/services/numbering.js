// Document numbers: PREFIX-0001, or PREFIX-<devicePrefix>-0001 when a device prefix is set.
// The sequence lives in the device-local counters store, and ctx.nextNumber makes it atomic inside the
// caller's transaction. A failed document leaves no gap, because the whole transaction rolls back.
import { ServiceError } from './errors.js';
import { readSettingsIn } from './settings.js';

export async function nextDocNumber(ctx, kind) {
  const settings = await readSettingsIn(ctx);
  const prefix = settings.docPrefixes[kind];
  if (!prefix) throw new ServiceError('unknownDocKind', { kind });
  const sequence = await ctx.nextNumber(`doc:${kind}`);
  const device = settings.devicePrefix ? `${settings.devicePrefix}-` : '';
  return `${prefix}-${device}${String(sequence).padStart(4, '0')}`;
}
