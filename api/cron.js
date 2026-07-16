/**
 * Cron Management API
 * Actions: triggerDailyIncome (manual), status (last runs)
 */
import supabaseAdmin from '../lib/supabase.js';
import { verifyAdmin } from '../lib/auth.js';

export default async function handler(req, res) {
  const { action } = req.query;
  try {
    switch (action) {
      case 'triggerDailyIncome': return triggerDailyIncome(req, res);
      case 'status': return getCronStatus(req, res);
      default: return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function triggerDailyIncome(req, res) {
  await verifyAdmin(req);
  const { error } = await supabaseAdmin.rpc('distribute_daily_income');
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ message: 'Daily income distribution completed' });
}

async function getCronStatus(req, res) {
  await verifyAdmin(req);
  const { data } = await supabaseAdmin.from('cron_logs').select('*').order('created_at', { ascending: false }).limit(10);
  return res.status(200).json(data);
}
