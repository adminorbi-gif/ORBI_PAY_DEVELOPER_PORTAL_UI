import { createPortalUser, json, listPortalUsers, readJsonBody } from '../_shared.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const result = await listPortalUsers(req);
    return json(res, result.ok ? 200 : result.status, result.ok ? { success: true, data: result.data } : { error: result.error });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body.' });
    }
    const result = await createPortalUser(req, body);
    return json(res, result.ok ? 200 : result.status, result.ok ? { success: true, data: result.data } : { error: result.error });
  }

  return json(res, 405, { error: 'Method not allowed.' });
}
