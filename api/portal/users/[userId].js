import { json, readJsonBody, updatePortalUser } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return json(res, 405, { error: 'Method not allowed.' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' });
  }

  const result = await updatePortalUser(req, String(req.query.userId || ''), body);
  return json(res, result.ok ? 200 : result.status, result.ok ? { success: true, data: result.data } : { error: result.error });
}
