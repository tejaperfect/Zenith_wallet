import express from 'express';
import Group from '../models/Group.js';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { groupOwnerAuth, groupMemberAuth, groupAdminAuth } from '../middleware/authorize.js';
import { createGroupValidation, updateGroupValidation, joinRequestValidation, processJoinRequestValidation, validate } from '../middleware/validation.js';

const router = express.Router();

// Helper function to generate join code
const generateJoinCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// @route   GET /api/groups
// @desc    Get user's groups
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { status = 'active', limit = 20, page = 1 } = req.query;

    const filter = {
      $and: [
        { isActive: true },
        {
          $or: [
            { owner: req.user._id },
            { 'members.user': req.user._id, 'members.status': 'active' }
          ]
        }
      ]
    };

    const groups = await Group.find(filter)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar')
      .sort({ lastActivity: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    // Calculate user's balance in each group
    const groupsWithBalance = groups.map(group => {
      const groupObj = group.toObject();
      const userMember = group.members.find(
        member => member.user._id.toString() === req.user._id.toString()
      );
      
      groupObj.userBalance = userMember ? userMember.balance : 0;
      groupObj.userRole = group.owner._id.toString() === req.user._id.toString() 
        ? 'owner' 
        : (userMember ? userMember.role : 'member');
      
      return groupObj;
    });

    const total = await Group.countDocuments(filter);

    res.json({
      success: true,
      data: {
        groups: groupsWithBalance,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get groups',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/groups
// @desc    Create a new group
// @access  Private
router.post('/', auth, createGroupValidation, validate, async (req, res) => {
  try {
    const { name, description, currency, privacy, category, members = [] } = req.body;

    // Create the group
    const group = new Group({
      name,
      description,
      currency,
      privacy,
      category,
      owner: req.user._id,
      joinCode: privacy === 'public' ? generateJoinCode() : undefined,
      members: [{
        user: req.user._id,
        role: 'admin',
        joinedAt: new Date(),
        status: 'active'
      }]
    });

    // Add invited members
    if (members.length > 0) {
      // Check member limit
      const totalMembers = 1 + members.length; // 1 for owner + invited members
      if (group.settings.memberLimit && totalMembers > group.settings.memberLimit) {
        return res.status(400).json({
          success: false,
          message: `Cannot add members. Group limit is ${group.settings.memberLimit} members.`,
          data: {
            memberLimit: group.settings.memberLimit,
            requestedMembers: totalMembers
          }
        });
      }
      
      const validMembers = await User.find({
        _id: { $in: members },
        isActive: true
      });

      validMembers.forEach(member => {
        if (member._id.toString() !== req.user._id.toString()) {
          group.members.push({
            user: member._id,
            role: 'member',
            joinedAt: new Date(),
            status: 'active'
          });
        }
      });
    }

    await group.save();

    // Add group to user's groups
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { groups: group._id }
    });

    // Add group to invited members' groups
    if (members.length > 0) {
      await User.updateMany(
        { _id: { $in: members } },
        { $addToSet: { groups: group._id } }
      );
    }

    const populatedGroup = await Group.findById(group._id)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar');

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: { group: populatedGroup }
    });

  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create group',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/groups/:groupId
// @desc    Get group details
// @access  Private
router.get('/:groupId', auth, groupMemberAuth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar')
      .populate('settlements.from', 'name avatar')
      .populate('settlements.to', 'name avatar');

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const groupObj = group.toObject();
    const userMember = group.members.find(
      member => member.user._id.toString() === req.user._id.toString()
    );
    
    groupObj.userBalance = userMember ? userMember.balance : 0;
    groupObj.userRole = group.owner._id.toString() === req.user._id.toString() 
      ? 'owner' 
      : (userMember ? userMember.role : 'member');

    res.json({
      success: true,
      data: { group: groupObj }
    });

  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get group details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/groups/:groupId
// @desc    Update group details
// @access  Private (Group admin only)
router.put('/:groupId', auth, groupAdminAuth, updateGroupValidation, validate, async (req, res) => {
  try {
    const allowedUpdates = ['name', 'description', 'currency', 'privacy', 'category', 'settings'];
    
    const updates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // If changing to public, generate join code
    if (updates.privacy === 'public' && req.group.privacy === 'private') {
      updates.joinCode = generateJoinCode();
    }

    // If changing to private, remove join code
    if (updates.privacy === 'private' && req.group.privacy === 'public') {
      updates.joinCode = undefined;
    }

    const group = await Group.findByIdAndUpdate(
      req.params.groupId,
      { ...updates, lastActivity: new Date() },
      { new: true, runValidators: true }
    )
    .populate('owner', 'name email avatar')
    .populate('members.user', 'name email avatar');

    res.json({
      success: true,
      message: 'Group updated successfully',
      data: { group }
    });

  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update group',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/groups/:groupId
// @desc    Delete group
// @access  Private (Group owner only)
router.delete('/:groupId', auth, groupOwnerAuth, async (req, res) => {
  try {
    const group = req.group;

    // Check if group has unsettled expenses
    const Expense = (await import('../models/Expense.js')).default;
    const unsettledExpenses = await Expense.countDocuments({
      group: group._id,
      'settlement.isSettled': false
    });

    if (unsettledExpenses > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete group with unsettled expenses'
      });
    }

    // Remove group from all members' groups array
    await User.updateMany(
      { groups: group._id },
      { $pull: { groups: group._id } }
    );

    // Mark group as inactive instead of deleting
    group.isActive = false;
    await group.save();

    res.json({
      success: true,
      message: 'Group deleted successfully'
    });

  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete group',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/groups/:groupId/invite
// @desc    Invite members to group
// @access  Private (Group admin only)
router.post('/:groupId/invite', auth, groupAdminAuth, async (req, res) => {
  try {
    const { emails = [], phones = [], userIds = [] } = req.body;
    const group = req.group;

    if (emails.length === 0 && phones.length === 0 && userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one email, phone, or user ID is required'
      });
    }

    const invitations = [];

    // Process email invitations
    for (const email of emails) {
      const existingUser = await User.findOne({ email });
      
      if (existingUser) {
        // Check if already a member
        const isMember = group.members.some(
          member => member.user.toString() === existingUser._id.toString()
        );

        if (!isMember) {
          group.members.push({
            user: existingUser._id,
            role: 'member',
            joinedAt: new Date(),
            status: 'active'
          });

          await User.findByIdAndUpdate(existingUser._id, {
            $addToSet: { groups: group._id }
          });

          invitations.push({
            type: 'existing_user',
            email,
            userId: existingUser._id,
            status: 'accepted'
          });
        }
      } else {
        // Add to pending invitations
        group.invitations.push({
          email,
          invitedBy: req.user._id,
          status: 'pending'
        });

        invitations.push({
          type: 'new_user',
          email,
          status: 'pending'
        });
      }
    }

    // Process direct user invitations
    if (userIds.length > 0) {
      const users = await User.find({
        _id: { $in: userIds },
        isActive: true
      });

      for (const user of users) {
        const isMember = group.members.some(
          member => member.user.toString() === user._id.toString()
        );

        if (!isMember) {
          group.members.push({
            user: user._id,
            role: 'member',
            joinedAt: new Date(),
            status: 'active'
          });

          await User.findByIdAndUpdate(user._id, {
            $addToSet: { groups: group._id }
          });

          invitations.push({
            type: 'existing_user',
            userId: user._id,
            email: user.email,
            status: 'accepted'
          });
        }
      }
    }

    group.lastActivity = new Date();
    await group.save();

    res.json({
      success: true,
      message: `${invitations.length} invitation(s) sent successfully`,
      data: { invitations }
    });

  } catch (error) {
    console.error('Invite members error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to invite members',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/groups/join/:joinCode
// @desc    Join group by join code
// @access  Private
router.post('/join/:joinCode', auth, async (req, res) => {
  try {
    const { joinCode } = req.params;

    // Enhanced validation for join code format
    if (!joinCode || joinCode.length < 6 || joinCode.length > 12) {
      return res.status(400).json({
        success: false,
        message: 'Invalid join code format'
      });
    }

    const group = await Group.findOne({
      joinCode: joinCode.toUpperCase(),
      privacy: 'public',
      isActive: true
    }).populate('owner', 'name email avatar');

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Invalid join code or group not found. Please check the code and try again.'
      });
    }

    // Check if user is already a member
    const isMember = group.members.some(
      member => member.user.toString() === req.user._id.toString()
    );

    if (isMember) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this group',
        data: { alreadyMember: true }
      });
    }

    // Check if user is the owner
    if (group.owner._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You are the owner of this group'
      });
    }

    // Check member limit
    if (group.settings.memberLimit && group.members.length >= group.settings.memberLimit) {
      return res.status(400).json({
        success: false,
        message: 'Group has reached its member limit',
        data: { 
          memberLimit: group.settings.memberLimit, 
          currentMembers: group.members.length 
        }
      });
    }

    // Add user to group
    group.members.push({
      user: req.user._id,
      role: 'member',
      joinedAt: new Date(),
      status: 'active'
    });

    group.lastActivity = new Date();
    await group.save();

    // Add group to user's groups
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { groups: group._id }
    });

    const populatedGroup = await Group.findById(group._id)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar');

    res.json({
      success: true,
      message: `Successfully joined "${group.name}"!`,
      data: { 
        group: populatedGroup,
        joinedAt: new Date(),
        memberCount: populatedGroup.members.length
      }
    });

  } catch (error) {
    console.error('Join group error:', error);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate join request'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to join group. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/groups/:groupId/request-join
// @desc    Request to join a private group
// @access  Private
router.post('/:groupId/request-join', auth, joinRequestValidation, validate, async (req, res) => {
  try {
    const { message } = req.body;
    const group = await Group.findById(req.params.groupId)
      .populate('owner', 'name email avatar');

    if (!group || !group.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if group is private
    if (group.privacy !== 'private') {
      return res.status(400).json({
        success: false,
        message: 'This group allows direct joining. Use the join code instead.'
      });
    }

    // Check if user is already a member
    const isMember = group.members.some(
      member => member.user.toString() === req.user._id.toString()
    );

    if (isMember) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this group'
      });
    }

    // Check if user is the owner
    if (group.owner._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You are the owner of this group'
      });
    }

    // Check if request already exists
    const existingRequest = group.joinRequests?.find(
      request => request.user.toString() === req.user._id.toString() && 
                request.status === 'pending'
    );

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending join request for this group'
      });
    }

    // Check member limit
    if (group.settings.memberLimit && group.members.length >= group.settings.memberLimit) {
      return res.status(400).json({
        success: false,
        message: 'Group has reached its member limit'
      });
    }

    // Add join request
    if (!group.joinRequests) {
      group.joinRequests = [];
    }

    group.joinRequests.push({
      user: req.user._id,
      message: message || '',
      requestedAt: new Date(),
      status: 'pending'
    });

    group.lastActivity = new Date();
    await group.save();

    res.json({
      success: true,
      message: 'Join request sent successfully. The group admin will review your request.',
      data: {
        groupName: group.name,
        requestId: group.joinRequests[group.joinRequests.length - 1]._id,
        requestedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Request join group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send join request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/groups/:groupId/approve-join/:requestId
// @desc    Approve or reject join request
// @access  Private (Group admin only)
router.post('/:groupId/approve-join/:requestId', auth, groupAdminAuth, processJoinRequestValidation, validate, async (req, res) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const { requestId } = req.params;
    const group = req.group;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "approve" or "reject"'
      });
    }

    const joinRequest = group.joinRequests?.find(
      request => request._id.toString() === requestId && request.status === 'pending'
    );

    if (!joinRequest) {
      return res.status(404).json({
        success: false,
        message: 'Join request not found or already processed'
      });
    }

    if (action === 'approve') {
      // Check member limit again
      if (group.settings.memberLimit && group.members.length >= group.settings.memberLimit) {
        return res.status(400).json({
          success: false,
          message: 'Group has reached its member limit'
        });
      }

      // Add user to group
      group.members.push({
        user: joinRequest.user,
        role: 'member',
        joinedAt: new Date(),
        status: 'active'
      });

      // Add group to user's groups
      await User.findByIdAndUpdate(joinRequest.user, {
        $addToSet: { groups: group._id }
      });

      joinRequest.status = 'approved';
      joinRequest.processedAt = new Date();
      joinRequest.processedBy = req.user._id;

      group.lastActivity = new Date();
      await group.save();

      res.json({
        success: true,
        message: 'Join request approved successfully',
        data: {
          newMemberCount: group.members.length,
          approvedAt: new Date()
        }
      });
    } else {
      // Reject request
      joinRequest.status = 'rejected';
      joinRequest.processedAt = new Date();
      joinRequest.processedBy = req.user._id;

      await group.save();

      res.json({
        success: true,
        message: 'Join request rejected'
      });
    }

  } catch (error) {
    console.error('Process join request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process join request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/groups/:groupId/join-requests
// @desc    Get pending join requests for group
// @access  Private (Group admin only)
router.get('/:groupId/join-requests', auth, groupAdminAuth, async (req, res) => {
  try {
    const group = req.group;
    
    const joinRequests = await Group.findById(group._id)
      .populate({
        path: 'joinRequests.user',
        select: 'name email avatar'
      })
      .populate({
        path: 'joinRequests.processedBy',
        select: 'name email'
      })
      .select('joinRequests');

    const pendingRequests = joinRequests.joinRequests?.filter(
      request => request.status === 'pending'
    ) || [];

    const processedRequests = joinRequests.joinRequests?.filter(
      request => request.status !== 'pending'
    ).slice(-10) || []; // Last 10 processed requests

    res.json({
      success: true,
      data: {
        pending: pendingRequests,
        recent: processedRequests,
        totalPending: pendingRequests.length
      }
    });

  } catch (error) {
    console.error('Get join requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get join requests',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// @desc    Leave group
// @access  Private
router.post('/:groupId/leave', auth, groupMemberAuth, async (req, res) => {
  try {
    const group = req.group;

    // Group owner cannot leave, must transfer ownership first
    if (group.owner.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Group owner cannot leave. Transfer ownership first or delete the group.'
      });
    }

    // Check if user has unsettled balances
    const member = group.members.find(
      member => member.user.toString() === req.user._id.toString()
    );

    if (member && Math.abs(member.balance) > 0.01) {
      return res.status(400).json({
        success: false,
        message: 'Cannot leave group with unsettled balances. Please settle all expenses first.'
      });
    }

    // Remove user from group members
    group.members = group.members.filter(
      member => member.user.toString() !== req.user._id.toString()
    );

    group.lastActivity = new Date();
    await group.save();

    // Remove group from user's groups
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { groups: group._id }
    });

    res.json({
      success: true,
      message: 'Successfully left the group'
    });

  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave group',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/groups/public/search
// @desc    Search public groups
// @access  Private
router.get('/public/search', auth, async (req, res) => {
  try {
    const { q, category, limit = 20, page = 1 } = req.query;

    const filter = {
      privacy: 'public',
      isActive: true
    };

    if (q) {
      const searchRegex = new RegExp(q.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { description: searchRegex }
      ];
    }

    if (category && category !== 'all') {
      filter.category = category;
    }

    const groups = await Group.find(filter)
      .populate('owner', 'name avatar')
      .select('name description category totalExpenses members avatar lastActivity joinCode')
      .sort({ lastActivity: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Group.countDocuments(filter);

    res.json({
      success: true,
      data: {
        groups: groups.map(group => ({
          ...group.toObject(),
          memberCount: group.members.length
        })),
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Search public groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search public groups',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/groups/:groupId/expenses
// @desc    Get group expenses
// @access  Private (Group member only)
router.get('/:groupId/expenses', auth, groupMemberAuth, async (req, res) => {
  try {
    const { 
      category, 
      dateFrom, 
      dateTo, 
      limit = 20, 
      page = 1,
      sortBy = 'date',
      sortOrder = 'desc',
      status = 'all'
    } = req.query;

    const filter = {
      group: req.params.groupId,
      type: 'group'
    };

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

    // Status filter
    if (status !== 'all') {
      filter.status = status;
    }

    // Sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const Expense = (await import('../models/Expense.js')).default;
    const expenses = await Expense.find(filter)
      .populate('paidBy', 'name email avatar')
      .populate('participants.user', 'name email avatar')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Expense.countDocuments(filter);

    // Calculate user's involvement in each expense
    const expensesWithUserData = expenses.map(expense => {
      const expenseObj = expense.toObject();
      
      const userParticipation = expense.participants.find(
        p => p.user._id.toString() === req.user._id.toString()
      );
      
      expenseObj.userOwes = userParticipation ? userParticipation.amount : 0;
      expenseObj.userPaid = expense.paidBy._id.toString() === req.user._id.toString() ? expense.amount : 0;
      expenseObj.userBalance = expenseObj.userPaid - expenseObj.userOwes;
      expenseObj.isUserPayer = expense.paidBy._id.toString() === req.user._id.toString();

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
    console.error('Get group expenses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get group expenses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/groups/:groupId/balances
// @desc    Get group balances and settlement information
// @access  Private (Group member only)
router.get('/:groupId/balances', auth, groupMemberAuth, async (req, res) => {
  try {
    const group = req.group;
    await group.calculateBalances();

    // Get settlement suggestions
    const membersWithBalance = group.members.filter(member => Math.abs(member.balance) > 0.01);
    const creditors = membersWithBalance.filter(member => member.balance > 0).sort((a, b) => b.balance - a.balance);
    const debtors = membersWithBalance.filter(member => member.balance < 0).sort((a, b) => a.balance - b.balance);

    // Calculate optimal settlements
    const settlements = [];
    let i = 0, j = 0;
    
    while (i < creditors.length && j < debtors.length) {
      const creditor = creditors[i];
      const debtor = debtors[j];
      
      const settlementAmount = Math.min(creditor.balance, Math.abs(debtor.balance));
      
      settlements.push({
        from: debtor.user,
        to: creditor.user,
        amount: settlementAmount
      });
      
      creditor.balance -= settlementAmount;
      debtor.balance += settlementAmount;
      
      if (Math.abs(creditor.balance) < 0.01) i++;
      if (Math.abs(debtor.balance) < 0.01) j++;
    }

    // Get recent settlements
    const recentSettlements = group.settlements.slice(-10).reverse();

    res.json({
      success: true,
      data: {
        members: group.members.map(member => ({
          user: member.user,
          balance: member.balance,
          totalPaid: member.totalPaid,
          totalOwed: member.totalOwed,
          status: member.status
        })),
        suggestedSettlements: settlements,
        recentSettlements,
        summary: {
          totalExpenses: group.totalExpenses,
          settledAmount: recentSettlements.reduce((sum, s) => sum + s.amount, 0),
          pendingSettlements: settlements.length
        }
      }
    });

  } catch (error) {
    console.error('Get group balances error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get group balances',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/groups/:groupId/settle
// @desc    Record a settlement between group members
// @access  Private (Group member only)
router.post('/:groupId/settle', auth, groupMemberAuth, async (req, res) => {
  try {
    const { toUserId, amount, note } = req.body;
    const group = req.group;

    if (!toUserId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid settlement data'
      });
    }

    // Verify both users are group members
    const fromMember = group.members.find(m => m.user.toString() === req.user._id.toString());
    const toMember = group.members.find(m => m.user.toString() === toUserId);

    if (!fromMember || !toMember) {
      return res.status(400).json({
        success: false,
        message: 'Both users must be group members'
      });
    }

    // Add settlement record
    group.settlements.push({
      from: req.user._id,
      to: toUserId,
      amount,
      settledAt: new Date(),
      note: note || ''
    });

    // Update member balances
    fromMember.balance += amount;
    toMember.balance -= amount;

    group.lastActivity = new Date();
    await group.save();

    res.json({
      success: true,
      message: 'Settlement recorded successfully',
      data: {
        settlement: group.settlements[group.settlements.length - 1]
      }
    });

  } catch (error) {
    console.error('Record settlement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record settlement',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/groups/:groupId/analytics
// @desc    Get group expense analytics
// @access  Private (Group member only)
router.get('/:groupId/analytics', auth, groupMemberAuth, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const group = req.group;

    // Calculate date range
    const now = new Date();
    const periodDays = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365
    };
    
    const startDate = new Date(now.getTime() - (periodDays[period] || 30) * 24 * 60 * 60 * 1000);

    const Expense = (await import('../models/Expense.js')).default;
    const expenses = await Expense.find({
      group: group._id,
      date: { $gte: startDate }
    }).populate('paidBy', 'name');

    // Category breakdown
    const categoryBreakdown = expenses.reduce((acc, expense) => {
      acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
      return acc;
    }, {});

    // Monthly trends (for longer periods)
    const monthlyTrends = expenses.reduce((acc, expense) => {
      const month = expense.date.toISOString().substring(0, 7); // YYYY-MM
      acc[month] = (acc[month] || 0) + expense.amount;
      return acc;
    }, {});

    // Top spenders
    const spenderBreakdown = expenses.reduce((acc, expense) => {
      const spenderId = expense.paidBy._id.toString();
      const spenderName = expense.paidBy.name;
      if (!acc[spenderId]) {
        acc[spenderId] = { name: spenderName, amount: 0, count: 0 };
      }
      acc[spenderId].amount += expense.amount;
      acc[spenderId].count += 1;
      return acc;
    }, {});

    const topSpenders = Object.values(spenderBreakdown)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    res.json({
      success: true,
      data: {
        period,
        summary: {
          totalExpenses: expenses.reduce((sum, e) => sum + e.amount, 0),
          expenseCount: expenses.length,
          averageExpense: expenses.length ? expenses.reduce((sum, e) => sum + e.amount, 0) / expenses.length : 0,
          averagePerMember: expenses.length ? expenses.reduce((sum, e) => sum + e.amount, 0) / group.members.length : 0
        },
        categoryBreakdown,
        monthlyTrends,
        topSpenders
      }
    });

  } catch (error) {
    console.error('Get group analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get group analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/groups/:groupId/generate-code
// @desc    Generate new join code for group
// @access  Private (Group admin only)
router.post('/:groupId/generate-code', auth, groupAdminAuth, async (req, res) => {
  try {
    const group = req.group;
    
    if (group.privacy === 'private') {
      return res.status(400).json({
        success: false,
        message: 'Cannot generate join code for private groups'
      });
    }

    group.joinCode = generateJoinCode();
    await group.save();

    res.json({
      success: true,
      message: 'New join code generated successfully',
      data: { joinCode: group.joinCode }
    });

  } catch (error) {
    console.error('Generate join code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate join code',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/groups/:groupId/join-code
// @desc    Disable join code for group
// @access  Private (Group admin only)
router.delete('/:groupId/join-code', auth, groupAdminAuth, async (req, res) => {
  try {
    const group = req.group;
    
    group.joinCode = undefined;
    await group.save();

    res.json({
      success: true,
      message: 'Join code disabled successfully'
    });

  } catch (error) {
    console.error('Disable join code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disable join code',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;