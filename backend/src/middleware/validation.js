import { body, validationResult } from 'express-validator';

export const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => {
      // Create more user-friendly error messages
      let friendlyMessage = error.msg;
      
      // Customize error messages based on field and validation type
      if (error.path === 'email') {
        if (error.msg.includes('valid email')) {
          friendlyMessage = 'Please enter a valid email address (e.g., user@example.com)';
        } else if (error.msg.includes('required')) {
          friendlyMessage = 'Email address is required';
        }
      } else if (error.path === 'password') {
        if (error.msg.includes('6 and 128 characters')) {
          friendlyMessage = 'Password must be between 6 and 128 characters long';
        } else if (error.msg.includes('lowercase')) {
          friendlyMessage = 'Password must contain at least one lowercase letter (a-z)';
        } else if (error.msg.includes('uppercase')) {
          friendlyMessage = 'Password must contain at least one uppercase letter (A-Z)';
        } else if (error.msg.includes('number')) {
          friendlyMessage = 'Password must contain at least one number (0-9)';
        }
      } else if (error.path === 'name') {
        if (error.msg.includes('2 and 100 characters')) {
          friendlyMessage = 'Full name must be between 2 and 100 characters';
        }
      } else if (error.path === 'phone') {
        if (error.msg.includes('valid phone')) {
          friendlyMessage = 'Please enter a valid phone number';
        }
      }
      
      return {
        field: error.path,
        message: friendlyMessage,
        value: error.value,
        code: `VALIDATION_${error.path.toUpperCase()}_ERROR`
      };
    });
    
    return res.status(400).json({
      success: false,
      message: 'Please check your input and correct the following errors:',
      errors: formattedErrors
    });
  }
  
  next();
};

// User validation rules
export const registerValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Name can only contain letters, spaces, hyphens, and apostrophes'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
    .isLength({ max: 320 })
    .withMessage('Email address is too long'),
  
  body('phone')
    .isMobilePhone('any', { strictMode: false })
    .withMessage('Please provide a valid phone number')
    .isLength({ min: 10, max: 15 })
    .withMessage('Phone number must be between 10 and 15 digits'),
  
  body('password')
    .isLength({ min: 6, max: 128 })
    .withMessage('Password must be between 6 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number')
    .not()
    .isIn(['123456', 'password', '123456789', 'qwerty', 'abc123'])
    .withMessage('Please choose a more secure password')
];

export const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
    .notEmpty()
    .withMessage('Email address is required'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 1, max: 128 })
    .withMessage('Password cannot be empty')
];

export const updateProfileValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Please provide a valid date'),
  
  body('address.city')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('City name cannot exceed 100 characters'),
  
  body('preferences.currency')
    .optional()
    .isIn(['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'])
    .withMessage('Invalid currency')
];

// Group validation rules
export const createGroupValidation = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Group name must be between 3 and 100 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  
  body('currency')
    .optional()
    .isIn(['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'])
    .withMessage('Invalid currency'),
  
  body('privacy')
    .optional()
    .isIn(['public', 'private'])
    .withMessage('Privacy must be either public or private'),
  
  body('category')
    .optional()
    .isIn(['Travel', 'Food', 'Living', 'Work', 'Health', 'Entertainment', 'Sports', 'Other'])
    .withMessage('Invalid category')
];

export const updateGroupValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Group name must be between 3 and 100 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  
  body('currency')
    .optional()
    .isIn(['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'])
    .withMessage('Invalid currency'),
  
  body('privacy')
    .optional()
    .isIn(['public', 'private'])
    .withMessage('Privacy must be either public or private')
];

// Join request validation rules
export const joinRequestValidation = [
  body('message')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Message cannot exceed 500 characters')
];

export const processJoinRequestValidation = [
  body('action')
    .isIn(['approve', 'reject'])
    .withMessage('Action must be either approve or reject')
];

// Expense validation rules
export const createExpenseValidation = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  
  body('currency')
    .optional()
    .isIn(['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'])
    .withMessage('Invalid currency'),
  
  body('category')
    .isIn([
      'Food', 'Transportation', 'Shopping', 'Entertainment', 'Healthcare',
      'Housing', 'Utilities', 'Travel', 'Education', 'Work', 'Other'
    ])
    .withMessage('Invalid category'),
  
  body('type')
    .isIn(['personal', 'group'])
    .withMessage('Type must be either personal or group'),
  
  body('splitType')
    .optional()
    .isIn(['equal', 'percentage', 'custom', 'shares'])
    .withMessage('Invalid split type'),
  
  body('participants')
    .optional()
    .isArray({ min: 1 })
    .withMessage('Participants must be an array with at least one member'),
  
  body('participants.*.user')
    .optional()
    .isMongoId()
    .withMessage('Invalid user ID in participants'),
  
  body('date')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format')
];

// Transaction validation rules
export const createTransactionValidation = [
  body('type')
    .isIn(['income', 'expense', 'transfer', 'settlement', 'refund'])
    .withMessage('Invalid transaction type'),
  
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  
  body('description')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Description must be between 1 and 500 characters'),
  
  body('category')
    .optional()
    .isIn([
      'Food', 'Transportation', 'Shopping', 'Entertainment', 'Healthcare',
      'Housing', 'Utilities', 'Travel', 'Education', 'Work', 'Salary',
      'Investment', 'Gift', 'Other'
    ])
    .withMessage('Invalid category'),
  
  body('to.user')
    .optional()
    .isMongoId()
    .withMessage('Invalid recipient user ID'),
  
  body('paymentMethod')
    .optional()
    .isIn(['wallet', 'bank_transfer', 'upi', 'credit_card', 'debit_card', 'cash'])
    .withMessage('Invalid payment method')
];