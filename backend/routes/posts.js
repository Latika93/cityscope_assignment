const express = require('express');
const Post = require('../models/Post');
const auth = require('../middleware/auth');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Get all posts with filtering
router.get('/', async (req, res) => {
  try {
    const { location, postType, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (location) filter.location = new RegExp(location, 'i');
    if (postType) filter.postType = postType;

    const posts = await Post.find(filter)
      .populate('author', 'username location')
      .populate('replies.author', 'username')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Post.countDocuments(filter);

    res.json({
      posts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ message: 'Server error while fetching posts' });
  }
});

// Get single post
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username location')
      .populate('replies.author', 'username');

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    res.json(post);
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ message: 'Server error while fetching post' });
  }
});

// Create new post
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const { content, postType, location } = req.body;

    // Validation
    if (!content || !postType || !location) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    if (content.length > 280) {
      return res.status(400).json({ message: 'Content must be 280 characters or less' });
    }

    const validPostTypes = ['recommendation', 'help', 'update', 'event'];
    if (!validPostTypes.includes(postType)) {
      return res.status(400).json({ message: 'Invalid post type' });
    }

    let imageUrl = null;

    // Handle image upload if present
    if (req.file) {
      try {
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              resource_type: 'image',
              folder: 'cityscope_posts'
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          ).end(req.file.buffer);
        });
        
        imageUrl = result.secure_url;
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({ message: 'Error uploading image' });
      }
    }

    // Create post
    const post = new Post({
      author: req.user._id,
      content,
      postType,
      location,
      imageUrl
    });

    await post.save();
    await post.populate('author', 'username location');

    res.status(201).json({
      message: 'Post created successfully',
      post
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ message: 'Server error while creating post' });
  }
});

// Update post
router.put('/:id', auth, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ message: 'Content is required' });
    }

    if (content.length > 280) {
      return res.status(400).json({ message: 'Content must be 280 characters or less' });
    }

    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Check if user owns the post
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to edit this post' });
    }

    post.content = content;
    await post.save();
    await post.populate('author', 'username location');

    res.json({
      message: 'Post updated successfully',
      post
    });
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({ message: 'Server error while updating post' });
  }
});

// Delete post
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Check if user owns the post
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this post' });
    }

    await Post.findByIdAndDelete(req.params.id);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ message: 'Server error while deleting post' });
  }
});

// Add reply to post
router.post('/:id/replies', auth, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ message: 'Reply content is required' });
    }

    if (content.length > 280) {
      return res.status(400).json({ message: 'Reply must be 280 characters or less' });
    }

    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const reply = {
      author: req.user._id,
      content,
      createdAt: new Date()
    };

    post.replies.push(reply);
    await post.save();
    await post.populate('replies.author', 'username');

    res.status(201).json({
      message: 'Reply added successfully',
      reply: post.replies[post.replies.length - 1]
    });
  } catch (error) {
    console.error('Add reply error:', error);
    res.status(500).json({ message: 'Server error while adding reply' });
  }
});

// Get replies for a post
router.get('/:id/replies', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('replies.author', 'username')
      .select('replies');
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    res.json(post.replies);
  } catch (error) {
    console.error('Get replies error:', error);
    res.status(500).json({ message: 'Server error while fetching replies' });
  }
});

// Add/remove like
router.post('/:id/reactions', auth, async (req, res) => {
  try {
    const { type } = req.body; // 'like' or 'dislike'
    
    if (!['like', 'dislike'].includes(type)) {
      return res.status(400).json({ message: 'Invalid reaction type' });
    }

    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const userId = req.user._id;
    const hasLiked = post.likes.includes(userId);
    const hasDisliked = post.dislikes.includes(userId);

    if (type === 'like') {
      if (hasLiked) {
        // Remove like
        post.likes = post.likes.filter(id => id.toString() !== userId.toString());
      } else {
        // Add like and remove dislike if exists
        post.likes.push(userId);
        if (hasDisliked) {
          post.dislikes = post.dislikes.filter(id => id.toString() !== userId.toString());
        }
      }
    } else { // dislike
      if (hasDisliked) {
        // Remove dislike
        post.dislikes = post.dislikes.filter(id => id.toString() !== userId.toString());
      } else {
        // Add dislike and remove like if exists
        post.dislikes.push(userId);
        if (hasLiked) {
          post.likes = post.likes.filter(id => id.toString() !== userId.toString());
        }
      }
    }

    await post.save();

    res.json({
      message: 'Reaction updated successfully',
      likes: post.likes.length,
      dislikes: post.dislikes.length,
      userReaction: post.likes.includes(userId) ? 'like' : 
                   post.dislikes.includes(userId) ? 'dislike' : null
    });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ message: 'Server error while updating reaction' });
  }
});

// Remove reaction
router.delete('/:id/reactions', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const userId = req.user._id;
    
    // Remove user from both likes and dislikes
    post.likes = post.likes.filter(id => id.toString() !== userId.toString());
    post.dislikes = post.dislikes.filter(id => id.toString() !== userId.toString());

    await post.save();

    res.json({
      message: 'Reaction removed successfully',
      likes: post.likes.length,
      dislikes: post.dislikes.length,
      userReaction: null
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({ message: 'Server error while removing reaction' });
  }
});

module.exports = router; 