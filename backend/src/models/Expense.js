import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Expense title is required'],
    trim: true,
    maxlength: [200, 'Title cannot be more than 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot be more than 1000 characters']
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0.01, 'Amount must be greater than 0']
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: [
      'Food', 'Transportation', 'Shopping', 'Entertainment', 'Healthcare',
      'Housing', 'Utilities', 'Travel', 'Education', 'Work', 'Other'
    ]
  },
  date: {
    type: Date,
    default: Date.now
  },
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null
  },
  type: {
    type: String,
    enum: ['personal', 'group'],
    required: true
  },
  splitType: {
    type: String,
    enum: ['equal', 'percentage', 'custom', 'shares'],
    default: 'equal'
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    percentage: {
      type: Number,
      default: 0
    },
    shares: {
      type: Number,
      default: 1
    },
    settled: {
      type: Boolean,
      default: false
    },
    settledAt: {
      type: Date,
      default: null
    }
  }],
  receipts: [{
    filename: String,
    originalName: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  tags: [{
    type: String,
    trim: true
  }],
  notes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    content: {
      type: String,
      required: true,
      maxlength: [500, 'Note cannot be more than 500 characters']
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  location: {
    name: String,
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringPattern: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'yearly']
    },
    interval: {
      type: Number,
      default: 1
    },
    endDate: Date,
    nextDue: Date
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'settled'],
    default: 'pending'
  },
  approvals: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approved: Boolean,
    approvedAt: Date,
    comment: String
  }],
  settlement: {
    isSettled: {
      type: Boolean,
      default: false
    },
    settledAt: Date,
    settledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    settlements: [{
      from: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      to: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      amount: Number,
      settledAt: {
        type: Date,
        default: Date.now
      }
    }]
  }
}, {
  timestamps: true
});

// Indexes for better query performance
expenseSchema.index({ paidBy: 1 });
expenseSchema.index({ group: 1 });
expenseSchema.index({ type: 1 });
expenseSchema.index({ 'participants.user': 1 });
expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1 });

// Calculate split amounts based on split type
expenseSchema.methods.calculateSplits = function() {
  const totalAmount = this.amount;
  const participantCount = this.participants.length;

  switch (this.splitType) {
    case 'equal':
      const equalAmount = totalAmount / participantCount;
      this.participants.forEach(participant => {
        participant.amount = equalAmount;
        participant.percentage = (100 / participantCount);
      });
      break;

    case 'percentage':
      this.participants.forEach(participant => {
        participant.amount = (totalAmount * participant.percentage) / 100;
      });
      break;

    case 'shares':
      const totalShares = this.participants.reduce((sum, p) => sum + p.shares, 0);
      this.participants.forEach(participant => {
        participant.amount = (totalAmount * participant.shares) / totalShares;
        participant.percentage = (participant.shares / totalShares) * 100;
      });
      break;

    case 'custom':
      // Custom amounts are already set, just calculate percentages
      this.participants.forEach(participant => {
        participant.percentage = (participant.amount / totalAmount) * 100;
      });
      break;

    default:
      throw new Error('Invalid split type');
  }

  return this;
};

// Validate split amounts
expenseSchema.methods.validateSplits = function() {
  const totalSplitAmount = this.participants.reduce((sum, p) => sum + p.amount, 0);
  const tolerance = 0.01; // Allow 1 cent tolerance for rounding

  if (Math.abs(totalSplitAmount - this.amount) > tolerance) {
    throw new Error('Split amounts do not equal total expense amount');
  }

  return true;
};

// Pre-save middleware to calculate splits and validate
expenseSchema.pre('save', function(next) {
  if (this.isModified('amount') || this.isModified('participants') || this.isModified('splitType')) {
    try {
      this.calculateSplits();
      this.validateSplits();
    } catch (error) {
      return next(error);
    }
  }
  next();
});

export default mongoose.model('Expense', expenseSchema);