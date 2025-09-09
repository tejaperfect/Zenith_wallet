import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';
import { auth, refreshAuth } from '../middleware/auth.js';
import { registerValidation, loginValidation, validate } from '../middleware/validation.js';

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', registerValidation, validate, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({
          success: false,
          message: 'An account with this email already exists',
          error: {
            field: 'email',
            code: 'EMAIL_ALREADY_EXISTS'
          }
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'An account with this phone number already exists',
          error: {
            field: 'phone',
            code: 'PHONE_ALREADY_EXISTS'
          }
        });
      }
    }

    // Create new user
    const user = new User({
      name,
      email,
      phone,
      password,
      emailVerificationToken: crypto.randomBytes(32).toString('hex')
    });

    await user.save();

    // Generate tokens
    const authToken = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.emailVerificationToken;

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Welcome to Zenith Wallet.',
      data: {
        user: userResponse,
        tokens: {
          accessToken: authToken,
          refreshToken,
          expiresIn: process.env.JWT_EXPIRE
        }
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const fieldName = field === 'email' ? 'email address' : 'phone number';
      
      return res.status(400).json({
        success: false,
        message: `This ${fieldName} is already registered`,
        error: {
          field,
          code: 'DUPLICATE_FIELD'
        }
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Please check your input and try again',
        errors: validationErrors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Unable to create account. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', loginValidation, validate, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user and include password for verification
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Please check your credentials and try again.',
        error: {
          code: 'INVALID_CREDENTIALS'
        }
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support for assistance.',
        error: {
          code: 'ACCOUNT_DEACTIVATED',
          supportEmail: 'support@zenithwallet.com'
        }
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Please check your credentials and try again.',
        error: {
          code: 'INVALID_CREDENTIALS'
        }
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const authToken = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({
      success: true,
      message: 'Welcome back! Login successful.',
      data: {
        user: userResponse,
        tokens: {
          accessToken: authToken,
          refreshToken,
          expiresIn: process.env.JWT_EXPIRE
        }
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Unable to sign in. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post('/refresh', refreshAuth, async (req, res) => {
  try {
    const user = req.user;

    // Generate new tokens
    const authToken = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        tokens: {
          accessToken: authToken,
          refreshToken,
          expiresIn: process.env.JWT_EXPIRE
        }
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Token refresh failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', auth, async (req, res) => {
  try {
    // In a more robust implementation, you might maintain a blacklist of tokens
    // For now, we'll just send a success response and let the client remove the token
    
    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
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
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user information',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset token
// @access  Public
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required',
        error: {
          field: 'email',
          code: 'MISSING_EMAIL'
        }
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address. Please check your email or create a new account.',
        error: {
          code: 'EMAIL_NOT_FOUND'
        }
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await user.save();

    // In a real implementation, you would send an email here
    // For now, we'll just return the token (NOT recommended for production)
    res.json({
      success: true,
      message: 'Password reset instructions have been sent to your email address. Please check your inbox and spam folder.',
      data: {
        email,
        resetTokenSent: true,
        ...(process.env.NODE_ENV === 'development' && { resetToken })
      }
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to process password reset request. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Reset token and new password are required',
        errors: [
          ...(!token ? [{ field: 'token', message: 'Reset token is required' }] : []),
          ...(!password ? [{ field: 'password', message: 'New password is required' }] : [])
        ]
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
        error: {
          field: 'password',
          code: 'PASSWORD_TOO_SHORT'
        }
      });
    }

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token. Please request a new one.',
        error: {
          code: 'INVALID_RESET_TOKEN'
        }
      });
    }

    // Update password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save();

    res.json({
      success: true,
      message: 'Your password has been reset successfully. You can now sign in with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to reset password. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;