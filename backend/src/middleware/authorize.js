export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

export const groupOwnerAuth = async (req, res, next) => {
  try {
    const Group = (await import('../models/Group.js')).default;
    const groupId = req.params.groupId || req.body.groupId;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID required'
      });
    }

    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    if (group.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only group owner can perform this action'
      });
    }

    req.group = group;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error during authorization'
    });
  }
};

export const groupMemberAuth = async (req, res, next) => {
  try {
    const Group = (await import('../models/Group.js')).default;
    const groupId = req.params.groupId || req.body.groupId;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID required'
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
    );

    const isOwner = group.owner.toString() === req.user._id.toString();

    if (!isMember && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    req.group = group;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error during authorization'
    });
  }
};

export const groupAdminAuth = async (req, res, next) => {
  try {
    const Group = (await import('../models/Group.js')).default;
    const groupId = req.params.groupId || req.body.groupId;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID required'
      });
    }

    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    const isOwner = group.owner.toString() === req.user._id.toString();
    const member = group.members.find(
      member => member.user.toString() === req.user._id.toString()
    );
    const isAdmin = member && member.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    req.group = group;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error during authorization'
    });
  }
};