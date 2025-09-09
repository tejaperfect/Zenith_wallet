import express from 'express';
import Expense from '../models/Expense.js';
import Group from '../models/Group.js';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { groupMemberAuth } from '../middleware/authorize.js';
import { createExpenseValidation, validate } from '../middleware/validation.js';

const router = express.Router();

// @route   GET /api/expenses
// @desc    Get user's expenses
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { 
      type = 'all', 
      groupId, 
      category, 
      dateFrom, 
      dateTo, 
      limit = 20, 
      page = 1,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    // Type filter
    if (type === 'personal') {
      filter.type = 'personal';
      filter.paidBy = req.user._id;
    } else if (type === 'group') {
      filter.type = 'group';
      filter.$or = [
        { paidBy: req.user._id },
        { 'participants.user': req.user._id }
      ];
    } else {
      // All expenses - personal or group where user is involved
      filter.$or = [
        { type: 'personal', paidBy: req.user._id },
        { type: 'group', paidBy: req.user._id },
        { type: 'group', 'participants.user': req.user._id }
      ];
    }

    // Group filter
    if (groupId) {
      filter.group = groupId;
    }

    // Category filter
    if (category && category !== 'all') {
      filter.category = category;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = new Date(dateFrom);
      if (dateTo) filter.date.$lte = new Date(dateTo);
    }

    // Sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const expenses = await Expense.find(filter)
      .populate('paidBy', 'name email avatar')
      .populate('participants.user', 'name email avatar')
      .populate('group', 'name avatar')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Expense.countDocuments(filter);

    // Calculate user's involvement in each expense
    const expensesWithUserData = expenses.map(expense => {
      const expenseObj = expense.toObject();
      
      if (expense.type === 'group') {
        const userParticipation = expense.participants.find(
          p => p.user._id.toString() === req.user._id.toString()
        );
        
        expenseObj.userOwes = userParticipation ? userParticipation.amount : 0;
        expenseObj.userPaid = expense.paidBy._id.toString() === req.user._id.toString() ? expense.amount : 0;
        expenseObj.userBalance = expenseObj.userPaid - expenseObj.userOwes;
        expenseObj.isUserPayer = expense.paidBy._id.toString() === req.user._id.toString();
      } else {
        expenseObj.userPaid = expense.amount;
        expenseObj.userOwes = expense.amount;
        expenseObj.userBalance = 0;
        expenseObj.isUserPayer = true;
      }

      return expenseObj;
    });

    res.json({
      success: true,
      data: {
        expenses: expensesWithUserData,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get expenses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/expenses
// @desc    Create a new expense
// @access  Private
router.post('/', auth, createExpenseValidation, validate, async (req, res) => {
  try {
    const {
      title,
      description,
      amount,
      currency,
      category,
      date,
      type,
      groupId,
      splitType = 'equal',
      participants = [],
      tags = [],
      location,
      isRecurring = false,
      recurringPattern
    } = req.body;

    // Validate group membership for group expenses
    if (type === 'group') {
      if (!groupId) {
        return res.status(400).json({
          success: false,
          message: 'Group ID is required for group expenses'
        });
      }

      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({
          success: false,
          message: 'Group not found'
        });
      }

      const isMember = group.members.some(
        member => member.user.toString() === req.user._id.toString() && 
                 member.status === 'active'
      ) || group.owner.toString() === req.user._id.toString();

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: 'You are not a member of this group'
        });
      }
    }

    // Create expense
    const expense = new Expense({
      title,
      description,
      amount,
      currency: currency || 'USD',
      category,
      date: date ? new Date(date) : new Date(),
      paidBy: req.user._id,
      type,
      group: type === 'group' ? groupId : undefined,
      splitType: type === 'group' ? splitType : 'equal',
      tags,
      location,
      isRecurring,
      recurringPattern: isRecurring ? recurringPattern : undefined
    });

    // Handle participants for group expenses
    if (type === 'group' && participants.length > 0) {
      // Validate all participants are group members
      const group = await Group.findById(groupId);
      const validParticipants = participants.filter(participantId => {
        return group.members.some(
          member => member.user.toString() === participantId &&
                   member.status === 'active'
        ) || group.owner.toString() === participantId;
      });

      if (validParticipants.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid participants found'
        });
      }

      // Set up participants based on split type
      expense.participants = validParticipants.map(participantId => ({
        user: participantId,
        amount: 0, // Will be calculated by the model's pre-save middleware
        percentage: splitType === 'equal' ? (100 / validParticipants.length) : 0,
        shares: 1,
        settled: false
      }));
    } else if (type === 'personal') {
      // For personal expenses, only the payer is involved
      expense.participants = [{
        user: req.user._id,
        amount: amount,
        percentage: 100,
        shares: 1,
        settled: true
      }];
    }

    await expense.save();

    // Update group's total expenses
    if (type === 'group') {
      await Group.findByIdAndUpdate(groupId, {
        $inc: { totalExpenses: amount },
        lastActivity: new Date()
      });

      // Recalculate group balances
      const group = await Group.findById(groupId);
      await group.calculateBalances();
    }

    const populatedExpense = await Expense.findById(expense._id)
      .populate('paidBy', 'name email avatar')
      .populate('participants.user', 'name email avatar')
      .populate('group', 'name avatar');

    res.status(201).json({
      success: true,
      message: 'Expense created successfully',
      data: { expense: populatedExpense }
    });

  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create expense',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/expenses/:expenseId
// @desc    Get expense details
// @access  Private
router.get('/:expenseId', auth, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.expenseId)
      .populate('paidBy', 'name email avatar')
      .populate('participants.user', 'name email avatar')
      .populate('group', 'name avatar members')
      .populate('notes.user', 'name avatar');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if user has access to this expense
    const hasAccess = expense.paidBy._id.toString() === req.user._id.toString() ||
                     expense.participants.some(p => p.user._id.toString() === req.user._id.toString()) ||
                     (expense.type === 'group' && expense.group && (
                       expense.group.owner?.toString() === req.user._id.toString() ||
                       expense.group.members?.some(m => m.user?.toString() === req.user._id.toString())
                     ));

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { expense }
    });

  } catch (error) {
    console.error('Get expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get expense details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/expenses/:expenseId
// @desc    Update expense
// @access  Private (Expense creator only)
router.put('/:expenseId', auth, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.expenseId);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Only expense creator can update
    if (expense.paidBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only expense creator can update this expense'
      });
    }

    // Prevent updates if expense is settled
    if (expense.settlement.isSettled) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update settled expense'
      });
    }

    const allowedUpdates = ['title', 'description', 'amount', 'category', 'date', 'tags', 'location'];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid updates provided'
      });
    }

    // If amount is being updated, recalculate splits
    if (updates.amount) {
      const oldAmount = expense.amount;
      expense.amount = updates.amount;
      expense.calculateSplits();
      
      // Update group total expenses
      if (expense.type === 'group') {
        const amountDifference = updates.amount - oldAmount;
        await Group.findByIdAndUpdate(expense.group, {
          $inc: { totalExpenses: amountDifference },
          lastActivity: new Date()
        });
      }
    }

    Object.assign(expense, updates);
    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('paidBy', 'name email avatar')
      .populate('participants.user', 'name email avatar')
      .populate('group', 'name avatar');

    res.json({
      success: true,
      message: 'Expense updated successfully',
      data: { expense: populatedExpense }
    });

  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update expense',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/expenses/:expenseId
// @desc    Delete expense
// @access  Private (Expense creator only)
router.delete('/:expenseId', auth, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.expenseId);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Only expense creator can delete
    if (expense.paidBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only expense creator can delete this expense'
      });
    }

    // Prevent deletion if expense is settled
    if (expense.settlement.isSettled) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete settled expense'
      });
    }

    // Update group total expenses
    if (expense.type === 'group') {
      await Group.findByIdAndUpdate(expense.group, {
        $inc: { totalExpenses: -expense.amount },
        lastActivity: new Date()
      });
    }

    await Expense.findByIdAndDelete(req.params.expenseId);

    res.json({
      success: true,
      message: 'Expense deleted successfully'
    });

  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete expense',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/expenses/:expenseId/notes
// @desc    Add note to expense
// @access  Private
router.post('/:expenseId/notes', auth, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Note content is required'
      });
    }

    const expense = await Expense.findById(req.params.expenseId);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Check if user has access to this expense
    const hasAccess = expense.paidBy.toString() === req.user._id.toString() ||
                     expense.participants.some(p => p.user.toString() === req.user._id.toString());

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    expense.notes.push({
      user: req.user._id,
      content: content.trim(),
      createdAt: new Date()
    });

    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('notes.user', 'name avatar');

    res.status(201).json({
      success: true,
      message: 'Note added successfully',
      data: { notes: populatedExpense.notes }
    });

  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add note',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/expenses/:expenseId/settle
// @desc    Mark expense as settled
// @access  Private (Group admin only for group expenses)
router.post('/:expenseId/settle', auth, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.expenseId)
      .populate('group');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // For group expenses, check admin permissions
    if (expense.type === 'group') {
      const group = expense.group;
      const isOwner = group.owner.toString() === req.user._id.toString();
      const member = group.members.find(m => m.user.toString() === req.user._id.toString());
      const isAdmin = member && member.role === 'admin';

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only group admins can settle expenses'
        });
      }
    } else {
      // For personal expenses, only the creator can settle
      if (expense.paidBy.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Only expense creator can settle this expense'
        });
      }
    }

    if (expense.settlement.isSettled) {
      return res.status(400).json({
        success: false,
        message: 'Expense is already settled'
      });
    }

    // Mark all participants as settled
    expense.participants.forEach(participant => {
      participant.settled = true;
      participant.settledAt = new Date();
    });

    expense.settlement = {
      isSettled: true,
      settledAt: new Date(),
      settledBy: req.user._id,
      settlements: [] // This would contain actual settlement transactions
    };

    expense.status = 'settled';
    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('paidBy', 'name email avatar')
      .populate('participants.user', 'name email avatar')
      .populate('settlement.settledBy', 'name avatar');

    res.json({
      success: true,
      message: 'Expense settled successfully',
      data: { expense: populatedExpense }
    });

  } catch (error) {
    console.error('Settle expense error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to settle expense',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/expenses/group/:groupId/summary
// @desc    Get expense summary for a specific group
// @access  Private (Group member only)
router.get('/group/:groupId/summary', auth, async (req, res) => {
  try {
    const groupId = req.params.groupId;
    
    // Verify user is group member
    const Group = (await import('../models/Group.js')).default;
    const group = await Group.findById(groupId);
    
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const isMember = group.members.some(
      member => member.user.toString() === req.user._id.toString() && 
               member.status === 'active'
    ) || group.owner.toString() === req.user._id.toString();

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    const expenses = await Expense.find({
      group: groupId,
      type: 'group'
    }).populate('paidBy', 'name email avatar')
      .populate('participants.user', 'name email avatar');

    // Calculate summary statistics
    const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const userTotalPaid = expenses
      .filter(expense => expense.paidBy._id.toString() === req.user._id.toString())
      .reduce((sum, expense) => sum + expense.amount, 0);
    
    const userTotalOwed = expenses.reduce((sum, expense) => {
      const userParticipation = expense.participants.find(
        p => p.user._id.toString() === req.user._id.toString()
      );
      return sum + (userParticipation ? userParticipation.amount : 0);
    }, 0);

    const userBalance = userTotalPaid - userTotalOwed;

    // Category breakdown
    const categoryBreakdown = expenses.reduce((acc, expense) => {
      acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
      return acc;
    }, {});

    // Recent expenses (last 5)
    const recentExpenses = expenses
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
      .map(expense => {
        const userParticipation = expense.participants.find(
          p => p.user._id.toString() === req.user._id.toString()
        );
        
        return {
          _id: expense._id,
          title: expense.title,
          amount: expense.amount,
          category: expense.category,
          date: expense.date,
          paidBy: expense.paidBy,
          userOwes: userParticipation ? userParticipation.amount : 0,
          isUserPayer: expense.paidBy._id.toString() === req.user._id.toString()
        };
      });

    res.json({
      success: true,
      data: {
        summary: {
          totalExpenses,
          expenseCount: expenses.length,
          userTotalPaid,
          userTotalOwed,
          userBalance,
          averageExpense: expenses.length ? totalExpenses / expenses.length : 0
        },
        categoryBreakdown,
        recentExpenses
      }
    });

  } catch (error) {
    console.error('Get group expense summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get expense summary',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/expenses/:expenseId/split
// @desc    Update expense split details
// @access  Private (Expense creator only)
router.post('/:expenseId/split', auth, async (req, res) => {
  try {
    const { splitType, participants, customSplits } = req.body;
    
    const expense = await Expense.findById(req.params.expenseId);
    
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    // Only expense creator can update splits
    if (expense.paidBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only expense creator can update split details'
      });
    }

    // Prevent updates if expense is settled
    if (expense.settlement.isSettled) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update settled expense'
      });
    }

    // Validate split type
    if (!['equal', 'percentage', 'custom', 'shares'].includes(splitType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid split type'
      });
    }

    // Update split type and participants
    expense.splitType = splitType;
    expense.participants = [];

    // For group expenses, verify all participants are group members
    if (expense.type === 'group' && expense.group) {
      const Group = (await import('../models/Group.js')).default;
      const group = await Group.findById(expense.group);
      
      const validParticipants = participants.filter(participantId => {
        return group.members.some(
          member => member.user.toString() === participantId &&
                   member.status === 'active'
        ) || group.owner.toString() === participantId;
      });

      if (validParticipants.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid participants found'
        });
      }

      // Set up participants
      if (splitType === 'custom' && customSplits) {
        // Custom split with predefined amounts/percentages
        expense.participants = validParticipants.map(participantId => {
          const customSplit = customSplits.find(s => s.userId === participantId);
          return {
            user: participantId,
            amount: customSplit?.amount || 0,
            percentage: customSplit?.percentage || 0,
            shares: customSplit?.shares || 1,
            settled: false
          };
        });
      } else {
        // Equal, percentage, or shares split
        expense.participants = validParticipants.map(participantId => ({
          user: participantId,
          amount: 0, // Will be calculated by model middleware
          percentage: splitType === 'equal' ? (100 / validParticipants.length) : 0,
          shares: 1,
          settled: false
        }));
      }
    }

    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
      .populate('paidBy', 'name email avatar')
      .populate('participants.user', 'name email avatar')
      .populate('group', 'name avatar');

    res.json({
      success: true,
      message: 'Expense split updated successfully',
      data: { expense: populatedExpense }
    });

  } catch (error) {
    console.error('Update expense split error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update expense split',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;