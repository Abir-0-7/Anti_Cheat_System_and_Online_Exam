import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  AlertTriangle, Clock, Hand, CheckCircle, 
  Maximize, LogOut, ShieldAlert, AlertCircle,
  Users, Activity, XCircle, UserCheck, Bell
} from 'lucide-react';

// ==========================================
// CONFIGURATION
// ==========================================
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

// ==========================================
// SUB-COMPONENTS
// ==========================================

const LoginView = ({ onLogin }) => {
  const [email, setEmail] = useState('student@example.com');
  const [password, setPassword] = useState('password123');
  const [examId, setExamId] = useState('12345678-1234-1234-1234-123456789012'); // Mock UUID
  const [role, setRole] = useState('student');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // In a real app, you'd fetch from BACKEND_URL/api/auth/login
      // For this demo, we will simulate a successful login and generate a fake token
      // so we can connect to the Socket.io backend.
      
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role })
      });

      if (!res.ok) {
        // Fallback for UI testing if backend isn't running
        console.warn("Backend not reachable. Using mock token for UI testing.");
        onLogin(`mock_jwt_token_${role}`, { id: role === 'teacher' ? 'teacher_1' : 'student_1', role: role, name: role === 'teacher' ? 'Prof. Smith' : 'Alex Student' }, examId);
        return;
      }

      const data = await res.json();
      onLogin(data.token, data.user, examId);
    } catch (err) {
      console.warn("Fetch failed, using mock auth for preview purposes.");
      onLogin(`mock_jwt_token_${role}`, { id: role === 'teacher' ? 'teacher_1' : 'student_1', role: role, name: role === 'teacher' ? 'Prof. Smith' : 'Alex Student' }, examId);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 border border-slate-100">
        <div className="text-center mb-8">
          <ShieldAlert className="w-12 h-12 text-blue-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-800">Secure Exam Portal</h1>
          <p className="text-slate-500 text-sm mt-2">Enter your credentials to access your exam.</p>
        </div>
        
        {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4">{error}</div>}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Exam ID</label>
            <input type="text" value={examId} onChange={e => setExamId(e.target.value)} required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} 
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white">
              <option value="student">Student</option>
              <option value="teacher">Teacher (Live Proctor)</option>
            </select>
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors flex justify-center items-center">
            {loading ? 'Authenticating...' : (role === 'teacher' ? 'Open Dashboard' : 'Join Lobby')}
          </button>
        </form>
      </div>
    </div>
  );
};

const LobbyView = ({ socket, examId, onExamStart }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [status, setStatus] = useState('Connecting...');

  useEffect(() => {
    if (!socket) return;
    
    socket.emit('join_lobby', { examId });
    
    socket.on('lobby_joined', (data) => {
      setStatus('Ready to begin. Please enter Full-Screen mode.');
    });

    socket.on('exam_started', (data) => {
      onExamStart(data);
    });

    socket.on('error', (err) => {
      setStatus(`Error: ${err.message}`);
    });

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      socket.off('lobby_joined');
      socket.off('exam_started');
      socket.off('error');
    };
  }, [socket, examId, onExamStart]);

  const requestFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch (err) {
      alert("Could not enable fullscreen. Please check your browser permissions.");
    }
  };

  const startExam = () => {
    socket.emit('start_exam', { examId });
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white">
      <div className="max-w-lg w-full bg-slate-800 rounded-xl shadow-2xl p-8 border border-slate-700 text-center">
        <AlertCircle className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Pre-Exam Lobby</h2>
        <p className="text-slate-400 mb-6">{status}</p>

        <div className="bg-slate-900 rounded-lg p-4 mb-8 text-left space-y-3">
          <h3 className="font-semibold text-slate-200">Exam Rules:</h3>
          <ul className="text-sm text-slate-400 list-disc pl-5 space-y-1">
            <li>Your webcam and microphone are active.</li>
            <li>Do not exit full-screen mode.</li>
            <li>Do not switch tabs or open other applications.</li>
            <li>Copying and pasting is strictly prohibited.</li>
            <li>Violations will be flagged to your instructor immediately.</li>
          </ul>
        </div>

        {!isFullscreen ? (
          <button onClick={requestFullscreen} className="w-full bg-blue-600 hover:bg-blue-500 font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors">
            <Maximize className="w-5 h-5" /> Enable Full-Screen
          </button>
        ) : (
          <button onClick={startExam} className="w-full bg-green-600 hover:bg-green-500 font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors">
            <CheckCircle className="w-5 h-5" /> Start Exam Now
          </button>
        )}
      </div>
    </div>
  );
};

const ExamView = ({ socket, examId, examData, onSubmit }) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  
  const question = examData.questions?.[currentIdx];
  const totalQuestions = examData.questions?.length || 0;

  // Setup Initial Answers (if resuming)
  useEffect(() => {
    if (examData.savedAnswers) {
      const initialMap = {};
      examData.savedAnswers.forEach(ans => {
        initialMap[ans.question_id] = ans.answer_data;
      });
      setAnswers(initialMap);
    }
  }, [examData.savedAnswers]);

  // Secure Server Timer
  useEffect(() => {
    const updateTimer = () => {
      if (!examData.serverEndTime) return;
      
      const now = new Date().getTime();
      const end = new Date(examData.serverEndTime).getTime();
      const distance = end - now;

      if (distance < 0) {
        setTimeLeft('00:00:00');
        return;
      }

      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);

      setTimeLeft(
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      );
      setIsUrgent(distance < 5 * 60 * 1000); // Less than 5 mins
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [examData.serverEndTime]);

  // Anti-Cheat Engine Hooks
  useEffect(() => {
    if (!socket || !examData.sessionId) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        socket.emit('trigger_cheat_flag', {
          examId,
          sessionId: examData.sessionId,
          flagType: 'tab_switch',
          details: { timestamp: new Date().toISOString() }
        });
        // In a real app, you might show a strict warning modal here
        alert("WARNING: Tab switching is recorded and flagged to the instructor.");
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        socket.emit('trigger_cheat_flag', {
          examId,
          sessionId: examData.sessionId,
          flagType: 'exit_fullscreen',
          details: { timestamp: new Date().toISOString() }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [socket, examId, examData.sessionId]);

  const handlePaste = (e) => {
    e.preventDefault();
    socket.emit('trigger_cheat_flag', {
      examId,
      sessionId: examData.sessionId,
      flagType: 'paste_attempt',
      details: { timestamp: new Date().toISOString(), length: e.clipboardData.getData('text').length }
    });
    alert("Copy/Paste is disabled during the exam.");
  };

  const handleAnswerChange = (val) => {
    if (!question) return;
    
    // Optimistic UI update
    setAnswers(prev => ({ ...prev, [question.id]: val }));

    // Auto-Save to server
    socket.emit('auto_save_answer', {
      sessionId: examData.sessionId,
      questionId: question.id,
      answerData: val
    });
  };

  const submitExam = () => {
    if (window.confirm("Are you sure you want to submit your exam? You cannot undo this.")) {
      socket.emit('submit_exam', { examId, sessionId: examData.sessionId });
    }
  };

  const raiseHand = () => {
    socket.emit('raise_hand', { examId, sessionId: examData.sessionId });
    alert("The instructor has been notified that you need help.");
  };

  if (!question) return <div className="text-center p-10">Loading questions...</div>;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10 relative">
        <div className="flex items-center gap-3">
          <ShieldAlert className="text-blue-600 w-6 h-6" />
          <h1 className="font-bold text-lg hidden sm:block">Enterprise Exam Portal</h1>
        </div>
        
        <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full font-mono text-lg font-bold ${isUrgent ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-slate-100 text-slate-700'}`}>
          <Clock className="w-5 h-5" />
          {timeLeft}
        </div>

        <div className="flex items-center gap-4">
          <button onClick={raiseHand} className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
            <Hand className="w-4 h-4" /> Raise Hand
          </button>
          <button onClick={submitExam} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm">
            Submit Exam
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-white border-r border-slate-200 p-4 overflow-y-auto hidden md:block">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Question Navigator</h3>
          <div className="grid grid-cols-4 gap-2">
            {examData.questions?.map((q, idx) => {
              const isAnswered = !!answers[q.id];
              const isCurrent = idx === currentIdx;
              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentIdx(idx)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center font-medium transition-all
                    ${isCurrent ? 'ring-2 ring-blue-500 bg-blue-50 text-blue-700' : 
                      isAnswered ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}
                  `}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main Exam Content Area */}
        <main className="flex-1 p-6 md:p-12 overflow-y-auto bg-slate-50">
          <div className="max-w-3xl mx-auto">
            {/* Question Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-6">
              <div className="flex justify-between items-start mb-6">
                <span className="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                  Question {currentIdx + 1} of {totalQuestions}
                </span>
                <span className="text-slate-400 font-medium text-sm">
                  {question.points} Points
                </span>
              </div>
              
              <h2 className="text-xl font-medium text-slate-800 mb-8 leading-relaxed">
                {question.question_text || "Sample Question Text?"}
              </h2>

              <div className="space-y-3">
                {question.type === 'multiple_choice' && question.options?.map((opt, i) => (
                  <label key={i} className={`flex items-center p-4 border rounded-xl cursor-pointer transition-all
                    ${answers[question.id] === opt ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}
                  `}>
                    <input 
                      type="radio" 
                      name={`q-${question.id}`} 
                      value={opt}
                      checked={answers[question.id] === opt}
                      onChange={(e) => handleAnswerChange(e.target.value)}
                      className="w-5 h-5 text-blue-600 border-slate-300 focus:ring-blue-500" 
                    />
                    <span className="ml-3 text-slate-700 font-medium">{opt}</span>
                  </label>
                ))}

                {(question.type === 'short_answer' || question.type === 'essay') && (
                  <textarea
                    rows={question.type === 'essay' ? 8 : 3}
                    placeholder="Type your answer here..."
                    value={answers[question.id] || ''}
                    onChange={(e) => handleAnswerChange(e.target.value)}
                    onPaste={handlePaste}
                    className="w-full p-4 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
                  />
                )}
              </div>
            </div>

            {/* Bottom Navigation */}
            <div className="flex justify-between items-center">
              <button 
                onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
                disabled={currentIdx === 0}
                className="px-6 py-2.5 rounded-lg font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Previous
              </button>
              
              {currentIdx < totalQuestions - 1 ? (
                <button 
                  onClick={() => setCurrentIdx(prev => Math.min(totalQuestions - 1, prev + 1))}
                  className="px-6 py-2.5 rounded-lg font-medium text-white bg-slate-800 hover:bg-slate-700 transition-colors shadow-sm"
                >
                  Next Question
                </button>
              ) : (
                <button 
                  onClick={submitExam}
                  className="px-8 py-2.5 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Finish
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

const CompletionView = ({ message }) => (
  <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-center">
    <CheckCircle className="w-20 h-20 text-green-500 mb-6" />
    <h1 className="text-3xl font-bold text-slate-800 mb-2">Exam Submitted</h1>
    <p className="text-slate-500 max-w-md">{message || "Your exam has been successfully submitted and saved. You may now close this window."}</p>
  </div>
);

const ForceSubmitView = ({ reason }) => (
  <div className="min-h-screen bg-red-50 flex flex-col items-center justify-center p-4 text-center">
    <AlertTriangle className="w-20 h-20 text-red-600 mb-6" />
    <h1 className="text-3xl font-bold text-red-700 mb-2">Exam Terminated</h1>
    <p className="text-red-600 max-w-md font-medium">Your exam was forcibly submitted by the instructor.</p>
    {reason && <div className="mt-6 p-4 bg-white border border-red-200 rounded-lg text-sm text-red-800 shadow-sm max-w-md">Reason provided: {reason}</div>}
  </div>
);

const TeacherDashboardView = ({ socket, examId }) => {
  const [students, setStudents] = useState({});
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!socket) return;

    socket.on('student_in_lobby', ({ studentId }) => {
      setStudents(prev => ({ ...prev, [studentId]: { id: studentId, status: 'lobby', flags: 0, handRaised: false } }));
      addLog('info', `Student ${studentId} joined the lobby.`);
    });

    socket.on('student_started', ({ studentId, sessionId }) => {
      setStudents(prev => ({ ...prev, [studentId]: { ...prev[studentId], id: studentId, status: 'active', sessionId } }));
      addLog('success', `Student ${studentId} started the exam.`);
    });

    socket.on('cheat_flag_alert', ({ studentId, flagType, details }) => {
      setStudents(prev => ({
        ...prev,
        [studentId]: { ...prev[studentId], flags: (prev[studentId]?.flags || 0) + 1, recentFlag: flagType }
      }));
      addLog('danger', `FLAG [${flagType.toUpperCase()}]: Student ${studentId} triggered a cheat alert.`);
    });

    socket.on('student_raised_hand', ({ studentId }) => {
      setStudents(prev => ({ ...prev, [studentId]: { ...prev[studentId], handRaised: true } }));
      addLog('warning', `Student ${studentId} raised their hand for help.`);
    });

    socket.on('student_submitted', ({ studentId }) => {
      setStudents(prev => ({ ...prev, [studentId]: { ...prev[studentId], status: 'submitted' } }));
      addLog('success', `Student ${studentId} submitted their exam.`);
    });

    socket.on('student_force_submitted', ({ studentId, reason }) => {
      setStudents(prev => ({ ...prev, [studentId]: { ...prev[studentId], status: 'forced_submit' } }));
      addLog('danger', `Student ${studentId} was forcibly submitted. Reason: ${reason}`);
    });

    return () => {
      socket.off('student_in_lobby');
      socket.off('student_started');
      socket.off('cheat_flag_alert');
      socket.off('student_raised_hand');
      socket.off('student_submitted');
      socket.off('student_force_submitted');
    };
  }, [socket]);

  const addLog = (type, message) => {
    setLogs(prev => [{ id: Date.now(), type, message, time: new Date().toLocaleTimeString() }, ...prev]);
  };

  const handleForceSubmit = (studentId, sessionId) => {
    if (window.confirm('Are you sure you want to forcibly end this student\'s exam?')) {
      socket.emit('force_submit', { examId, studentId, sessionId, reason: 'Instructor intervention (Live proctoring)' });
    }
  };

  const handleClearHand = (studentId) => {
    setStudents(prev => ({ ...prev, [studentId]: { ...prev[studentId], handRaised: false } }));
  };

  const activeCount = Object.values(students).filter(s => s.status === 'active').length;
  const flaggedCount = Object.values(students).filter(s => s.flags > 0).length;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shadow-md z-10">
        <div className="flex items-center gap-3">
          <ShieldAlert className="text-blue-400 w-6 h-6" />
          <h1 className="font-bold text-lg">Live Proctoring Dashboard</h1>
          <span className="bg-slate-800 text-slate-300 text-xs px-2 py-1 rounded ml-2 font-mono">Exam: {examId.split('-')[0]}</span>
        </div>
        <div className="flex gap-6">
          <div className="flex items-center gap-2 text-sm"><Users className="w-4 h-4 text-blue-400"/> Active: <span className="font-bold">{activeCount}</span></div>
          <div className="flex items-center gap-2 text-sm"><AlertTriangle className="w-4 h-4 text-red-400"/> Flagged: <span className="font-bold">{flaggedCount}</span></div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Grid */}
        <main className="flex-1 p-6 overflow-y-auto">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Activity className="w-5 h-5"/> Live Student Grid</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.values(students).length === 0 && (
              <div className="col-span-full p-12 text-center text-slate-400 border-2 border-dashed border-slate-300 rounded-xl">
                Waiting for students to join the lobby...
              </div>
            )}
            {Object.values(students).map(student => (
              <div key={student.id} className={`bg-white rounded-xl shadow-sm border-l-4 p-5 transition-all
                ${student.status === 'forced_submit' ? 'border-red-600 opacity-75' : 
                  student.flags > 0 ? 'border-orange-500' : 
                  student.handRaised ? 'border-yellow-400' : 
                  student.status === 'active' ? 'border-green-500' : 'border-slate-300'}
              `}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-bold text-slate-800">{student.id}</div>
                    <div className="text-xs text-slate-500 uppercase tracking-wide font-semibold mt-1">Status: {student.status}</div>
                  </div>
                  {student.handRaised && <Hand className="w-5 h-5 text-yellow-500 animate-bounce" />}
                </div>

                <div className="bg-slate-50 rounded p-3 mb-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Flags Triggered:</span>
                    <span className={`font-bold ${student.flags > 0 ? 'text-orange-600' : 'text-slate-700'}`}>{student.flags}</span>
                  </div>
                  {student.recentFlag && (
                    <div className="flex justify-between text-xs text-red-600 bg-red-50 p-1 rounded">
                      <span>Latest:</span>
                      <span className="font-mono">{student.recentFlag}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  {student.handRaised && (
                    <button onClick={() => handleClearHand(student.id)} className="flex-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 text-xs font-bold py-2 rounded transition-colors">
                      Clear Hand
                    </button>
                  )}
                  {student.status === 'active' && (
                    <button onClick={() => handleForceSubmit(student.id, student.sessionId)} className="flex-1 bg-red-100 hover:bg-red-200 text-red-700 flex justify-center items-center gap-1 text-xs font-bold py-2 rounded transition-colors">
                      <XCircle className="w-3 h-3"/> Kill Switch
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Live Audit Sidebar */}
        <aside className="w-80 bg-white border-l border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-600" />
            <h3 className="font-bold text-slate-800">Live Audit Timeline</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {logs.length === 0 && <div className="text-sm text-slate-400 text-center mt-4">No events logged yet.</div>}
            {logs.map(log => (
              <div key={log.id} className={`p-3 rounded-lg text-sm border-l-2
                ${log.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' : 
                  log.type === 'warning' ? 'bg-yellow-50 border-yellow-400 text-yellow-800' : 
                  log.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' : 
                  'bg-slate-50 border-blue-400 text-slate-700'}
              `}>
                <div className="text-xs opacity-60 mb-1">{log.time}</div>
                <div className="font-medium">{log.message}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

// ==========================================
// MAIN APP COMPONENT (STATE ROUTER)
// ==========================================

export default function App() {
  const [view, setView] = useState('login'); // login | lobby | exam | submitted | forced | teacher_dashboard
  const [socket, setSocket] = useState(null);
  const [examId, setExamId] = useState(null);
  const [examData, setExamData] = useState(null);
  const [terminationReason, setTerminationReason] = useState('');

  const handleLogin = (token, user, eId) => {
    setExamId(eId);
    
    // Initialize Socket.io Connection
    const newSocket = io(BACKEND_URL, {
      auth: { token },
      transports: ['websocket']
    });

    newSocket.on('connect_error', (err) => {
      console.error("Socket Connection Error:", err.message);
      if (err.message.includes('Concurrent login')) {
        alert("Concurrent login detected! Please close other tabs/browsers.");
      }
    });

    newSocket.on('connect', () => {
      setSocket(newSocket);
      
      if (user.role === 'teacher') {
        newSocket.emit('join_teacher_dashboard', { examId: eId });
        setView('teacher_dashboard');
      } else {
        setView('lobby');
      }
    });

    // Global Listeners for Termination Events (Student Only)
    if (user.role !== 'teacher') {
      newSocket.on('exam_submitted_successfully', () => setView('submitted'));
      newSocket.on('exam_time_expired', () => setView('submitted'));
      newSocket.on('exam_force_submitted', (data) => {
        setTerminationReason(data.reason);
        setView('forced');
        
        // Attempt to exit fullscreen securely
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(err => console.log(err));
        }
      });
    }
  };

  const handleExamStart = (data) => {
    // If testing the UI without backend questions, inject mocks here
    if (!data.questions || data.questions.length === 0) {
       data.questions = [
         { id: 'q1', type: 'multiple_choice', points: 10, question_text: 'What is the primary role of the Page Visibility API in this application?', options: ['Detect Tab Switching', 'Prevent Pasting', 'Optimize Images', 'Close the Browser'] },
         { id: 'q2', type: 'essay', points: 25, question_text: 'Explain how the server_end_time approach prevents client-side clock manipulation.' },
       ];
    }
    setExamData(data);
    setView('exam');
  };

  // Switch/Case Router
  switch (view) {
    case 'login':
      return <LoginView onLogin={handleLogin} />;
    case 'lobby':
      return <LobbyView socket={socket} examId={examId} onExamStart={handleExamStart} />;
    case 'exam':
      return <ExamView socket={socket} examId={examId} examData={examData} />;
    case 'submitted':
      return <CompletionView />;
    case 'forced':
      return <ForceSubmitView reason={terminationReason} />;
    case 'teacher_dashboard':
      return <TeacherDashboardView socket={socket} examId={examId} />;
    default:
      return <div>Invalid State</div>;
  }
}