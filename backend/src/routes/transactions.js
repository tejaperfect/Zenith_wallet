import express from 'express';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { createTransactionValidation, validate } from '../middleware/validation.js';

const router = express.Router();

// @route   GET /api/transactions
// @desc    Get user's transactions
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const {
      type,
      status,
      category,
      dateFrom,
      dateTo,
      limit = 20,
      page = 1,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {
      $or: [
        { 'from.user': req.user._id },
        { 'to.user': req.user._id }
      ]
    };

    // Type filter
    if (type && type !== 'all') {
      filter.type = type;
    }

    // Status filter
    if (status && status !== 'all') {
      filter.status = status;
    }

    // Category filter
    if (category && category !== 'all') {
      filter.category = category;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    // Sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const transactions = await Transaction.find(filter)
      .populate('from.user', 'name email avatar')
      .populate('to.user', 'name email avatar')
      .populate('relatedExpense', 'title amount')
      .populate('relatedGroup', 'name avatar')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Transaction.countDocuments(filter);

    // Add user context to each transaction
    const transactionsWithContext = transactions.map(transaction => {
      const transactionObj = transaction.toObject();
      
      transactionObj.userRole = transaction.from.user._id.toString() === req.user._id.toString() 
        ? 'sender' 
        : 'receiver';
      
      transactionObj.userAmount = transactionObj.userRole === 'sender' 
        ? -transaction.amount 
        : transaction.amount;
      
      return transactionObj;
    });

    res.json({
      success: true,
      data: {
        transactions: transactionsWithContext,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/transactions
// @desc    Create a new transaction
// @access  Private
router.post('/', auth, createTransactionValidation, validate, async (req, res) => {
  try {
    const {
      type,
      amount,
      description,
      category,
      to,
      paymentMethod = 'wallet',
      metadata,
      relatedExpense,
      relatedGroup,
      recurring
    } = req.body;

    // Get user's current balance
    const fromUser = await User.findById(req.user._id);
    
    // Validate sufficient balance for outgoing transactions
    if (['expense', 'transfer'].includes(type) && fromUser.walletBalance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    // Validate recipient for transfers
    let toUser = null;
    if (type === 'transfer' && to.user) {
      toUser = await User.findById(to.user);
      if (!toUser) {
        return res.status(404).json({
          success: false,
          message: 'Recipient not found'
        });
      }
    }

    // Create transaction
    const transaction = new Transaction({
      type,
      amount,
      description,
      category,
      from: {
        user: req.user._id,
        account: 'wallet',
        balanceBefore: fromUser.walletBalance,
        balanceAfter: type === 'income' 
          ? fromUser.walletBalance + amount 
          : fromUser.walletBalance - amount
      },
      to: to ? {
        user: to.user,
        account: to.account || 'wallet',
        balanceBefore: toUser ? toUser.walletBalance : 0,
        balanceAfter: toUser ? toUser.walletBalance + amount : 0,
        external: to.external
      } : undefined,
      paymentMethod,
      metadata,
      relatedExpense,
      relatedGroup,
      recurring,
      status: 'pending'
    });

    await transaction.save();

    // Process the transaction
    try {
      await transaction.process();
    } catch (processError) {
      console.error('Transaction processing failed:', processError);
      // Transaction will remain in failed state
    }

    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('from.user', 'name email avatar')
      .populate('to.user', 'name email avatar')
      .populate('relatedExpense', 'title amount')
      .populate('relatedGroup', 'name avatar');

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: { transaction: populatedTransaction }
    });

  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/transactions/:transactionId
// @desc    Get transaction details
// @access  Private
router.get('/:transactionId', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('from.user', 'name email avatar')
      .populate('to.user', 'name email avatar')
      .populate('relatedExpense', 'title amount category')
      .populate('relatedGroup', 'name avatar');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if user has access to this transaction
    const hasAccess = transaction.from.user._id.toString() === req.user._id.toString() ||
                     (transaction.to.user && transaction.to.user._id.toString() === req.user._id.toString());

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { transaction }
    });

  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/transactions/:transactionId/retry
// @desc    Retry failed transaction
// @access  Private
router.post('/:transactionId/retry', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Only transaction creator can retry
    if (transaction.from.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only transaction creator can retry'
      });
    }

    if (transaction.status !== 'failed') {
      return res.status(400).json({
        success: false,
        message: 'Only failed transactions can be retried'
      });
    }

    // Check retry limit
    if (transaction.retryCount >= transaction.maxRetries) {
      return res.status(400).json({
        success: false,
        message: 'Maximum retry limit reached'
      });
    }

    // Retry the transaction
    try {
      await transaction.retry();
      
      const populatedTransaction = await Transaction.findById(transaction._id)
        .populate('from.user', 'name email avatar')
        .populate('to.user', 'name email avatar');

      res.json({
        success: true,
        message: 'Transaction retried successfully',
        data: { transaction: populatedTransaction }
      });

    } catch (retryError) {
      res.status(400).json({
        success: false,
        message: 'Transaction retry failed',
        error: retryError.message
      });
    }

  } catch (error) {
    console.error('Retry transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retry transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/transactions/:transactionId/cancel
// @desc    Cancel pending transaction
// @access  Private
router.post('/:transactionId/cancel', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Only transaction creator can cancel
    if (transaction.from.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only transaction creator can cancel'
      });
    }

    if (!['pending', 'processing'].includes(transaction.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only pending or processing transactions can be cancelled'
      });
    }

    transaction.status = 'cancelled';
    await transaction.save();

    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('from.user', 'name email avatar')
      .populate('to.user', 'name email avatar');

    res.json({
      success: true,
      message: 'Transaction cancelled successfully',
      data: { transaction: populatedTransaction }
    });

  } catch (error) {
    console.error('Cancel transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/transactions/analytics/summary
// @desc    Get transaction analytics summary
// @access  Private
router.get('/analytics/summary', auth, async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range based on period
    const now = new Date();
    let startDate;
    
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const filter = {
      $or: [
        { 'from.user': req.user._id },
        { 'to.user': req.user._id }
      ],
      createdAt: { $gte: startDate },
      status: 'completed'
    };

    // Get transaction aggregations
    const summary = await Transaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalIncome: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$type', 'income'] },
                  { $eq: ['$from.user', req.user._id] }
                ]},
                '$amount',
                0
              ]
            }
          },
          totalExpenses: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$type', 'expense'] },
                  { $eq: ['$from.user', req.user._id] }
                ]},
                '$amount',
                0
              ]
            }
          },
          totalTransfersOut: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$type', 'transfer'] },
                  { $eq: ['$from.user', req.user._id] }
                ]},
                '$amount',
                0
              ]
            }
          },
          totalTransfersIn: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$type', 'transfer'] },
                  { $eq: ['$to.user', req.user._id] }
                ]},
                '$amount',
                0
              ]
            }
          },
          transactionCount: { $sum: 1 }
        }
      }
    ]);

    // Get category breakdown
    const categoryBreakdown = await Transaction.aggregate([
      { $match: { ...filter, type: 'expense' } },
      {
        $group: {
          _id: '$category',
          amount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { amount: -1 } }
    ]);

    // Get monthly trend
    const monthlyTrend = await Transaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            type: '$type'
          },
          amount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const result = summary[0] || {
      totalIncome: 0,
      totalExpenses: 0,
      totalTransfersOut: 0,
      totalTransfersIn: 0,
      transactionCount: 0
    };

    result.netIncome = result.totalIncome + result.totalTransfersIn - result.totalExpenses - result.totalTransfersOut;
    result.categoryBreakdown = categoryBreakdown;
    result.monthlyTrend = monthlyTrend;

    res.json({
      success: true,
      data: { summary: result }
    });

  } catch (error) {
    console.error('Get transaction analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;