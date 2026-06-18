require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const session = require("express-session");
const methodOverride = require("method-override");
const bcrypt = require("bcryptjs");

const User = require("./models/User");
const Post = require("./models/Post");

const app = express();
const PORT = 3001;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((error) =>
    console.error("MongoDB connection error:", error.message)
  );

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  next();
}

// Register
app.get("/register", (req, res) => {
  if (req.session.user) {
    return res.redirect("/feed");
  }

  res.render("register", {
    title: "Register",
    error: null,
  });
});

app.post("/register", async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password || !confirmPassword) {
      return res.render("register", {
        title: "Register",
        error: "All fields are required",
      });
    }

    if (password !== confirmPassword) {
      return res.render("register", {
        title: "Register",
        error: "Passwords do not match",
      });
    }

    if (password.length < 6) {
      return res.render("register", {
        title: "Register",
        error: "Password must contain at least 6 characters",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.render("register", {
        title: "Register",
        error: "Email already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
    });

    req.session.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    };

    res.redirect("/feed");
  } catch (error) {
    console.error("Register error:", error);

    res.render("register", {
      title: "Register",
      error: "Unable to register",
    });
  }
});

// Login
app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/feed");
  }

  res.render("login", {
    title: "Login",
    error: null,
  });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({
      email: normalizedEmail,
    });

    if (!user) {
      return res.render("login", {
        title: "Login",
        error: "Invalid email or password",
      });
    }

    const passwordMatched = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatched) {
      return res.render("login", {
        title: "Login",
        error: "Invalid email or password",
      });
    }

    req.session.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    };

    res.redirect("/feed");
  } catch (error) {
    console.error("Login error:", error);

    res.render("login", {
      title: "Login",
      error: "Unable to login",
    });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// Home
app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/feed");
  }

  res.redirect("/login");
});

// Feed
app.get("/feed", requireLogin, async (req, res) => {
  try {
    const posts = await Post.find()
      .populate("user", "name profileImage")
      .populate("comments.user", "name")
      .sort({ createdAt: -1 });

    res.render("feed", {
      title: "Feed",
      posts,
    });
  } catch (error) {
    console.error("Feed error:", error);
    res.status(500).send("Unable to load feed");
  }
});

// Create post
app.post("/posts", requireLogin, async (req, res) => {
  try {
    const { content, imageUrl } = req.body;

    if (!content || !content.trim()) {
      return res.redirect("/feed");
    }

    await Post.create({
      user: req.session.user.id,
      content: content.trim(),
      imageUrl: imageUrl ? imageUrl.trim() : "",
    });

    res.redirect("/feed");
  } catch (error) {
    console.error("Create post error:", error);
    res.status(500).send("Unable to create post");
  }
});

// Like/unlike
app.post("/posts/:id/like", requireLogin, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).send("Post not found");
    }

    const userId = req.session.user.id;

    const alreadyLiked = post.likes.some(
      (likeId) => likeId.toString() === userId
    );

    if (alreadyLiked) {
      post.likes = post.likes.filter(
        (likeId) => likeId.toString() !== userId
      );
    } else {
      post.likes.push(userId);
    }

    await post.save();
    res.redirect("/feed");
  } catch (error) {
    console.error("Like error:", error);
    res.status(500).send("Unable to like post");
  }
});

// Comment
app.post("/posts/:id/comments", requireLogin, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.redirect("/feed");
    }

    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).send("Post not found");
    }

    post.comments.push({
      user: req.session.user.id,
      text: text.trim(),
    });

    await post.save();
    res.redirect("/feed");
  } catch (error) {
    console.error("Comment error:", error);
    res.status(500).send("Unable to add comment");
  }
});

// Delete own post
app.post("/posts/:id/delete", requireLogin, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).send("Post not found");
    }

    if (post.user.toString() !== req.session.user.id) {
      return res.status(403).send("You cannot delete this post");
    }

    await Post.findByIdAndDelete(req.params.id);
    res.redirect("/feed");
  } catch (error) {
    console.error("Delete post error:", error);
    res.status(500).send("Unable to delete post");
  }
});

// Profile
app.get("/profile/:id", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).send("User not found");
    }

    const posts = await Post.find({
      user: user._id,
    }).sort({ createdAt: -1 });

    const isOwnProfile =
      req.session.user.id === user._id.toString();

    const isFollowing = user.followers.some(
      (followerId) =>
        followerId.toString() === req.session.user.id
    );

    res.render("profile", {
      title: user.name,
      user,
      posts,
      isOwnProfile,
      isFollowing,
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).send("Unable to load profile");
  }
});

// Edit profile page
app.get("/profile/edit/me", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.user.id);

    res.render("edit-profile", {
      title: "Edit Profile",
      user,
      error: null,
    });
  } catch (error) {
    console.error("Edit profile error:", error);
    res.status(500).send("Unable to load edit profile");
  }
});

// Update profile
app.post("/profile/edit/me", requireLogin, async (req, res) => {
  try {
    const { name, bio, profileImage } = req.body;

    const user = await User.findByIdAndUpdate(
      req.session.user.id,
      {
        name: name.trim(),
        bio: bio.trim(),
        profileImage:
          profileImage.trim() ||
          "https://via.placeholder.com/150",
      },
      {
        new: true,
        runValidators: true,
      }
    );

    req.session.user.name = user.name;

    res.redirect(`/profile/${user._id}`);
  } catch (error) {
    console.error("Update profile error:", error);

    const user = await User.findById(req.session.user.id);

    res.render("edit-profile", {
      title: "Edit Profile",
      user,
      error: "Unable to update profile",
    });
  }
});

// Follow/unfollow
app.post("/profile/:id/follow", requireLogin, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.session.user.id;

    if (targetUserId === currentUserId) {
      return res.redirect(`/profile/${targetUserId}`);
    }

    const targetUser = await User.findById(targetUserId);
    const currentUser = await User.findById(currentUserId);

    if (!targetUser || !currentUser) {
      return res.status(404).send("User not found");
    }

    const alreadyFollowing = currentUser.following.some(
      (id) => id.toString() === targetUserId
    );

    if (alreadyFollowing) {
      currentUser.following = currentUser.following.filter(
        (id) => id.toString() !== targetUserId
      );

      targetUser.followers = targetUser.followers.filter(
        (id) => id.toString() !== currentUserId
      );
    } else {
      currentUser.following.push(targetUserId);
      targetUser.followers.push(currentUserId);
    }

    await currentUser.save();
    await targetUser.save();

    res.redirect(`/profile/${targetUserId}`);
  } catch (error) {
    console.error("Follow error:", error);
    res.status(500).send("Unable to update follow status");
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});