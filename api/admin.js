import { supabaseAdmin } from '../lib/supabase.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { verifyAdmin } from '../lib/auth.js';

/**
 * Get List of All Withdrawals for Admin
 */
export async function getAdminWithdrawals(req, res) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

    const { status } = req.query;
    let query = supabaseAdmin
      .from('withdrawals')
      .select('*, profiles(email, full_name)')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: withdrawals, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch admin withdrawals' });
    }

    return res.status(200).json({ withdrawals });
  } catch (error) {
    console.error('Get Admin Withdrawals Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get List of All Deposits for Admin
 */
export async function getAdminDeposits(req, res) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

    const { status } = req.query;
    let query = supabaseAdmin
      .from('deposits')
      .select('*, profiles(email, full_name)')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: deposits, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch admin deposits' });
    }

    return res.status(200).json({ deposits });
  } catch (error) {
    console.error('Get Admin Deposits Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Approve Pending Withdrawal
 */
export async function approveWithdrawal(req, res) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

    const { withdrawal_id, admin_notes } = req.body;
    if (!withdrawal_id) return res.status(400).json({ error: 'Withdrawal ID is required' });

    const { data: wd, error: fetchErr } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawal_id)
      .single();

    if (fetchErr || !wd) {
      return res.status(404).json({ error: 'Withdrawal record not found' });
    }

    if (wd.status !== 'pending') {
      return res.status(400).json({ error: `Withdrawal is already ${wd.status}` });
    }

    // 1. Update Withdrawal Record Status
    const { error: updateWdErr } = await supabaseAdmin
      .from('withdrawals')
      .update({
        status: 'approved',
        admin_notes: admin_notes || null,
        updated_at: new Date()
      })
      .eq('id', withdrawal_id);

    if (updateWdErr) {
      return res.status(500).json({ error: 'Failed to update withdrawal status' });
    }

    // 2. Update Pending Transaction Entry to 'Approved'
    const { error: updateTxErr } = await supabaseAdmin
      .from('transactions')
      .update({ status: 'approved' })
      .eq('reference', `wd_${wd.id}`);

    if (updateTxErr) {
      console.error('Failed to update transaction status:', updateTxErr.message);
    }

    // 3. Notify
    await sendTelegramMessage(
      `✅ *Withdrawal Approved*\n` +
      `ID: \`${wd.id}\`\n` +
      `Amount: ₦${wd.amount}\n` +
      `User ID: \`${wd.user_id}\``
    );

    return res.status(200).json({ message: 'Withdrawal approved successfully' });
  } catch (error) {
    console.error('Approve Withdrawal Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Reject Pending Withdrawal and Refund User Balance
 */
export async function rejectWithdrawal(req, res) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

    const { withdrawal_id, admin_notes } = req.body;
    if (!withdrawal_id) return res.status(400).json({ error: 'Withdrawal ID is required' });

    const { data: wd, error: fetchErr } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawal_id)
      .single();

    if (fetchErr || !wd) {
      return res.status(404).json({ error: 'Withdrawal record not found' });
    }

    if (wd.status !== 'pending') {
      return res.status(400).json({ error: `Withdrawal is already ${wd.status}` });
    }

    // 1. Update Withdrawal Record Status
    const { error: updateWdErr } = await supabaseAdmin
      .from('withdrawals')
      .update({
        status: 'rejected',
        admin_notes: admin_notes || null,
        updated_at: new Date()
      })
      .eq('id', withdrawal_id);

    if (updateWdErr) {
      return res.status(500).json({ error: 'Failed to update withdrawal status' });
    }

    // 2. Update Pending Transaction Entry to 'Rejected'
    const { error: updateTxErr } = await supabaseAdmin
      .from('transactions')
      .update({ status: 'rejected' })
      .eq('reference', `wd_${wd.id}`);

    if (updateTxErr) {
      console.error('Failed to update transaction status:', updateTxErr.message);
    }

    // 3. Refund Money Back to User Wallet
    const { error: rpcErr } = await supabaseAdmin.rpc('credit_wallet_balance', {
      p_user_id: wd.user_id,
      p_amount: Number(wd.amount)
    });

    if (rpcErr) {
      // Fallback: direct update if RPC procedure is unavailable
      const { data: wallet } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('user_id', wd.user_id)
        .single();

      if (wallet) {
        const refundedBalance = Number(wallet.balance) + Number(wd.amount);
        await supabaseAdmin
          .from('wallets')
          .update({ balance: refundedBalance, updated_at: new Date() })
          .eq('user_id', wd.user_id);
      }
    }

    // 4. Notify
    await sendTelegramMessage(
      `❌ *Withdrawal Rejected & Refunded*\n` +
      `ID: \`${wd.id}\`\n` +
      `Amount: ₦${wd.amount}\n` +
      `Reason: ${admin_notes || 'N/A'}`
    );

    return res.status(200).json({ message: 'Withdrawal rejected and funds refunded' });
  } catch (error) {
    console.error('Reject Withdrawal Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Approve Pending Deposit and Credit User Balance
 */
export async function approveDeposit(req, res) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

    const { deposit_id, admin_notes } = req.body;
    if (!deposit_id) return res.status(400).json({ error: 'Deposit ID is required' });

    const { data: deposit, error: fetchErr } = await supabaseAdmin
      .from('deposits')
      .select('*')
      .eq('id', deposit_id)
      .single();

    if (fetchErr || !deposit) {
      return res.status(404).json({ error: 'Deposit record not found' });
    }

    if (deposit.status !== 'pending') {
      return res.status(400).json({ error: `Deposit is already ${deposit.status}` });
    }

    // 1. Update Deposit Record Status
    const { error: updateDepErr } = await supabaseAdmin
      .from('deposits')
      .update({
        status: 'approved',
        admin_notes: admin_notes || null,
        updated_at: new Date()
      })
      .eq('id', deposit_id);

    if (updateDepErr) {
      return res.status(500).json({ error: 'Failed to update deposit status' });
    }

    // 2. Update Pending Transaction Entry to 'Approved'
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'approved' })
      .eq('reference', `dp_${deposit.id}`);

    // 3. Credit User Balance
    const { error: rpcErr } = await supabaseAdmin.rpc('credit_wallet_balance', {
      p_user_id: deposit.user_id,
      p_amount: Number(deposit.amount)
    });

    if (rpcErr) {
      // Fallback: direct update
      const { data: wallet } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('user_id', deposit.user_id)
        .single();

      const currentBalance = wallet ? Number(wallet.balance) : 0;
      const newBalance = currentBalance + Number(deposit.amount);

      await supabaseAdmin
        .from('wallets')
        .upsert({ user_id: deposit.user_id, balance: newBalance, updated_at: new Date() });
    }

    // 4. Notify
    await sendTelegramMessage(
      `✅ *Deposit Approved & Credited*\n` +
      `ID: \`${deposit.id}\`\n` +
      `Amount: ₦${deposit.amount}\n` +
      `User ID: \`${deposit.user_id}\``
    );

    return res.status(200).json({ message: 'Deposit approved and wallet credited successfully' });
  } catch (error) {
    console.error('Approve Deposit Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Reject Pending Deposit
 */
export async function rejectDeposit(req, res) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

    const { deposit_id, admin_notes } = req.body;
    if (!deposit_id) return res.status(400).json({ error: 'Deposit ID is required' });

    const { data: deposit, error: fetchErr } = await supabaseAdmin
      .from('deposits')
      .select('*')
      .eq('id', deposit_id)
      .single();

    if (fetchErr || !deposit) {
      return res.status(404).json({ error: 'Deposit record not found' });
    }

    if (deposit.status !== 'pending') {
      return res.status(400).json({ error: `Deposit is already ${deposit.status}` });
    }

    // 1. Update Deposit Record Status
    const { error: updateDepErr } = await supabaseAdmin
      .from('deposits')
      .update({
        status: 'rejected',
        admin_notes: admin_notes || null,
        updated_at: new Date()
      })
      .eq('id', deposit_id);

    if (updateDepErr) {
      return res.status(500).json({ error: 'Failed to update deposit status' });
    }

    // 2. Update Pending Transaction Entry to 'Rejected'
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'rejected' })
      .eq('reference', `dp_${deposit.id}`);

    // 3. Notify
    await sendTelegramMessage(
      `❌ *Deposit Rejected*\n` +
      `ID: \`${deposit.id}\`\n` +
      `Amount: ₦${deposit.amount}\n` +
      `Reason: ${admin_notes || 'N/A'}`
    );

    return res.status(200).json({ message: 'Deposit rejected successfully' });
  } catch (error) {
    console.error('Reject Deposit Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
