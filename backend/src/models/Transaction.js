import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['income', 'expense', 'transfer', 'settlement', 'refund'],
    required: true
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
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  category: {
    type: String,
    enum: [
      'Food', 'Transportation', 'Shopping', 'Entertainment', 'Healthcare',
      'Housing', 'Utilities', 'Travel', 'Education', 'Work', 'Salary',
      'Investment', 'Gift', 'Other'
    ],
    default: 'Other'
  },
  from: {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    account: {
      type: String, // bank account, UPI ID, wallet, etc.
      default: 'wallet'
    },
    balanceBefore: {
      type: Number,
      required: true
    },
    balanceAfter: {
      type: Number,
      required: true
    }
  },
  to: {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    account: {
      type: String,
      default: 'wallet'
    },
    balanceBefore: {
      type: Number,
      default: 0
    },
    balanceAfter: {
      type: Number,
      default: 0
    },
    external: {
      name: String, // for external transfers
      identifier: String // account number, UPI ID, etc.
    }
  },
  relatedExpense: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Expense',
    default: null
  },
  relatedGroup: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null
  },
  paymentMethod: {
    type: String,
    enum: ['wallet', 'bank_transfer', 'upi', 'credit_card', 'debit_card', 'cash'],
    default: 'wallet'
  },
  paymentGateway: {
    provider: String, // razorpay, stripe, paytm, etc.
    transactionId: String,
    gatewayResponse: mongoose.Schema.Types.Mixed
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pending'
  },
  reference: {
    type: String,
    unique: true,
    sparse: true
  },
  metadata: {
    userAgent: String,
    ipAddress: String,
    deviceInfo: String,
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    }
  },
  fees: {
    amount: {
      type: Number,
      default: 0
    },
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'fixed'
    },
    paidBy: {
      type: String,
      enum: ['sender', 'receiver', 'split'],
      default: 'sender'
    }
  },
  recurring: {
    isRecurring: {
      type: Boolean,
      default: false
    },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'yearly']
    },
    interval: {
      type: Number,
      default: 1
    },
    nextDue: Date,
    endDate: Date,
    parentTransaction: {
      type: mongoose.Schema.ObjectId,
      ref: 'Transaction'
    }
  },
  approvals: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    comment: String,
    approvedAt: Date
  }],
  notifications: {
    sent: {
      type: Boolean,
      default: false
    },
    sentAt: Date,
    methods: [{
      type: String,
      enum: ['email', 'sms', 'push', 'in_app']
    }]
  },
  attachments: [{
    filename: String,
    originalName: String,
    url: String,
    type: {
      type: String,
      enum: ['receipt', 'invoice', 'proof', 'other']
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  tags: [{
    type: String,
    trim: true
  }],
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot be more than 1000 characters']
  },
  processedAt: Date,
  failureReason: String,
  retryCount: {
    type: Number,
    default: 0
  },
  maxRetries: {
    type: Number,
    default: 3
  }
}, {
  timestamps: true
});

// Indexes for better query performance
// Note: reference index is created by unique: true in schema
transactionSchema.index({ 'from.user': 1 });
transactionSchema.index({ 'to.user': 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ relatedExpense: 1 });
transactionSchema.index({ relatedGroup: 1 });

// Generate unique reference number
transactionSchema.pre('save', function(next) {
  if (!this.reference && this.isNew) {
    const prefix = this.type.charAt(0).toUpperCase();
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    this.reference = `${prefix}${timestamp}${random}`;
  }
  next();
});

// Instance method to process transaction
transactionSchema.methods.process = async function() {
  try {
    this.status = 'processing';
    await this.save();

    // Simulate payment processing
    // In real implementation, this would integrate with payment gateways
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update balances
    const User = mongoose.model('User');
    
    if (this.type === 'transfer' && this.to.user) {
      // Update sender balance
      await User.findByIdAndUpdate(
        this.from.user,
        { $inc: { walletBalance: -this.amount } }
      );

      // Update receiver balance
      await User.findByIdAndUpdate(
        this.to.user,
        { $inc: { walletBalance: this.amount } }
      );
    } else if (this.type === 'expense') {
      // Deduct from user balance
      await User.findByIdAndUpdate(
        this.from.user,
        { $inc: { walletBalance: -this.amount } }
      );
    } else if (this.type === 'income') {
      // Add to user balance
      await User.findByIdAndUpdate(
        this.from.user,
        { $inc: { walletBalance: this.amount } }
      );
    }

    this.status = 'completed';
    this.processedAt = new Date();
    await this.save();

    return this;
  } catch (error) {
    this.status = 'failed';
    this.failureReason = error.message;
    this.retryCount += 1;
    await this.save();
    throw error;
  }
};

// Instance method to retry failed transaction
transactionSchema.methods.retry = async function() {
  if (this.retryCount >= this.maxRetries) {
    throw new Error('Maximum retry limit reached');
  }
  
  if (this.status !== 'failed') {
    throw new Error('Only failed transactions can be retried');
  }

  return this.process();
};

export default mongoose.model('Transaction', transactionSchema);