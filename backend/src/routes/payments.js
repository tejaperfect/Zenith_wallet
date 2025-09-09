import express from 'express';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import Expense from '../models/Expense.js';
import { auth } from '../middleware/auth.js';
import { groupMemberAuth } from '../middleware/authorize.js';
import { validate } from '../middleware/validation.js';
import { body } from 'express-validator';

const router = express.Router();

// Validation rules for payments
const sendMoneyValidation = [
  body('recipientId')
    .isMongoId()
    .withMessage('Valid recipient ID is required'),
  
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  
  body('description')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Description must be between 1 and 500 characters'),
  
  body('paymentMethod')
    .optional()
    .isIn(['wallet', 'bank_transfer', 'upi'])
    .withMessage('Invalid payment method')
];

const settleExpenseValidation = [
  body('expenseId')
    .isMongoId()
    .withMessage('Valid expense ID is required'),
  
  body('amount')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  
  body('paymentMethod')
    .optional()
    .isIn(['wallet', 'bank_transfer', 'upi', 'cash'])
    .withMessage('Invalid payment method')
];

// @route   POST /api/payments/send-money
// @desc    Send money to another user
// @access  Private
router.post('/send-money', auth, sendMoneyValidation, validate, async (req, res) => {
  try {
    const {
      recipientId,
      amount,
      description,
      paymentMethod = 'wallet',
      metadata
    } = req.body;

    // Validate recipient
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    if (recipientId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send money to yourself'
      });
    }

    // Check sender's balance
    const sender = await User.findById(req.user._id);
    if (sender.walletBalance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    // Create transaction
    const transaction = new Transaction({
      type: 'transfer',
      amount,
      description,
      category: 'Transfer',
      from: {
        user: req.user._id,
        account: 'wallet',
        balanceBefore: sender.walletBalance,
        balanceAfter: sender.walletBalance - amount
      },
      to: {
        user: recipientId,
        account: 'wallet',
        balanceBefore: recipient.walletBalance,
        balanceAfter: recipient.walletBalance + amount
      },
      paymentMethod,
      metadata: {
        ...metadata,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip
      },
      status: 'pending'
    });

    await transaction.save();

    // Process the transaction
    try {
      await transaction.process();
      
      res.status(201).json({
        success: true,
        message: 'Money sent successfully',
        data: { 
          transaction: {
            id: transaction._id,
            reference: transaction.reference,
            amount: transaction.amount,
            recipient: {
              id: recipient._id,
              name: recipient.name,
              email: recipient.email
            },
            status: transaction.status
          }
        }
      });

    } catch (processError) {
      res.status(400).json({
        success: false,
        message: 'Payment processing failed',
        error: processError.message
      });
    }

  } catch (error) {
    console.error('Send money error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send money',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/payments/settle-expense
// @desc    Settle an expense by paying the required amount
// @access  Private
router.post('/settle-expense', auth, settleExpenseValidation, validate, async (req, res) => {
  try {
    const {
      expenseId,
      amount,
      paymentMethod = 'wallet',
      note
    } = req.body;

    // Get expense details
    const expense = await Expense.findById(expenseId)
      .populate('paidBy', 'name email')
      .populate('participants.user', 'name email')
      .populate('group');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if user is a participant
    const userParticipation = expense.participants.find(
      p => p.user._id.toString() === req.user._id.toString()
    );

    if (!userParticipation) {
      return res.status(403).json({
        success: false,
        message: 'You are not a participant in this expense'
      });
    }

    if (userParticipation.settled) {
      return res.status(400).json({
        success: false,
        message: 'Your part of this expense is already settled'
      });
    }

    // Determine settlement amount
    const settlementAmount = amount || userParticipation.amount;

    if (settlementAmount > userParticipation.amount) {
      return res.status(400).json({
        success: false,
        message: 'Settlement amount cannot exceed your share'
      });
    }

    // Check balance for wallet payments
    if (paymentMethod === 'wallet') {
      const user = await User.findById(req.user._id);
      if (user.walletBalance < settlementAmount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient wallet balance'
        });
      }
    }

    // Create settlement transaction
    const transaction = new Transaction({
      type: 'settlement',
      amount: settlementAmount,
      description: `Settlement for: ${expense.title}`,
      category: expense.category,
      from: {
        user: req.user._id,
        account: 'wallet'
      },
      to: {
        user: expense.paidBy._id,
        account: 'wallet'
      },
      relatedExpense: expenseId,
      relatedGroup: expense.group?._id,
      paymentMethod,
      notes: note,
      metadata: {
        settlementType: 'expense',
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip
      },
      status: 'pending'
    });

    await transaction.save();

    // Process the transaction
    try {
      await transaction.process();

      // Update participant settlement status
      if (settlementAmount === userParticipation.amount) {
        userParticipation.settled = true;
        userParticipation.settledAt = new Date();
      }

      // Add to expense settlement history
      if (!expense.settlement.settlements) {
        expense.settlement.settlements = [];
      }

      expense.settlement.settlements.push({
        from: req.user._id,
        to: expense.paidBy._id,
        amount: settlementAmount,
        settledAt: new Date()
      });

      // Check if all participants have settled
      const allSettled = expense.participants.every(p => p.settled || p.user._id.toString() === expense.paidBy._id.toString());
      
      if (allSettled) {
        expense.settlement.isSettled = true;
        expense.settlement.settledAt = new Date();
        expense.status = 'settled';
      }

      await expense.save();

      // Update group balances if it's a group expense
      if (expense.group) {
        await expense.group.calculateBalances();
      }

      res.status(201).json({
        success: true,
        message: 'Expense settled successfully',
        data: { 
          transaction: {
            id: transaction._id,
            reference: transaction.reference,
            amount: transaction.amount,
            status: transaction.status
          },
          expense: {
            id: expense._id,
            isFullySettled: expense.settlement.isSettled,
            userSettled: userParticipation.settled
          }
        }
      });

    } catch (processError) {
      res.status(400).json({
        success: false,
        message: 'Settlement processing failed',
        error: processError.message
      });
    }

  } catch (error) {
    console.error('Settle expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to settle expense',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/payments/settle-group/:groupId
// @desc    Settle all outstanding balances in a group
// @access  Private
router.post('/settle-group/:groupId', auth, groupMemberAuth, async (req, res) => {
  try {
    const group = req.group;
    const { paymentMethod = 'wallet' } = req.body;

    // Get user's balance in the group
    const userMember = group.members.find(
      member => member.user.toString() === req.user._id.toString()
    );

    if (!userMember) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    const userBalance = userMember.balance;

    if (Math.abs(userBalance) < 0.01) {
      return res.status(400).json({
        success: false,
        message: 'No outstanding balance to settle'
      });
    }

    const settlements = [];

    if (userBalance < 0) {
      // User owes money - needs to pay others
      const amountOwed = Math.abs(userBalance);
      
      // Check wallet balance for wallet payments
      if (paymentMethod === 'wallet') {
        const user = await User.findById(req.user._id);
        if (user.walletBalance < amountOwed) {
          return res.status(400).json({
            success: false,
            message: 'Insufficient wallet balance'
          });
        }
      }

      // Find members who are owed money (positive balance)
      const creditors = group.members.filter(member => member.balance > 0);
      
      let remainingOwed = amountOwed;

      for (const creditor of creditors) {
        if (remainingOwed <= 0) break;

        const settlementAmount = Math.min(remainingOwed, creditor.balance);
        
        // Create settlement transaction
        const transaction = new Transaction({
          type: 'settlement',
          amount: settlementAmount,
          description: `Group settlement - ${group.name}`,
          category: 'Settlement',
          from: {
            user: req.user._id,
            account: 'wallet'
          },
          to: {
            user: creditor.user,
            account: 'wallet'
          },
          relatedGroup: group._id,
          paymentMethod,
          metadata: {
            settlementType: 'group',
            userAgent: req.get('User-Agent'),
            ipAddress: req.ip
          },
          status: 'pending'
        });

        await transaction.save();

        try {
          await transaction.process();
          settlements.push({
            to: creditor.user,
            amount: settlementAmount,
            transactionId: transaction._id,
            reference: transaction.reference
          });
          
          remainingOwed -= settlementAmount;
        } catch (processError) {
          console.error('Settlement processing failed:', processError);
        }
      }

    } else {
      // User is owed money - others need to pay user
      return res.status(400).json({
        success: false,
        message: 'You are owed money. Other members need to settle with you.'
      });
    }

    // Add to group settlement history
    group.settlementHistory.push({
      settledBy: req.user._id,
      amount: settlements.reduce((sum, s) => sum + s.amount, 0),
      settledAt: new Date(),
      note: 'Automated group settlement'
    });

    await group.save();

    // Recalculate group balances
    await group.calculateBalances();

    res.json({
      success: true,
      message: `Successfully settled ${settlements.length} payment(s)`,
      data: { settlements }
    });

  } catch (error) {
    console.error('Settle group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to settle group',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/payments/pending-settlements
// @desc    Get user's pending settlements
// @access  Private
router.get('/pending-settlements', auth, async (req, res) => {
  try {
    // Get unsettled expenses where user is a participant
    const unsettledExpenses = await Expense.find({
      'participants.user': req.user._id,
      'participants.settled': false,
      'settlement.isSettled': false,
      paidBy: { $ne: req.user._id } // Exclude expenses paid by the user
    })
    .populate('paidBy', 'name email avatar')
    .populate('group', 'name avatar')
    .sort({ date: -1 });

    // Get group balances where user owes money
    const groups = await Group.find({
      $or: [
        { owner: req.user._id },
        { 'members.user': req.user._id }
      ],
      isActive: true
    })
    .populate('owner', 'name avatar')
    .populate('members.user', 'name avatar');

    const groupsWithDebt = groups.filter(group => {
      const userMember = group.members.find(
        member => member.user._id.toString() === req.user._id.toString()
      );
      return userMember && userMember.balance < -0.01;
    });

    // Calculate totals
    const expenseSettlements = unsettledExpenses.map(expense => {
      const userParticipation = expense.participants.find(
        p => p.user._id.toString() === req.user._id.toString()
      );
      
      return {
        type: 'expense',
        expenseId: expense._id,
        title: expense.title,
        amount: userParticipation.amount,
        payTo: expense.paidBy,
        group: expense.group,
        dueDate: expense.date,
        category: expense.category
      };
    });

    const groupSettlements = groupsWithDebt.map(group => {
      const userMember = group.members.find(
        member => member.user._id.toString() === req.user._id.toString()
      );
      
      return {
        type: 'group',
        groupId: group._id,
        groupName: group.name,
        amount: Math.abs(userMember.balance),
        description: `Outstanding balance in ${group.name}`
      };
    });

    const totalOwed = [
      ...expenseSettlements.map(s => s.amount),
      ...groupSettlements.map(s => s.amount)
    ].reduce((sum, amount) => sum + amount, 0);

    res.json({
      success: true,
      data: {
        expenseSettlements,
        groupSettlements,
        summary: {
          totalOwed,
          expenseCount: expenseSettlements.length,
          groupCount: groupSettlements.length
        }
      }
    });

  } catch (error) {
    console.error('Get pending settlements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending settlements',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/payments/wallet-balance
// @desc    Get user's wallet balance and recent transactions
// @access  Private
router.get('/wallet-balance', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('walletBalance');
    
    // Get recent transactions
    const recentTransactions = await Transaction.find({
      $or: [
        { 'from.user': req.user._id },
        { 'to.user': req.user._id }
      ],
      status: 'completed'
    })
    .populate('from.user', 'name avatar')
    .populate('to.user', 'name avatar')
    .sort({ createdAt: -1 })
    .limit(5);

    res.json({
      success: true,
      data: {
        balance: user.walletBalance,
        recentTransactions: recentTransactions.map(transaction => ({
          id: transaction._id,
          type: transaction.type,
          amount: transaction.amount,
          description: transaction.description,
          from: transaction.from.user,
          to: transaction.to.user,
          date: transaction.createdAt,
          reference: transaction.reference,
          userRole: transaction.from.user._id.toString() === req.user._id.toString() ? 'sender' : 'receiver'
        }))
      }
    });

  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet balance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;