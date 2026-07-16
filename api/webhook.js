/**
 * Webhook Handler for External Payment Gateways (Monnify, etc.)
 * Action: monnify (placeholder)
 */
import supabaseAdmin from '../lib/supabase.js';

export default async function handler(req, res) {
  const { action } = req.query;
  if (action === 'monnify') {
    // Future: verify Monnify signature, process payment notification
    // For now, return 200 to acknowledge
    try {
      const payload = req.body;
      // Log for debugging
      await supabaseAdmin.from('activity_logs').insert({ action: 'webhook_monnify', details: payload });
      return res.status(200).json({ status: 'received' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  return res.status(400).json({ error: 'Invalid action' });
}
