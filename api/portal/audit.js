import { json, listPortalAuditEvents } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  const result = await listPortalAuditEvents(req);
  return json(res, result.ok ? 200 : result.status, result.ok ? { success: true, data: result.data } : { error: result.error });
}
