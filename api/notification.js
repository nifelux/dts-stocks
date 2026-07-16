/**
 * Notifications API
 * Actions: list, markRead, send (admin)
 */
import supabaseAdmin from '../lib/supabase.js';
import { verifyUser, verifyAdmin } from '../lib/auth.js';

export default async function handler(req, res) {
  const { action } = req.query;
  try {
    switch (action) {
      case 'list': return list(req, res);
      case 'markRead': return markRead(req, res);
      case 'send': return sendNotification(req, res);
      default: return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function list(req, res) {
  const user = await verifyUser(req);
  const { data } = await supabaseAdmin.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
  return res.status(200).json(data);
}

async function markRead(req, res) {
  const user = await verifyUser(req);
  const { id } = req.body;
  if (id) {
    await supabaseAdmin.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', user.id);
  } else {
    await supabaseAdmin.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
  }
  return res.status(200).json({ message: 'Updated' });
}

async function sendNotification(req, res) {
  await verifyAdmin(req);
  const { user_id, title, body } = req.body;
  if (!user_id || !title) return res.status(400).json({ error: 'Missing fields' });
  await supabaseAdmin.from('notifications').insert({ user_id, title, body });
  return res.status(200).json({ message: 'Notification sent' });
}
