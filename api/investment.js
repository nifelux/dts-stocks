/**
 * Investment API
 * Actions: products (list public), createInvestment, myInvestments, productDetail
 * Admin actions: createProduct, updateProduct, deleteProduct, toggleLock
 */
import supabaseAdmin from '../lib/supabase.js';
import { verifyUser, verifyAdmin } from '../lib/auth.js';
import { sendTelegramMessage } from '../lib/telegram.js';

export default async function handler(req, res) {
  const { action } = req.query;
  try {
    switch (action) {
      // Public / user
      case 'products': return listProducts(req, res);
      case 'productDetail': return productDetail(req, res);
      case 'createInvestment': return createInvestment(req, res);
      case 'myInvestments': return myInvestments(req, res);
      // Admin
      case 'createProduct': return createProduct(req, res);
      case 'updateProduct': return updateProduct(req, res);
      case 'deleteProduct': return deleteProduct(req, res);
      case 'toggleLock': return toggleLock(req, res);
      default: return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function listProducts(req, res) {
  // Exclude locked ones for non-admins? We'll show all; only admin can see locked.
  let query = supabaseAdmin.from('products').select('*');
  // If user is not admin, don't show locked
  try {
    const user = await verifyUser(req);
    const { data: profile } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).single();
    if (!profile?.is_admin) query = query.eq('is_locked', false);
  } catch {
    query = query.eq('is_locked', false);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  return res.status(200).json(data);
}

async function productDetail(req, res) {
  const { id } = req.query;
  const { data } = await supabaseAdmin.from('products').select('*').eq('id', id).single();
  return res.status(200).json(data);
}

async function createInvestment(req, res) {
  const user = await verifyUser(req);
  const { product_id, amount } = req.body;

  // Validate product exists and not locked
  const { data: product } = await supabaseAdmin.from('products').select('*').eq('id', product_id).single();
  if (!product || product.is_locked) return res.status(400).json({ error: 'Product not available' });
  if (amount < product.min_invest) return res.status(400).json({ error: `Minimum investment: ₦${product.min_invest}` });
  if (product.max_invest && amount > product.max_invest) return res.status(400).json({ error: `Maximum investment: ₦${product.max_invest}` });

  // Purchase-limit pre-check (friendly message; the DB trigger
  // trg_enforce_purchase_limit is the real enforcement backstop in
  // case this endpoint is ever bypassed)
  if (product.max_purchases_per_user != null) {
    const { count } = await supabaseAdmin
      .from('investments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('product_id', product.id);
    if ((count || 0) >= product.max_purchases_per_user) {
      return res.status(400).json({ error: `You've reached the purchase limit (${product.max_purchases_per_user}) for this product.` });
    }
  }

  // Check wallet balance
  const { data: wallet } = await supabaseAdmin.from('wallets').select('balance').eq('user_id', user.id).single();
  if (wallet.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  // Fixed-price packages (daily_income_amount set) pay a flat ₦/day
  // figure directly. Flexible/open-amount products fall back to the
  // percentage-of-amount calculation.
  const dailyIncome = product.daily_income_amount != null
    ? Number(product.daily_income_amount)
    : (amount * product.daily_roi_percent) / 100;

  // Deduct balance via transaction — this INSERT (status already
  // 'approved') is what trg_process_transaction picks up to actually
  // subtract from wallets.balance for type='investment'. This is the
  // step the old client-side direct-insert flow was skipping entirely,
  // which is why balances weren't being debited.
  const { data: txn, error: txnErr } = await supabaseAdmin.from('transactions').insert({
    user_id: user.id,
    type: 'investment',
    amount: amount,
    status: 'approved',
    reference: `inv_${Date.now()}_${user.id.substring(0,8)}`
  }).select().single();
  if (txnErr) return res.status(400).json({ error: txnErr.message });

  // Create investment record
  const { data: investment, error } = await supabaseAdmin.from('investments').insert({
    user_id: user.id,
    product_id: product.id,
    amount,
    daily_income: dailyIncome,
    duration_days: product.duration_days
  }).select().single();
  if (error) {
    return res.status(400).json({
      error: error.message.includes('Purchase limit')
        ? `You've reached the purchase limit for this product.`
        : error.message
    });
  }

  // Log activity
  await supabaseAdmin.from('activity_logs').insert({
    user_id: user.id,
    action: 'investment_create',
    details: { investment_id: investment.id, amount, product: product.name }
  });

  // Notification failures (e.g. Telegram env vars not configured) must
  // never make an already-successful investment look like it failed —
  // the money has moved and the investment row exists at this point.
  try {
    await sendTelegramMessage(`📈 New investment: ₦${amount} in ${product.name} by ${user.email}`);
  } catch (notifyErr) {
    console.error('Telegram notification failed (investment still succeeded):', notifyErr.message);
  }

  return res.status(200).json(investment);
}

async function myInvestments(req, res) {
  const user = await verifyUser(req);
  const { data, error } = await supabaseAdmin.from('investments')
    .select('*, products(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  return res.status(200).json(data);
}

// Admin actions
async function createProduct(req, res) {
  await verifyAdmin(req);
  const { name, description, min_invest, max_invest, daily_roi_percent, duration_days, daily_income_amount, max_purchases_per_user } = req.body;
  const { data, error } = await supabaseAdmin.from('products').insert({
    name, description, min_invest, max_invest, daily_roi_percent, duration_days,
    daily_income_amount: daily_income_amount ?? null,
    max_purchases_per_user: max_purchases_per_user ?? null
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json(data);
}

async function updateProduct(req, res) {
  await verifyAdmin(req);
  const { id, ...updates } = req.body;
  await supabaseAdmin.from('products').update(updates).eq('id', id);
  return res.status(200).json({ message: 'Product updated' });
}

async function deleteProduct(req, res) {
  await verifyAdmin(req);
  const { id } = req.body;
  await supabaseAdmin.from('products').delete().eq('id', id);
  return res.status(200).json({ message: 'Product deleted' });
}

async function toggleLock(req, res) {
  await verifyAdmin(req);
  const { id, is_locked } = req.body;
  await supabaseAdmin.from('products').update({ is_locked }).eq('id', id);
  return res.status(200).json({ message: `Product ${is_locked ? 'locked' : 'unlocked'}` });
}
  
