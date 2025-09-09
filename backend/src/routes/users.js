import express from 'express';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { updateProfileValidation, validate } from '../middleware/validation.js';

const router = express.Router();

// @route   GET /api/users/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('groups', 'name avatar totalExpenses memberCount')
      .select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', auth, updateProfileValidation, validate, async (req, res) => {
  try {
    const allowedUpdates = [
      'name', 'phone', 'dateOfBirth', 'address', 'preferences', 'avatar'
    ];
    
    const updates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/users/upi-accounts
// @desc    Add UPI account
// @access  Private
router.post('/upi-accounts', auth, async (req, res) => {
  try {
    const { id, name, provider } = req.body;

    if (!id || !name || !provider) {
      return res.status(400).json({
        success: false,
        message: 'UPI ID, name, and provider are required'
      });
    }

    const user = await User.findById(req.user._id);

    // Check if UPI ID already exists
    const existingUPI = user.upiAccounts.find(account => account.id === id);
    if (existingUPI) {
      return res.status(400).json({
        success: false,
        message: 'UPI ID already exists'
      });
    }

    // If this is the first UPI account, make it default
    const isDefault = user.upiAccounts.length === 0;

    user.upiAccounts.push({
      id,
      name,
      provider,
      isDefault
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'UPI account added successfully',
      data: { upiAccounts: user.upiAccounts }
    });

  } catch (error) {
    console.error('Add UPI account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add UPI account',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/users/upi-accounts/:upiId
// @desc    Update UPI account
// @access  Private
router.put('/upi-accounts/:upiId', auth, async (req, res) => {
  try {
    const { upiId } = req.params;
    const { name, provider, isDefault } = req.body;

    const user = await User.findById(req.user._id);
    const upiAccount = user.upiAccounts.id(upiId);

    if (!upiAccount) {
      return res.status(404).json({
        success: false,
        message: 'UPI account not found'
      });
    }

    // Update fields
    if (name) upiAccount.name = name;
    if (provider) upiAccount.provider = provider;

    // Handle default setting
    if (isDefault === true) {
      user.upiAccounts.forEach(account => {
        account.isDefault = account._id.toString() === upiId;
      });
    }

    await user.save();

    res.json({
      success: true,
      message: 'UPI account updated successfully',
      data: { upiAccounts: user.upiAccounts }
    });

  } catch (error) {
    console.error('Update UPI account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update UPI account',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/users/upi-accounts/:upiId
// @desc    Delete UPI account
// @access  Private
router.delete('/upi-accounts/:upiId', auth, async (req, res) => {
  try {
    const { upiId } = req.params;

    const user = await User.findById(req.user._id);
    const upiAccount = user.upiAccounts.id(upiId);

    if (!upiAccount) {
      return res.status(404).json({
        success: false,
        message: 'UPI account not found'
      });
    }

    const wasDefault = upiAccount.isDefault;
    user.upiAccounts.pull(upiId);

    // If deleted account was default, make first remaining account default
    if (wasDefault && user.upiAccounts.length > 0) {
      user.upiAccounts[0].isDefault = true;
    }

    await user.save();

    res.json({
      success: true,
      message: 'UPI account deleted successfully',
      data: { upiAccounts: user.upiAccounts }
    });

  } catch (error) {
    console.error('Delete UPI account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete UPI account',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/users/bank-accounts
// @desc    Add bank account
// @access  Private
router.post('/bank-accounts', auth, async (req, res) => {
  try {
    const { accountNumber, bankName, accountHolderName, ifscCode, accountType } = req.body;

    if (!accountNumber || !bankName || !accountHolderName || !ifscCode) {
      return res.status(400).json({
        success: false,
        message: 'All bank account fields are required'
      });
    }

    const user = await User.findById(req.user._id);

    // Check if account already exists
    const existingAccount = user.bankAccounts.find(
      account => account.accountNumber === accountNumber
    );
    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: 'Bank account already exists'
      });
    }

    // If this is the first bank account, make it default
    const isDefault = user.bankAccounts.length === 0;

    user.bankAccounts.push({
      accountNumber,
      bankName,
      accountHolderName,
      ifscCode,
      accountType: accountType || 'savings',
      isDefault
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Bank account added successfully',
      data: { bankAccounts: user.bankAccounts }
    });

  } catch (error) {
    console.error('Add bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add bank account',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/users/search
// @desc    Search users by name or email
// @access  Private
router.get('/search', auth, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const searchRegex = new RegExp(q.trim(), 'i');
    
    const users = await User.find({
      $and: [
        { _id: { $ne: req.user._id } }, // Exclude current user
        { isActive: true },
        {
          $or: [
            { name: searchRegex },
            { email: searchRegex }
          ]
        }
      ]
    })
    .select('name email avatar')
    .limit(parseInt(limit));

    res.json({
      success: true,
      data: { users }
    });

  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/users/security-settings
// @desc    Update security settings
// @access  Private
router.put('/security-settings', auth, async (req, res) => {
  try {
    const allowedSettings = [
      'twoFactorEnabled', 'biometricEnabled', 'sessionTimeout',
      'deviceTrust', 'loginNotifications'
    ];

    const updates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedSettings.includes(key)) {
        updates[`securitySettings.${key}`] = req.body[key];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid settings provided'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Security settings updated successfully',
      data: { securitySettings: user.securitySettings }
    });

  } catch (error) {
    console.error('Update security settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update security settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;