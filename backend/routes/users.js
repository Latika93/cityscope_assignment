const express = require('express');
const User = require('../models/User');
const Post = require('../models/Post');
const auth = require('../middleware/auth');

const router = express.Router();

// Get user profile by username
router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('-password -email');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's posts
    const posts = await Post.find({ author: user._id })
      .populate('author', 'username location')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      user: {
        id: user._id,
        username: user.username,
        bio: user.bio,
        location: user.location,
        createdAt: user.createdAt
      },
      posts,
      postCount: posts.length
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ message: 'Server error while fetching user profile' });
  }
});

// Update user profile
router.put('/:username', auth, async (req, res) => {
  try {
    const { bio, location } = req.body;
    
    // Check if user is updating their own profile
    if (req.params.username !== req.user.username) {
      return res.status(403).json({ message: 'Not authorized to update this profile' });
    }

    // Validation
    if (bio && bio.length > 160) {
      return res.status(400).json({ message: 'Bio must be 160 characters or less' });
    }

    const updateData = {};
    if (bio !== undefined) updateData.bio = bio;
    if (location) updateData.location = location;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        bio: user.bio,
        location: user.location
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error while updating profile' });
  }
});

// Get user's posts
router.get('/:username/posts', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    const user = await User.findOne({ username: req.params.username });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const posts = await Post.find({ author: user._id })
      .populate('author', 'username location')
      .populate('replies.author', 'username')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Post.countDocuments({ author: user._id });

    res.json({
      posts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({ message: 'Server error while fetching user posts' });
  }
});

module.exports = router; 