import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot be more than 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please enter a valid email'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    match: [/^\+?[\d\s-()]+$/, 'Please enter a valid phone number']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  avatar: {
    type: String,
    default: null
  },
  dateOfBirth: {
    type: Date,
    default: null
  },
  address: {
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    zipCode: { type: String, default: '' },
    country: { type: String, default: '' }
  },
  preferences: {
    currency: { type: String, default: 'USD' },
    language: { type: String, default: 'en' },
    timezone: { type: String, default: 'UTC' },
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    },
    privacy: {
      profileVisible: { type: Boolean, default: true },
      allowInvites: { type: Boolean, default: true }
    }
  },
  walletBalance: {
    type: Number,
    default: 0
  },
  upiAccounts: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    provider: { type: String, required: true },
    isDefault: { type: Boolean, default: false }
  }],
  bankAccounts: [{
    accountNumber: { type: String, required: true },
    bankName: { type: String, required: true },
    accountHolderName: { type: String, required: true },
    ifscCode: { type: String, required: true },
    accountType: { type: String, enum: ['savings', 'current'], default: 'savings' },
    isDefault: { type: Boolean, default: false }
  }],
  securitySettings: {
    twoFactorEnabled: { type: Boolean, default: false },
    biometricEnabled: { type: Boolean, default: false },
    sessionTimeout: { type: Number, default: 30 },
    deviceTrust: { type: Boolean, default: true },
    loginNotifications: { type: Boolean, default: true }
  },
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group'
  }],
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  passwordResetToken: String,
  passwordResetExpires: Date,
  emailVerificationToken: String,
  phoneVerificationToken: String
}, {
  timestamps: true
});

// Indexes for better query performance
// Note: email and phone indexes are created by unique: true in schema
userSchema.index({ isActive: 1 });

// Encrypt password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  this.password = await bcrypt.hash(this.password, parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT token
userSchema.methods.generateAuthToken = function() {
  return jwt.sign(
    { 
      id: this._id,
      email: this.email 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE }
  );
};

// Generate refresh token
userSchema.methods.generateRefreshToken = function() {
  return jwt.sign(
    { 
      id: this._id,
      type: 'refresh'
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE }
  );
};

export default mongoose.model('User', userSchema);