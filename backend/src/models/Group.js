import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Group name is required'],
    trim: true,
    maxlength: [100, 'Group name cannot be more than 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  avatar: {
    type: String,
    default: null
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY']
  },
  privacy: {
    type: String,
    enum: ['public', 'private'],
    default: 'private'
  },
  category: {
    type: String,
    enum: ['Travel', 'Food', 'Living', 'Work', 'Health', 'Entertainment', 'Sports', 'Other'],
    default: 'Other'
  },
  joinCode: {
    type: String,
    unique: true,
    sparse: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    balance: {
      type: Number,
      default: 0
    },
    totalPaid: {
      type: Number,
      default: 0
    },
    totalOwed: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'left'],
      default: 'active'
    }
  }],
  settings: {
    allowMemberInvites: {
      type: Boolean,
      default: true
    },
    autoSettlement: {
      type: Boolean,
      default: false
    },
    notificationEmails: {
      type: Boolean,
      default: true
    },
    memberLimit: {
      type: Number,
      default: 50
    },
    expenseApprovalRequired: {
      type: Boolean,
      default: false
    }
  },
  totalExpenses: {
    type: Number,
    default: 0
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
    amount: {
      type: Number,
      required: true
    },
    settledAt: {
      type: Date,
      default: Date.now
    },
    note: String
  }],
  joinRequests: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    message: {
      type: String,
      maxlength: [500, 'Join request message cannot be more than 500 characters']
    },
    requestedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    processedAt: Date,
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  invitations: [{
    email: String,
    phone: String,
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    invitedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'expired'],
      default: 'pending'
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better query performance
// Note: joinCode index is created by unique: true in schema
groupSchema.index({ owner: 1 });
groupSchema.index({ 'members.user': 1 });
groupSchema.index({ privacy: 1, isActive: 1 });

// Generate unique join code
groupSchema.methods.generateJoinCode = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Update last activity
groupSchema.methods.updateActivity = function() {
  this.lastActivity = new Date();
  return this.save();
};

// Calculate member balances
groupSchema.methods.calculateBalances = async function() {
  await this.populate('members.user');
  
  // This would typically involve complex calculations based on expenses
  // For now, we'll implement a simplified version
  try {
    const Expense = mongoose.models.Expense || (await import('./Expense.js')).default;
    const expenses = await Expense.find({ group: this._id });
  
  // Reset balances
  this.members.forEach(member => {
    member.totalPaid = 0;
    member.totalOwed = 0;
    member.balance = 0;
  });

  // Calculate based on expenses
  expenses.forEach(expense => {
    const paidByMember = this.members.find(m => m.user._id.toString() === expense.paidBy.toString());
    if (paidByMember) {
      paidByMember.totalPaid += expense.amount;
    }

    // Split expense among participants
    const splitAmount = expense.amount / expense.participants.length;
    expense.participants.forEach(participantId => {
      const participant = this.members.find(m => m.user._id.toString() === participantId.toString());
      if (participant) {
        participant.totalOwed += splitAmount;
      }
    });
  });

    // Calculate final balances
    this.members.forEach(member => {
      member.balance = member.totalPaid - member.totalOwed;
    });

    return this.save();
  } catch (error) {
    console.error('Error calculating group balances:', error);
    return this.save(); // Save without balance calculations if there's an error
  }
};

export default mongoose.model('Group', groupSchema);