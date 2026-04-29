require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt'); // Added bcrypt for password hashing

// 1. Initialize Express and HTTP Server
const app = express();
app.use(cors());
app.use(express.json()); // For parsing application/json standard REST requests

const server = http.createServer(app);

// 2. Initialize Socket.io with CORS restrictions
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// 3. PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Add SSL config here if using Render/Railway hosted databases
  ssl: { rejectUnauthorized: false } 
});

// 4. In-Memory Store for Concurrent Login Tracking
// Maps userId -> socketId
const activeUsers = new Map();

// 5. Socket.io Authentication & Anti-Cheat Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }

  try {
    // Decode user JWT (Assuming token payload has { id, role })
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_dev_key');
    socket.user = decoded; 

    // ANTI-CHEAT: Reject multiple connections from the same user
    if (activeUsers.has(socket.user.id)) {
      console.warn(`[Anti-Cheat] Concurrent login attempt blocked for user: ${socket.user.id}`);
      return next(new Error("Concurrent login detected. Please close other active exam tabs or browsers."));
    }

    next();
  } catch (err) {
    return next(new Error("Authentication error: Invalid or expired token"));
  }
});

// 6. Main Socket Event Handler
io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.user.id} (Role: ${socket.user.role})`);

  // Register user as active to prevent concurrent logins
  activeUsers.set(socket.user.id, socket.id);

  // Join a role-specific global room (useful for broadcasting alerts to all teachers later)
  socket.join(`role_${socket.user.role}`);

  // Handle Disconnection
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] User disconnected: ${socket.user.id} | Reason: ${reason}`);
    
    // Remove from active users map so they can reconnect
    activeUsers.delete(socket.user.id);
  });

  // ==========================================
  // REAL-TIME EXAM: LOBBY & INITIALIZATION
  // ==========================================
  
  // 1. Join Lobby
  socket.on('join_lobby', async ({ examId }) => {
    try {
      if (socket.user.role !== 'student') return;

      // Check if exam is active
      const examRes = await pool.query('SELECT is_active FROM exams WHERE id = $1', [examId]);
      if (examRes.rows.length === 0 || !examRes.rows[0].is_active) {
        return socket.emit('error', { message: 'Exam is not currently active.' });
      }

      // Fetch or Create Session
      let sessionRes = await pool.query('SELECT * FROM exam_sessions WHERE exam_id = $1 AND student_id = $2', [examId, socket.user.id]);
      let session;

      if (sessionRes.rows.length === 0) {
        sessionRes = await pool.query(
          'INSERT INTO exam_sessions (exam_id, student_id, status) VALUES ($1, $2, $3) RETURNING *',
          [examId, socket.user.id, 'lobby']
        );
        session = sessionRes.rows[0];
      } else {
        session = sessionRes.rows[0];
        if (session.status === 'submitted' || session.status === 'forced_submit') {
          return socket.emit('error', { message: 'You have already completed this exam.' });
        }
      }

      socket.join(`exam_${examId}`); // Join general exam room for broadcasts
      socket.emit('lobby_joined', { sessionId: session.id, status: session.status });

      // Notify teachers monitoring this exam
      io.to(`exam_${examId}_teachers`).emit('student_in_lobby', { studentId: socket.user.id });

    } catch (err) {
      console.error('[Join Lobby Error]', err);
      socket.emit('error', { message: 'Failed to join lobby' });
    }
  });

  // 2. Start / Resume Exam
  socket.on('start_exam', async ({ examId }) => {
    try {
      if (socket.user.role !== 'student') return;

      const examRes = await pool.query('SELECT duration_minutes FROM exams WHERE id = $1', [examId]);
      if (examRes.rows.length === 0) return socket.emit('error', { message: 'Exam not found' });
      const duration = examRes.rows[0].duration_minutes;

      const sessionRes = await pool.query('SELECT * FROM exam_sessions WHERE exam_id = $1 AND student_id = $2', [examId, socket.user.id]);
      let session = sessionRes.rows[0];

      if (!session) return socket.emit('error', { message: 'Please join the lobby first.' });

      // Initialize new exam attempt
      if (session.status === 'lobby') {
        const updateRes = await pool.query(`
          UPDATE exam_sessions
          SET status = 'active',
              started_at = NOW(),
              server_end_time = NOW() + ($1 || ' minutes')::INTERVAL
          WHERE id = $2
          RETURNING *
        `, [duration, session.id]);
        session = updateRes.rows[0];
      } 
      // Handle Resume (if tab was closed/crashed)
      else if (session.status === 'active') {
        if (new Date() > new Date(session.server_end_time)) {
          await pool.query(`UPDATE exam_sessions SET status = 'submitted', completed_at = NOW() WHERE id = $1`, [session.id]);
          return socket.emit('exam_time_expired', { message: 'Time has expired. Exam submitted.' });
        }
      } else {
        return socket.emit('error', { message: 'Exam already completed.' });
      }

      // Fetch Questions securely (Exclude correct_answer column!)
      const questionsRes = await pool.query(`
        SELECT id, question_text, type, options, points, order_index
        FROM questions WHERE exam_id = $1 ORDER BY order_index ASC
      `, [examId]);

      // Fetch previously saved answers if resuming
      const answersRes = await pool.query('SELECT question_id, answer_data FROM user_answers WHERE session_id = $1', [session.id]);

      // Send the single source of truth payload to the client
      socket.emit('exam_started', {
        sessionId: session.id,
        serverEndTime: session.server_end_time,
        questions: questionsRes.rows,
        savedAnswers: answersRes.rows // Allows frontend to repopulate state immediately
      });

      // Alert Teacher Dashboard
      io.to(`exam_${examId}_teachers`).emit('student_started', {
        studentId: socket.user.id,
        sessionId: session.id,
        serverEndTime: session.server_end_time
      });

    } catch (err) {
      console.error('[Start Exam Error]', err);
      socket.emit('error', { message: 'Failed to start exam' });
    }
  });

  // ==========================================
  // REAL-TIME EXAM: AUTO-SAVE & ANTI-CHEAT
  // ==========================================
  
  // 3. Auto-Save Answer
  socket.on('auto_save_answer', async ({ sessionId, questionId, answerData }) => {
    try {
      if (socket.user.role !== 'student') return;
      
      // Upsert the answer (Insert if new, Update if exists)
      await pool.query(`
        INSERT INTO user_answers (session_id, question_id, answer_data)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, question_id) 
        DO UPDATE SET answer_data = EXCLUDED.answer_data, last_saved_at = NOW()
      `, [sessionId, questionId, answerData]);

      // Note: We fail silently on the client side so network hiccups 
      // don't interrupt the student's typing flow.

    } catch (err) {
      console.error('[Auto-Save Error]', err);
    }
  });

  // 4. Anti-Cheat: Trigger Flag
  socket.on('trigger_cheat_flag', async ({ examId, sessionId, flagType, details }) => {
    try {
      if (socket.user.role !== 'student') return;

      // Save the violation to the database
      const logRes = await pool.query(`
        INSERT INTO cheat_logs (session_id, flag_type, details)
        VALUES ($1, $2, $3)
        RETURNING id, logged_at
      `, [sessionId, flagType, JSON.stringify(details)]);

      // Instantly alert the teachers monitoring this exam
      io.to(`exam_${examId}_teachers`).emit('cheat_flag_alert', {
        studentId: socket.user.id,
        sessionId,
        flagType,
        details,
        loggedAt: logRes.rows[0].logged_at
      });

    } catch (err) {
      console.error('[Cheat Flag Error]', err);
    }
  });

  // 5. Raise Hand (Help Request)
  socket.on('raise_hand', ({ examId, sessionId }) => {
    if (socket.user.role !== 'student') return;
    
    // Silently notify the teacher
    io.to(`exam_${examId}_teachers`).emit('student_raised_hand', {
      studentId: socket.user.id,
      sessionId
    });
  });

  // ==========================================
  // REAL-TIME EXAM: SUBMISSION & GRADING
  // ==========================================

  // 6. Submit Exam (Student)
  socket.on('submit_exam', async ({ examId, sessionId }) => {
    try {
      if (socket.user.role !== 'student') return;

      // Mark session as submitted
      const updateRes = await pool.query(`
        UPDATE exam_sessions
        SET status = 'submitted', completed_at = NOW()
        WHERE id = $1 AND student_id = $2 AND status = 'active'
        RETURNING *
      `, [sessionId, socket.user.id]);

      if (updateRes.rows.length === 0) return; // Already submitted or not found

      // Simple Auto-Grading (for exact matches like multiple_choice)
      await pool.query(`
        UPDATE user_answers ua
        SET 
          is_correct = (ua.answer_data = q.correct_answer),
          points_awarded = CASE WHEN ua.answer_data = q.correct_answer THEN q.points ELSE 0 END
        FROM questions q
        WHERE ua.question_id = q.id AND ua.session_id = $1 AND q.type IN ('multiple_choice', 'true_false')
      `, [sessionId]);

      // Calculate Total Score
      await pool.query(`
        UPDATE exam_sessions
        SET total_score = (SELECT COALESCE(SUM(points_awarded), 0) FROM user_answers WHERE session_id = $1)
        WHERE id = $1
      `, [sessionId]);

      socket.emit('exam_submitted_successfully', { message: 'Exam submitted and auto-graded.' });

      io.to(`exam_${examId}_teachers`).emit('student_submitted', {
        studentId: socket.user.id,
        sessionId
      });
    } catch (err) {
      console.error('[Submit Exam Error]', err);
    }
  });

  // 7. Force Submit - "Kill Switch" (Teacher)
  socket.on('force_submit', async ({ examId, studentId, sessionId, reason }) => {
    try {
      if (socket.user.role !== 'teacher') return;

      // Update session status
      await pool.query(`
        UPDATE exam_sessions
        SET status = 'forced_submit', completed_at = NOW()
        WHERE id = $1
      `, [sessionId]);

      // Notify the specific student immediately using activeUsers map
      const studentSocketId = activeUsers.get(studentId);
      if (studentSocketId) {
        io.to(studentSocketId).emit('exam_force_submitted', { 
          message: 'Your exam was forcibly submitted by the instructor.',
          reason: reason || 'Violation of exam rules.'
        });
      }

      // Broadcast to other teachers on the dashboard
      io.to(`exam_${examId}_teachers`).emit('student_force_submitted', {
        studentId,
        sessionId,
        reason
      });
    } catch (err) {
      console.error('[Force Submit Error]', err);
    }
  });

  // 8. Join Teacher Dashboard
  socket.on('join_teacher_dashboard', ({ examId }) => {
    if (socket.user.role === 'teacher') {
      socket.join(`exam_${examId}_teachers`);
      console.log(`[Socket] Teacher ${socket.user.id} joined dashboard for exam ${examId}`);
    }
  });

});

// ==========================================
// REST API: AUTHENTICATION ROUTES
// ==========================================

// Register User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, first_name, last_name, role } = req.body;

    if (!email || !password || !first_name || !last_name || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const userExists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password securely
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insert new user into the database
    const newUser = await pool.query(
      'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, first_name, last_name, role',
      [email, password_hash, first_name, last_name, role]
    );

    // Generate JWT payload
    const token = jwt.sign(
      { id: newUser.rows[0].id, role: newUser.rows[0].role },
      process.env.JWT_SECRET || 'super_secret_dev_key',
      { expiresIn: '8h' }
    );

    res.status(201).json({ user: newUser.rows[0], token });
  } catch (err) {
    console.error('[Auth Error]', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find the user by email
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Compare provided password with hashed password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT payload
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'super_secret_dev_key',
      { expiresIn: '8h' }
    );

    // Remove password hash from the user object before sending it to the client
    delete user.password_hash;
    
    res.status(200).json({ user, token });
  } catch (err) {
    console.error('[Auth Error]', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// 7. Standard REST API Healthcheck
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'online', 
    active_websockets: activeUsers.size 
  });
});

// 8. Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Real-Time Exam Server running on port ${PORT}`);
});