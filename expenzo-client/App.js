import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  Animated,
  Easing,
  SafeAreaView,
  TextInput,
  Image,
  Alert,
  Platform,
  LogBox,
} from 'react-native';

// Suppress the warning/error thrown by expo-notifications in Expo Go
LogBox.ignoreLogs(['expo-notifications: Android Push notifications']);
import {
  Mic,
  Folder,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Shield,
  X,
  ChevronRight,
  Plus,
  Clock,
  Grid,
  BarChart2,
  Settings,
  Bell,
  Sparkles,
  Utensils,
  Car,
  Home,
  Briefcase,
  Plane,
  Wallet,
  Mail,
  Key,
  Eye,
  EyeOff,
  User,
  Lock,
  LogOut,
  Square,
} from 'lucide-react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';

// ─── Local Supabase helpers ───────────────────────────────────────────────────
import { getProjects, getExpenses, insertProject, insertExpense } from './lib/supabase';
import { signUp, signIn, signOut, getSession } from './lib/auth';

// ─── Voice Pipeline: handled by PC backend (faster-whisper + Gemini text) ────
// The app uploads the audio file to the FastAPI backend at API_URL/expense/voice.
// The backend transcribes locally with faster-whisper and extracts entities
// with Gemini text-only API, then saves to Supabase and returns the result.
// No API key or audio processing happens client-side.

/**
 * Uploads the recorded audio file to the PC backend for local STT processing.
 * Backend handles: faster-whisper transcription → Gemini text extraction → Supabase save.
 * Returns the full { expense, analytics } response from the backend.
 */
async function uploadAudioToBackend(audioUri, projectId, backendUrl) {
  const ext = audioUri.split('.').pop().toLowerCase() || 'm4a';
  const filename = `recording.${ext}`;

  const formData = new FormData();
  formData.append('audio', {
    uri: audioUri,
    name: filename,
    type: 'audio/aac', // React Native FormData requires a MIME type
  });
  formData.append('project_id', projectId);

  console.log(`[Backend] Uploading audio to ${backendUrl}/expense/voice ...`);

  const res = await fetch(`${backendUrl}/expense/voice`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type manually — let fetch set the multipart/form-data boundary
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Backend error ${res.status}: ${errText.slice(0, 300)}`);
  }

  return await res.json(); // { message, expense, analytics }
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── API Configuration ────────────────────────────────────────────────────────
// Use your PC's LAN IP (run `ipconfig` to find it).
// Both ports (8000 and 8001) are tried in order; the first reachable one is used.
const BACKEND_URLS = [
  'http://192.168.1.7:8000',
  'http://192.168.1.7:8001',
  'http://10.0.2.2:8000',
  'http://10.0.2.2:8001',
];

// ─── Notification Configuration ───────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Push notification helper ─────────────────────────────────────────────────
async function scheduleHealthNotification(status, projectName, daysLeft) {
  if (status === 'SAFE') return;

  const isCritical = status === 'CRITICAL';
  const title = isCritical
    ? '🚨 Budget Critical!'
    : '⚠️ Budget Warning';
  const body = isCritical
    ? `Only ${daysLeft} day${daysLeft !== 1 ? 's' : ''} of budget remaining for "${projectName}". Take action now!`
    : `You have ~${daysLeft} days left in "${projectName}". Consider reducing spending.`;

  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null, // fire immediately
  });
}

// ─── Icon mapper ──────────────────────────────────────────────────────────────
const renderCategoryIcon = (categoryName, size = 18, color = '#FFF') => {
  switch (categoryName?.toLowerCase()) {
    case 'dining': return <Utensils size={size} color={color} />;
    case 'transport': return <Car size={size} color={color} />;
    case 'housing': return <Home size={size} color={color} />;
    default: return <Briefcase size={size} color={color} />;
  }
};

// ─── Category breakdown helper ────────────────────────────────────────────────
function computeBreakdown(expenses) {
  const totals = {};
  expenses.forEach(e => {
    const cat = (e.category || 'Other');
    totals[cat] = (totals[cat] || 0) + e.amount;
  });
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
}

// ─── Analytics helper ─────────────────────────────────────────────────────────
function computeAnalytics(project, expenses) {
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const budget = project?.total_budget || 1000;
  const remaining = Math.max(0, budget - totalSpent);

  const today = new Date('2026-05-31');
  const rollingSum = expenses
    .filter(e => {
      const d = (today - new Date(e.date)) / 86400000;
      return d >= 0 && d <= 7;
    })
    .reduce((s, e) => s + e.amount, 0);

  const dailyAvg = rollingSum > 0 ? Number((rollingSum / 7).toFixed(2)) : 0;
  let daysLeft = dailyAvg > 0 ? Math.ceil(remaining / dailyAvg) : null;
  let exDate = daysLeft ? new Date(today.getTime() + daysLeft * 86400000).toISOString().split('T')[0] : 'SAFE';
  let status = 'SAFE';
  if (daysLeft !== null) {
    if (daysLeft <= 3) status = 'CRITICAL';
    else if (daysLeft <= 30) status = 'WARNING';
  }

  return { remainingBudget: remaining, totalSpent, dailyAverage: dailyAvg, exhaustionDays: daysLeft, exhaustionDate: exDate, status };
}

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ─── Navigation ─────────────────────────────────────────────────────────
  // 'SPLASH' | 'ONBOARDING_1' | 'ONBOARDING_2' | 'REGISTER' | 'LOGIN' | 'MAIN'
  const [currentScreen, setCurrentScreen] = useState('SPLASH');
  // 'DASHBOARD' | 'HISTORY' | 'ANALYTICS' | 'PROJECTS'
  const [currentTab, setCurrentTab] = useState('DASHBOARD');

  // ─── Auth ────────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(null);
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // ─── Bypass auth state (avoids NONE property mutation crash) ────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // ─── Live data ───────────────────────────────────────────────────────────
  const [projects, setProjects] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);

  // ─── States for requirements ─────────────────────────────────────────────
  const [activeProject, setActiveProject] = useState(null);
  const [metrics, setMetrics] = useState({
    remainingBudget: 0,
    dailyAverage: 0,
    exhaustionDate: 'NO DATA',
    status: null,
  });
  const [recentExpenses, setRecentExpenses] = useState([]);

  // ─── New project form ────────────────────────────────────────────────────
  const [newProjName, setNewProjName] = useState('');
  const [newProjBudget, setNewProjBudget] = useState('');
  const [newProjType, setNewProjType] = useState('');

  // ─── Voice recording ─────────────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const recordingRef = useRef(null);

  // ─── Backend status ──────────────────────────────────────────────────────
  const [backendHealthy, setBackendHealthy] = useState(false);

  // ─── Analytics ───────────────────────────────────────────────────────────
  const [analytics, setAnalytics] = useState({
    remainingBudget: 0, totalSpent: 0, dailyAverage: 0,
    exhaustionDays: null, exhaustionDate: 'SAFE', status: 'SAFE',
  });

  // ─── Animations ──────────────────────────────────────────────────────────
  const [splashProgress] = useState(new Animated.Value(0));
  const [micPulse] = useState(new Animated.Value(1));
  const [equalizerHeights] = useState([
    new Animated.Value(20), new Animated.Value(45), new Animated.Value(60),
    new Animated.Value(35), new Animated.Value(25),
  ]);

  // ─── Analytics timescale ─────────────────────────────────────────────────
  const [analyticsTimescale, setAnalyticsTimescale] = useState('month');

  // ══════════════════════════════════════════════════════════════════════════
  // BOOT: Check session → request permissions
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (currentScreen === 'SPLASH') {
      Animated.timing(splashProgress, {
        toValue: 1, duration: 2200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start(async () => {
        // Check existing Supabase session
        const session = await getSession();
        if (session) {
          setCurrentUser(session.user);
          setCurrentScreen('MAIN');
          fetchInitialData();
        } else {
          setCurrentScreen('ONBOARDING_1');
        }
      });

      // Request permissions on boot
      requestPermissions();
    }
  }, [currentScreen]);

  const requestPermissions = async () => {
    // Audio recording permission
    const { status: audioStatus } = await Audio.requestPermissionsAsync();
    if (audioStatus !== 'granted') {
      console.warn('[Permissions] Microphone permission not granted.');
    }

    // Notifications permission
    const { status: notifStatus } = await Notifications.requestPermissionsAsync();
    if (notifStatus !== 'granted') {
      console.warn('[Permissions] Notification permission not granted.');
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // DATA LOADING from Supabase
  // ══════════════════════════════════════════════════════════════════════════
  // ─── fetchInitialData ──────────────────────────────────────────────────────
  const fetchInitialData = async () => {
    setDataLoading(true);
    try {
      const [fetchedProjects, fetchedExpenses] = await Promise.all([
        getProjects(),
        getExpenses(),
      ]);

      // 1. Verify that the incoming project data is a valid non-empty array
      if (Array.isArray(fetchedProjects) && fetchedProjects.length > 0) {
        setProjects(fetchedProjects);
        setActiveProject(fetchedProjects[0]);
        if (!activeProjectId) {
          setActiveProjectId(fetchedProjects[0].id);
        }
      } else {
        setProjects([]);
        setActiveProject(null);
        setActiveProjectId(null);
      }

      setExpenses(Array.isArray(fetchedExpenses) ? fetchedExpenses : []);
      setRecentExpenses(Array.isArray(fetchedExpenses) ? fetchedExpenses : []);
    } catch (err) {
      console.error('[fetchInitialData] error:', err);
      setProjects([]);
      setActiveProject(null);
      setActiveProjectId(null);
      setExpenses([]);
      setRecentExpenses([]);
    } finally {
      setDataLoading(false);
    }
  };

  // ─── fetchProjectData ──────────────────────────────────────────────────────
  const fetchProjectData = async (projectId) => {
    if (!projectId) return;
    try {
      // Avoid stale backendHealthy state: try primary URL first, fall back to
      // the Android emulator URL if the primary request fails.
      let data = null;
      for (const url of BACKEND_URLS) {
        try {
          const res = await fetch(`${url}/analytics/burn-rate?project_id=${projectId}`);
          if (res.ok) {
            data = await res.json();
            // Mark backend reachable so UI shows the green dot
            setBackendHealthy(true);
            break;
          }
        } catch {
          // Try next URL
        }
      }

      // 2. Add optional chaining and nullish coalescing to setMetrics object keys
      setMetrics({
        remainingBudget: data?.remaining_budget ?? 0,
        dailyAverage: data?.daily_average ?? 0,
        exhaustionDate: data?.exhaustion_date ?? 'NO DATA',
        status: data?.status ?? null,
      });

      const expensesData = await getExpenses(projectId);
      // 3. Ensure setRecentExpenses always receives a guaranteed array fallback
      setRecentExpenses(Array.isArray(expensesData) ? expensesData : []);
    } catch (err) {
      console.error('[fetchProjectData] error:', err);
      setMetrics({
        remainingBudget: 0,
        dailyAverage: 0,
        exhaustionDate: 'NO DATA',
        status: null,
      });
      setRecentExpenses([]);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ANALYTICS: Recompute when active project or expenses change
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (activeProjectId) {
      const proj = projects.find(p => p.id === activeProjectId);
      const projExpenses = expenses.filter(e => e.project_id === activeProjectId);
      setAnalytics(computeAnalytics(proj, projExpenses));
      fetchProjectData(activeProjectId);
    }
  }, [activeProjectId, projects, expenses]);

  // ══════════════════════════════════════════════════════════════════════════
  // BACKEND HEALTH CHECK
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const check = async () => {
      // AbortSignal.timeout() is not available on all RN/Hermes versions;
      // use a manual AbortController + setTimeout instead.
      const makeSignal = (ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      };
      for (const url of BACKEND_URLS) {
        try {
          const r = await fetch(`${url}/health`, { signal: makeSignal(1500) });
          if (r.ok) {
            setBackendHealthy(true);
            return;
          }
        } catch {}
      }
      setBackendHealthy(false);
    };
    check();
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // LISTENING ANIMATION LOOP
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    let pulseLoop, waveLoops = [];
    if (isListening) {
      pulseLoop = Animated.loop(Animated.sequence([
        Animated.timing(micPulse, { toValue: 1.18, duration: 900, useNativeDriver: false }),
        Animated.timing(micPulse, { toValue: 1, duration: 900, useNativeDriver: false }),
      ]));
      pulseLoop.start();

      const animH = (val, min, max, dur) => Animated.loop(Animated.sequence([
        Animated.timing(val, { toValue: max, duration: dur, useNativeDriver: false }),
        Animated.timing(val, { toValue: min, duration: dur, useNativeDriver: false }),
      ]));
      waveLoops = [
        animH(equalizerHeights[0], 12, 40, 350),
        animH(equalizerHeights[1], 20, 60, 280),
        animH(equalizerHeights[2], 25, 75, 450),
        animH(equalizerHeights[3], 15, 50, 310),
        animH(equalizerHeights[4], 10, 35, 390),
      ];
      waveLoops.forEach(l => l.start());
    }
    return () => {
      pulseLoop?.stop();
      waveLoops.forEach(l => l.stop());
    };
  }, [isListening]);

  // ══════════════════════════════════════════════════════════════════════════
  // AUTH HANDLERS
  // ══════════════════════════════════════════════════════════════════════════
  const handleRegister = async () => {
    if (!registerName.trim() || !registerEmail.trim() || !registerPassword) {
      Alert.alert('Missing Fields', 'Please fill in all fields.');
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }
    if (!agreeTerms) {
      Alert.alert('Terms Required', 'You must agree to the Terms of Service.');
      return;
    }
    setAuthLoading(true);
    const { user, session, error } = await signUp(registerEmail.trim(), registerPassword, registerName.trim());

    if (error) {
      setAuthLoading(false);
      Alert.alert('Registration Failed', error.message);
      return;
    }

    if (session) {
      setAuthLoading(false);
      setCurrentUser(user);
      setIsAuthenticated(true);
      setCurrentScreen('MAIN');
      fetchInitialData();
      Alert.alert('🎉 Welcome!', `Account created and logged in as ${registerName.trim()}!`);
    } else {
      // Attempt login immediately
      const { user: loggedInUser, error: loginError } = await signIn(registerEmail.trim(), registerPassword);
      setAuthLoading(false);

      if (loginError) {
        Alert.alert(
          '✅ Account Created!',
          'Your account was created successfully. Please check your email to confirm your account, then log in.',
          [{ text: 'OK', onPress: () => setCurrentScreen('LOGIN') }]
        );
      } else {
        setCurrentUser(loggedInUser);
        setIsAuthenticated(true);
        setCurrentScreen('MAIN');
        fetchInitialData();
        Alert.alert('🎉 Welcome!', `Account created and logged in as ${registerName.trim()}!`);
      }
    }
  };

  const handleLogin = async () => {
    // Validate inputs first
    if (!loginEmail.trim()) {
      Alert.alert('Missing Email', 'Please enter your email address.');
      return;
    }
    if (!loginPassword.trim()) {
      Alert.alert('Missing Password', 'Please enter your password.');
      return;
    }

    setLoading(true);
    const { user, error } = await signIn(loginEmail.trim(), loginPassword);
    setLoading(false);

    if (error) {
      // Show a human-readable error message
      const msg = error.message || 'Login failed. Please check your credentials.';
      Alert.alert('Login Failed', msg);
      return;
    }

    if (!user) {
      Alert.alert('Login Failed', 'No user found. Please check your credentials.');
      return;
    }

    // Successfully authenticated
    setCurrentUser(user);
    setIsAuthenticated(true);
    setCurrentScreen('MAIN');
    fetchInitialData();
  };

  const handleGoogleLogin = () => {
    Alert.alert(
      'Google Sign-In',
      'Google OAuth requires a development build and cannot run inside Expo Go. Please use email and password to sign in.',
      [{ text: 'OK' }]
    );
  };


  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          await signOut();
          setCurrentUser(null);
          setProjects([]);
          setExpenses([]);
          setActiveProjectId(null);
          setActiveProject(null);
          setMetrics({
            remainingBudget: 0,
            dailyAverage: 0,
            exhaustionDate: 'NO DATA',
            status: null,
          });
          setRecentExpenses([]);
          setCurrentScreen('ONBOARDING_1');
        }
      }
    ]);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PROJECT CREATION
  // ══════════════════════════════════════════════════════════════════════════
  const handleCreateProject = async () => {
    if (!newProjName || !newProjBudget) {
      Alert.alert('Invalid Input', 'Please fill in project name and budget.');
      return;
    }
    try {
      const created = await insertProject({
        name: newProjName,
        total_budget: parseFloat(newProjBudget),
        type: newProjType || 'Personal',
      });
      if (!created || !created.id) {
        Alert.alert('Error', 'Failed to create project - invalid response from server.');
        return;
      }
      setProjects(prev => [created, ...prev]);
      setActiveProjectId(created.id);
      setActiveProject(created);
      setNewProjName('');
      setNewProjBudget('');
      setNewProjType('');
      setCurrentTab('DASHBOARD');
      Alert.alert('✅ Budget Created', `"${created.name}" envelope is ready!`);
    } catch (err) {
      Alert.alert('Error', 'Failed to create project. Check your Supabase connection.');
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // REAL AUDIO RECORDING
  // ══════════════════════════════════════════════════════════════════════════
  const startRecording = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        // LOW_QUALITY forces a stable, linear mobile recording format
        // and avoids the container mismatch that HIGH_QUALITY can produce.
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
      console.log('[Audio] Recording started');
    } catch (err) {
      console.error('[Audio] Failed to start recording:', err);
      Alert.alert('Microphone Error', 'Could not access microphone. Please check permissions.');
    }
  };

  const stopRecordingAndProcess = async () => {
    if (!recordingRef.current) {
      Alert.alert('No Recording', 'Please tap the mic and speak before stopping.');
      return;
    }

    setIsRecording(false);
    setIsListening(false);
    setIsProcessing(true);

    let uri = null;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      uri = recordingRef.current.getURI();
      recordingRef.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      console.log('[Audio] Recording stopped. URI:', uri);
    } catch (stopErr) {
      console.error('[Audio] Failed to stop recording:', stopErr.message);
      setIsProcessing(false);
      Alert.alert('Recording Error', 'Failed to stop recording. Please try again.');
      return;
    }

    try {
      // ─── Upload audio to PC backend — faster-whisper STT + Gemini text extraction ───
      // Try the primary LAN URL first, fall back to Android emulator URL if it fails.
      let response = null;
      let lastError = null;

      for (const url of BACKEND_URLS) {
        try {
          console.log(`[Backend] Trying ${url}/expense/voice ...`);
          response = await uploadAudioToBackend(uri, activeProjectId, url);
          console.log('[Backend] Voice pipeline response:', response);
          break; // Success — stop trying fallback URLs
        } catch (uploadErr) {
          console.warn(`[Backend] ${url} failed:`, uploadErr.message);
          lastError = uploadErr;
        }
      }

      if (!response) {
        throw lastError || new Error('All backend URLs failed. Is the uvicorn server running?');
      }

      // Backend already saved to Supabase — add the returned expense to local state
      const exp = response.expense;
      if (exp) {
        setExpenses(prev => [exp, ...prev]);
      }
      setIsProcessing(false);
      Alert.alert(
        '🎙️ Voice Logged!',
        `Detected: "${exp?.transcript || 'expense recorded'}"\n\n` +
        `✔ ₹${exp?.amount ?? '?'} in ${exp?.category ?? 'Other'} on ${exp?.date ?? 'today'}`
      );
    } catch (err) {
      console.error('[Voice] Backend pipeline failed:', err.message);
      setIsProcessing(false);
      Alert.alert(
        '⚠️ Voice Processing Failed',
        `Could not reach the backend server.\n\n` +
        `Make sure:\n` +
        `1. uvicorn is running on your PC (port 8000 or 8001)\n` +
        `2. Your phone and PC are on the same Wi-Fi network\n` +
        `3. BACKEND_URLS in App.js matches your PC's IP address\n\n` +
        `Error: ${err.message.slice(0, 120)}`,
        [{ text: 'OK' }]
      );
    }
  };

  const triggerVoiceSimulation = async () => {
    // Ensure the overlay closes before processing begins
    setIsListening(false);
    setIsRecording(false);
    setIsProcessing(true);
    const mockPhrases = [
      { amount: 15.00, category: 'Dining', date: '2026-05-31', transcript: 'Spent 15 on coffee today' },
      { amount: 42.00, category: 'Transport', date: '2026-05-31', transcript: 'Spent 42 on cab fare today' },
      { amount: 120.00, category: 'Dining', date: '2026-05-30', transcript: 'Spent 120 on dining yesterday' },
      { amount: 450.00, category: 'Housing', date: '2026-05-31', transcript: 'Spent 450 on furniture today' },
      { amount: 95.00, category: 'Entertainment', date: '2026-05-31', transcript: 'Bought movie tickets for 95 today' },
    ];
    const sim = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];

    setTimeout(async () => {
      try {
        const saved = await insertExpense({
          project_id: activeProjectId,
          amount: sim.amount,
          date: sim.date,
          category: sim.category,
          transcript: sim.transcript,
        });
        setExpenses(prev => [saved, ...prev]);
      } catch {
        setExpenses(prev => [{ id: Date.now().toString(), project_id: activeProjectId, ...sim }, ...prev]);
      }
      setIsProcessing(false);
      await scheduleHealthNotification(analytics.status, activeProjObj?.name || 'Budget', analytics.exhaustionDays);
      Alert.alert('🎙️ Voice Log (Simulation)', `Recognized: "${sim.transcript}"\n\nAuto-tagged: ₹${sim.amount} in ${sim.category}`);
    }, 1600);
  };

  const fireHealthNotification = async (serverAnalytics) => {
    const status = serverAnalytics?.status || analytics.status;
    const days = serverAnalytics?.exhaustion_days || analytics.exhaustionDays;
    await scheduleHealthNotification(status, activeProjObj?.name || 'Budget', days);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // SPLASH PROGRESS ANIMATION
  // ══════════════════════════════════════════════════════════════════════════
  const widthInterpolate = splashProgress.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'],
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIVE PROJECT OBJECT (derived)
  // ══════════════════════════════════════════════════════════════════════════
  const activeProjObj = projects.find(p => p.id === activeProjectId) || projects[0];
  const activeProjectExpenses = expenses.filter(e => e.project_id === activeProjectId);
  const breakdown = computeBreakdown(activeProjectExpenses);

  // ══════════════════════════════════════════════════════════════════════════
  // ─────────────────────────── SCREEN: SPLASH ────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (currentScreen === 'SPLASH') {
    return (
      <View style={styles.splashContainer}>
        <View style={styles.splashLogoContainer}>
          <Wallet size={48} color="#A5B4FC" />
        </View>
        <Text style={styles.splashAppName}>Expenzo</Text>
        <View style={styles.splashLoaderBg}>
          <Animated.View style={[styles.splashLoaderFill, { width: widthInterpolate }]} />
        </View>
        <Text style={styles.splashFooter}>✨ POWERED BY AI</Text>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ──────────────────────── SCREEN: ONBOARDING 1 ─────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (currentScreen === 'ONBOARDING_1') {
    return (
      <SafeAreaView style={styles.onboardingContainer}>
        <View style={styles.onboardingVisualCard}>
          <View style={styles.sparkleBadge}>
            <Sparkles size={16} color="#2DD4BF" />
          </View>
          <Text style={styles.cardHeaderSmall}>REAL-TIME ANALYSIS</Text>
          <View style={styles.onboardingShowcaseRow}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(45, 212, 191, 0.15)' }]}>
              <Utensils size={20} color="#2DD4BF" />
            </View>
            <View style={styles.showcaseTextCol}>
              <Text style={styles.showcaseItemTitle}>DINING</Text>
              <Text style={styles.showcaseItemAmt}>₹124.50</Text>
            </View>
            <View style={styles.autoTagBadge}>
              <Text style={styles.autoTagText}>AUTO-TAGGED</Text>
            </View>
          </View>
          <View style={[styles.onboardingShowcaseRow, { marginTop: 12 }]}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(236, 72, 153, 0.15)' }]}>
              <Car size={20} color="#EC4899" />
            </View>
            <View style={styles.showcaseTextCol}>
              <Text style={styles.showcaseItemTitle}>TRANSPORT</Text>
              <Text style={styles.showcaseItemAmt}>₹45.00</Text>
            </View>
            <View style={styles.autoTagBadge}>
              <Text style={styles.autoTagText}>AUTO-TAGGED</Text>
            </View>
          </View>
          <View style={styles.miniEqualizerRow}>
            {[16, 28, 42, 24, 14].map((h, i) => (
              <View key={i} style={[styles.miniEqBar, { height: h, backgroundColor: ['#2DD4BF', '#818CF8', '#EC4899', '#818CF8', '#2DD4BF'][i] }]} />
            ))}
          </View>
        </View>
        <View style={styles.onboardingTextContainer}>
          <Text style={styles.onboardingTitle}>Smart AI{'\n'}Categorization.</Text>
          <Text style={styles.onboardingDesc}>
            Expenzo automatically sorts your spending and predicts your future budget health.
          </Text>
        </View>
        <View style={styles.onboardingFooter}>
          <View style={styles.paginationDotsContainer}>
            <View style={[styles.dot, styles.activeDot]} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
          <TouchableOpacity style={styles.onboardingButton} onPress={() => setCurrentScreen('ONBOARDING_2')}>
            <Text style={styles.onboardingButtonText}>Next</Text>
            <ChevronRight size={18} color="#FFF" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ──────────────────────── SCREEN: ONBOARDING 2 ─────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (currentScreen === 'ONBOARDING_2') {
    return (
      <SafeAreaView style={styles.onboardingContainer}>
        <View style={[styles.onboardingVisualCard, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={styles.floatingProjectCard}>
            <View style={styles.floatingHeaderRow}>
              <View style={[styles.projectIconBox, { backgroundColor: 'rgba(45, 212, 191, 0.15)' }]}>
                <Plane size={18} color="#2DD4BF" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.floatingProjTitle}>Goa Trip</Text>
                <Text style={styles.floatingProjType}>Travel Budget</Text>
              </View>
            </View>
            <View style={styles.horizontalProgressBarBg}>
              <View style={[styles.horizontalProgressBarFill, { width: '75%', backgroundColor: '#2DD4BF' }]} />
            </View>
            <Text style={[styles.fundedPercentText, { color: '#2DD4BF' }]}>75% Spent</Text>
          </View>
          <View style={[styles.floatingProjectCard, styles.floatingProjectCardSecondary]}>
            <View style={styles.floatingHeaderRow}>
              <View style={[styles.projectIconBox, { backgroundColor: 'rgba(236, 72, 153, 0.15)' }]}>
                <Briefcase size={18} color="#EC4899" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.floatingProjTitle}>Home Reno</Text>
                <Text style={styles.floatingProjType}>Improvement</Text>
              </View>
              <View style={styles.checkAddButton}>
                <Plus size={14} color="#FFF" />
              </View>
            </View>
            <View style={styles.horizontalProgressBarBg}>
              <View style={[styles.horizontalProgressBarFill, { width: '30%', backgroundColor: '#EC4899' }]} />
            </View>
            <Text style={[styles.fundedPercentText, { color: '#EC4899' }]}>30% Spent</Text>
          </View>
        </View>
        <View style={styles.onboardingTextContainer}>
          <Text style={styles.onboardingTitle}>Manage multiple{'\n'}projects.</Text>
          <Text style={styles.onboardingDesc}>
            Separate budgets for separate goals. Track everything in one powerful app.
          </Text>
        </View>
        <View style={styles.onboardingFooter}>
          <View style={styles.paginationDotsContainer}>
            <View style={styles.dot} />
            <View style={[styles.dot, styles.activeDot]} />
            <View style={styles.dot} />
          </View>
          <TouchableOpacity style={styles.onboardingButton} onPress={() => setCurrentScreen('REGISTER')}>
            <Text style={styles.onboardingButtonText}>Get Started</Text>
            <ChevronRight size={18} color="#FFF" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─────────────────────────── SCREEN: REGISTER ──────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (currentScreen === 'REGISTER') {
    return (
      <SafeAreaView style={styles.onboardingContainer}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', marginTop: 10, paddingHorizontal: 24 }}>
            <Text style={[styles.splashAppName, { marginBottom: 8 }]}>Expenzo</Text>
            <Text style={[styles.onboardingDesc, { textAlign: 'center', marginTop: 0, marginBottom: 24 }]}>
              Create your account to master your finances.
            </Text>
            <View style={styles.stepProgressRow}>
              <View style={[styles.stepCircle, styles.stepCircleActive]}>
                <User size={16} color="#2DD4BF" />
              </View>
              <View style={[styles.stepLine, styles.stepLineActive]} />
              <View style={styles.stepCircle}>
                <Lock size={16} color="#64748B" />
              </View>
              <View style={styles.stepLine} />
              <View style={styles.stepCircle}>
                <CheckCircle size={16} color="#64748B" />
              </View>
            </View>

            <View style={styles.registerFormContainer}>
              <Text style={styles.registerFormLabel}>Full Name</Text>
              <View style={styles.registerInputWrapper}>
                <User size={18} color="#64748B" style={styles.registerInputIcon} />
                <TextInput
                  style={styles.registerTextInput}
                  placeholder="Alex Sterling"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={registerName}
                  onChangeText={setRegisterName}
                />
              </View>

              <Text style={[styles.registerFormLabel, { marginTop: 18 }]}>Email Address</Text>
              <View style={styles.registerInputWrapper}>
                <Mail size={18} color="#64748B" style={styles.registerInputIcon} />
                <TextInput
                  style={styles.registerTextInput}
                  placeholder="alex@example.com"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={registerEmail}
                  onChangeText={setRegisterEmail}
                />
              </View>

              <Text style={[styles.registerFormLabel, { marginTop: 18 }]}>Password</Text>
              <View style={styles.registerInputWrapper}>
                <Key size={18} color="#64748B" style={styles.registerInputIcon} />
                <TextInput
                  style={styles.registerTextInput}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  secureTextEntry={!showRegisterPassword}
                  autoCapitalize="none"
                  value={registerPassword}
                  onChangeText={setRegisterPassword}
                />
                <TouchableOpacity onPress={() => setShowRegisterPassword(!showRegisterPassword)}>
                  {showRegisterPassword ? <Eye size={18} color="#64748B" /> : <EyeOff size={18} color="#64748B" />}
                </TouchableOpacity>
              </View>

              <Text style={[styles.registerFormLabel, { marginTop: 18 }]}>Confirm Password</Text>
              <View style={styles.registerInputWrapper}>
                <Shield size={18} color="#64748B" style={styles.registerInputIcon} />
                <TextInput
                  style={styles.registerTextInput}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  secureTextEntry={!showRegisterPassword}
                  autoCapitalize="none"
                  value={registerConfirmPassword}
                  onChangeText={setRegisterConfirmPassword}
                />
              </View>

              <TouchableOpacity style={styles.checkboxRowContainer} onPress={() => setAgreeTerms(!agreeTerms)}>
                <View style={[styles.customCheckboxCircle, agreeTerms && styles.customCheckboxCircleActive]}>
                  {agreeTerms && <View style={styles.checkboxInnerDot} />}
                </View>
                <Text style={styles.checkboxLabelText}>
                  I agree to the <Text style={styles.checkboxLinkText}>Terms of Service</Text> and <Text style={styles.checkboxLinkText}>Privacy Policy</Text>.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.onboardingButton, { marginTop: 28, width: '100%', justifyContent: 'center', paddingVertical: 14 }]}
                onPress={handleRegister}
                disabled={authLoading}
              >
                {authLoading
                  ? <ActivityIndicator color="#FFF" />
                  : <>
                      <Text style={[styles.onboardingButtonText, { fontSize: 16 }]}>Create Account</Text>
                      <ChevronRight size={18} color="#FFF" style={{ marginLeft: 6 }} />
                    </>
                }
              </TouchableOpacity>

              <View style={styles.loginRedirectFooter}>
                <Text style={styles.loginRedirectText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => setCurrentScreen('LOGIN')}>
                  <Text style={styles.loginRedirectLink}>Log In</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ──────────────────────────── SCREEN: LOGIN ─────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (currentScreen === 'LOGIN') {
    return (
      <SafeAreaView style={styles.onboardingContainer}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 24 }}>
            <View style={styles.splashLogoContainer}>
              <Wallet size={40} color="#A5B4FC" />
            </View>
            <Text style={[styles.splashAppName, { marginTop: 16, marginBottom: 8 }]}>Welcome Back</Text>
            <Text style={[styles.onboardingDesc, { textAlign: 'center', marginTop: 0, marginBottom: 36 }]}>
              Sign in to access your financial dashboard.
            </Text>

            <View style={[styles.registerFormContainer, { width: '100%' }]}>
              <Text style={styles.registerFormLabel}>Email Address</Text>
              <View style={styles.registerInputWrapper}>
                <Mail size={18} color="#64748B" style={styles.registerInputIcon} />
                <TextInput
                  style={styles.registerTextInput}
                  placeholder="alex@example.com"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={loginEmail}
                  onChangeText={setLoginEmail}
                />
              </View>

              <Text style={[styles.registerFormLabel, { marginTop: 24 }]}>Password</Text>
              <View style={styles.registerInputWrapper}>
                <Key size={18} color="#64748B" style={styles.registerInputIcon} />
                <TextInput
                  style={styles.registerTextInput}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  secureTextEntry={!showLoginPassword}
                  autoCapitalize="none"
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                />
                <TouchableOpacity onPress={() => setShowLoginPassword(!showLoginPassword)}>
                  {showLoginPassword ? <Eye size={18} color="#64748B" /> : <EyeOff size={18} color="#64748B" />}
                </TouchableOpacity>
              </View>

              {/* ── Continue button — calls real Supabase signIn ── */}
              <TouchableOpacity
                style={[styles.onboardingButton, { marginTop: 36, width: '100%', justifyContent: 'center', paddingVertical: 16 }]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#FFF" />
                  : <Text style={[styles.onboardingButtonText, { fontSize: 16 }]}>Continue</Text>
                }
              </TouchableOpacity>

              {/* ── Continue with Google — not supported in Expo Go ── */}
              <TouchableOpacity
                style={[
                  styles.onboardingButton,
                  {
                    marginTop: 14,
                    width: '100%',
                    justifyContent: 'center',
                    paddingVertical: 16,
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    borderWidth: 1,
                    borderColor: 'rgba(165,180,252,0.25)',
                  }
                ]}
                onPress={handleGoogleLogin}
                disabled={loading}
              >
                <Text style={[styles.onboardingButtonText, { fontSize: 15, color: '#A5B4FC' }]}>
                  🔗  Continue with Google
                </Text>
              </TouchableOpacity>

              <View style={[styles.loginRedirectFooter, { marginTop: 24 }]}>
                <Text style={styles.loginRedirectText}>Don't have an account? </Text>
                <TouchableOpacity onPress={() => setCurrentScreen('REGISTER')}>
                  <Text style={styles.loginRedirectLink}>Register</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ──────────────────────────── SCREEN: MAIN ──────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={styles.mainContainer}>

      {/* ─── Header ─── */}
      <View style={styles.mainHeaderRow}>
        <View style={styles.profileAvatarBox}>
          <Image
            source={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=256&auto=format&fit=crop' }}
            style={styles.profileImage}
          />
        </View>
        <Text style={styles.headerAppName}>Expenzo</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {backendHealthy && (
            <View style={styles.backendStatusDot} />
          )}
          <TouchableOpacity style={styles.headerBellContainer} onPress={handleSignOut}>
            <LogOut size={18} color="#A5B4FC" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ─── Loading overlay ─── */}
      {dataLoading && (
        <View style={styles.dataLoadingBanner}>
          <ActivityIndicator size="small" color="#A5B4FC" />
          <Text style={styles.dataLoadingText}>Loading from Supabase...</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: DASHBOARD
        ══════════════════════════════════════════════════════════════════ */}
        {currentTab === 'DASHBOARD' && (
          <View style={styles.tabContentBlock}>
            <Text style={styles.tabHeadingTitle}>Dashboard</Text>
            <Text style={styles.tabSubtitleText}>Real-time active budget envelopes</Text>

            {/* Project Switcher */}
            {projects.length === 0 && !dataLoading ? (
              <View style={[styles.emptyExpensesState, { marginTop: 20 }]}>
                <Folder size={32} color="#64748B" />
                <Text style={[styles.emptyExpensesText, { marginTop: 12 }]}>No projects yet</Text>
                <Text style={styles.emptyExpensesSubtext}>Create a budget envelope in the Projects tab.</Text>
                <TouchableOpacity
                  style={[styles.onboardingButton, { marginTop: 16, paddingHorizontal: 24 }]}
                  onPress={() => setCurrentTab('PROJECTS')}
                >
                  <Plus size={14} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.onboardingButtonText}>Create Budget</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalSwitcherList}>
                  {projects.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.switchCapsule, activeProjectId === p.id && styles.switchCapsuleActive]}
                      onPress={() => { setActiveProjectId(p.id); setActiveProject(p); }}
                    >
                      <Folder size={15} color={activeProjectId === p.id ? '#0F0F12' : '#94A3B8'} style={{ marginRight: 6 }} />
                      <Text style={[styles.switchCapsuleText, activeProjectId === p.id && styles.switchCapsuleTextActive]}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Metric Grid */}
                <View style={styles.dashboardMetricGrid}>
                  <View style={styles.metricCardBox}>
                    <Text style={styles.metricCardLabel}>Remaining Budget</Text>
                    <Text style={styles.metricCardValue}>₹{analytics.remainingBudget.toLocaleString()}</Text>
                  </View>
                  <View style={styles.metricCardBox}>
                    <Text style={styles.metricCardLabel}>Daily Burn Rate</Text>
                    <Text style={styles.metricCardValue}>₹{analytics.dailyAverage}/day</Text>
                  </View>
                </View>

                {/* Health Badge */}
                <View style={[
                  styles.healthAlertBadge,
                  analytics.status === 'CRITICAL' ? styles.healthCritical : analytics.status === 'WARNING' ? styles.healthWarning : styles.healthSafe
                ]}>
                  <AlertTriangle
                    size={18}
                    color={analytics.status === 'CRITICAL' ? '#EF4444' : analytics.status === 'WARNING' ? '#F59E0B' : '#10B981'}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={styles.healthAlertText}>
                    Health: {analytics.status} ({analytics.exhaustionDays !== null ? `${analytics.exhaustionDays} days left` : 'No Depletion'})
                  </Text>
                </View>

                {/* Total spent */}
                <View style={[styles.metricCardBox, { marginTop: 12 }]}>
                  <Text style={styles.metricCardLabel}>Total Spent — {activeProjObj?.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 6 }}>
                    <Text style={[styles.metricCardValue, { color: '#EC4899' }]}>
                      ₹{analytics.totalSpent.toLocaleString()}
                    </Text>
                    <Text style={{ color: '#64748B', marginLeft: 6, fontSize: 12 }}>
                      / ₹{(activeProjObj?.total_budget || 0).toLocaleString()}
                    </Text>
                  </View>
                  <View style={[styles.breakdownBarBg, { marginTop: 10 }]}>
                    <View style={[
                      styles.breakdownBarFill,
                      {
                        width: `${Math.min(100, Math.round((analytics.totalSpent / (activeProjObj?.total_budget || 1)) * 100))}%`,
                        backgroundColor: analytics.status === 'CRITICAL' ? '#EF4444' : analytics.status === 'WARNING' ? '#F59E0B' : '#2DD4BF'
                      }
                    ]} />
                  </View>
                </View>

                {/* Recent Transcripts */}
                <View style={styles.recentActivityBlock}>
                  <Text style={styles.recentSectionTitle}>Recent Transcripts</Text>
                  {activeProjectExpenses.length === 0 ? (
                    <View style={styles.emptyExpensesState}>
                      <Text style={styles.emptyExpensesText}>No expenses logged for this project yet.</Text>
                      <Text style={styles.emptyExpensesSubtext}>Tap the microphone button below to log one.</Text>
                    </View>
                  ) : (
                    activeProjectExpenses.slice(0, 8).map((e) => (
                      <View key={e.id} style={styles.expenseLogItem}>
                        <View style={[styles.logIconBox, { backgroundColor: 'rgba(165, 180, 252, 0.15)' }]}>
                          {renderCategoryIcon(e.category, 16, '#A5B4FC')}
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.expenseLogCategory}>{(e.category || 'OTHER').toUpperCase()}</Text>
                          <Text style={styles.expenseLogTranscript} numberOfLines={1}>"{e.transcript || 'Voice note logged'}"</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.expenseLogAmt}>₹{e.amount}</Text>
                          <Text style={styles.expenseLogDate}>{e.date}</Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: HISTORY
        ══════════════════════════════════════════════════════════════════ */}
        {currentTab === 'HISTORY' && (
          <View style={styles.tabContentBlock}>
            <Text style={styles.tabHeadingTitle}>History</Text>
            <Text style={styles.tabSubtitleText}>Complete ledger accounts and details</Text>
            <View style={{ marginTop: 18 }}>
              {expenses.length === 0 ? (
                <View style={styles.emptyExpensesState}>
                  <Clock size={32} color="#64748B" />
                  <Text style={[styles.emptyExpensesText, { marginTop: 12 }]}>No expenses logged yet</Text>
                  <Text style={styles.emptyExpensesSubtext}>Use the mic button to log your first expense.</Text>
                </View>
              ) : (
                expenses.map((e) => {
                  const proj = projects.find(p => p.id === e.project_id);
                  return (
                    <View key={e.id} style={[styles.expenseLogItem, { marginBottom: 10 }]}>
                      <View style={[styles.logIconBox, { backgroundColor: 'rgba(45, 212, 191, 0.15)' }]}>
                        {renderCategoryIcon(e.category, 16, '#2DD4BF')}
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.expenseLogCategory}>{(e.category || 'OTHER').toUpperCase()}</Text>
                        <Text style={[styles.expenseLogTranscript, { color: '#A5B4FC', fontSize: 11 }]}>Project: {proj?.name || 'Unknown'}</Text>
                        <Text style={[styles.expenseLogTranscript, { marginTop: 2 }]} numberOfLines={2}>"{e.transcript || 'Voice note logged.'}"</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                        <Text style={[styles.expenseLogAmt, { color: '#FFF' }]}>₹{e.amount}</Text>
                        <Text style={styles.expenseLogDate}>{e.date}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: ANALYTICS
        ══════════════════════════════════════════════════════════════════ */}
        {currentTab === 'ANALYTICS' && (
          <View style={styles.tabContentBlock}>
            <Text style={styles.tabHeadingTitle}>Analytics</Text>
            <Text style={styles.tabSubtitleText}>Deep dive into your financial patterns.</Text>

            {/* Timescale pills */}
            <View style={styles.pillSwitchContainer}>
              {['week', 'month', 'year', 'all'].map((ts) => (
                <TouchableOpacity
                  key={ts}
                  style={[styles.pillOption, analyticsTimescale === ts && styles.pillOptionActive]}
                  onPress={() => setAnalyticsTimescale(ts)}
                >
                  <Text style={[styles.pillText, analyticsTimescale === ts && styles.pillTextActive]}>
                    {ts.charAt(0).toUpperCase() + ts.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Main chart card */}
            <View style={styles.analyticsChartCard}>
              <Text style={styles.chartCardHeaderLabel}>TOTAL SPENT — {(activeProjObj?.name || 'ALL').toUpperCase()}</Text>
              <Text style={styles.chartCardHeaderValue}>₹{analytics.totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
              <View style={styles.svgContainer}>
                <Svg height="150" width={SCREEN_WIDTH - 80}>
                  <Defs>
                    <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor="#2DD4BF" stopOpacity="0.3" />
                      <Stop offset="1" stopColor="#2DD4BF" stopOpacity="0" />
                    </LinearGradient>
                  </Defs>
                  <Path d="M0,120 C40,110 80,60 120,80 C160,100 200,30 240,70 C280,110 320,30 360,50 L360,150 L0,150 Z" fill="url(#grad)" />
                  <Path d="M0,120 C40,110 80,60 120,80 C160,100 200,30 240,70 C280,110 320,30 360,50" fill="none" stroke="#2DD4BF" strokeWidth="3.5" />
                </Svg>
              </View>
              <View style={styles.chartTimelineLabelsRow}>
                <Text style={styles.timelineLabel}>1st</Text>
                <Text style={styles.timelineLabel}>8th</Text>
                <Text style={styles.timelineLabel}>15th</Text>
                <Text style={styles.timelineLabel}>22nd</Text>
                <Text style={styles.timelineLabel}>31st</Text>
              </View>
            </View>

            {/* Burn Rate Card */}
            <View style={styles.analyticsPredictionCard}>
              <View style={styles.predictionHeader}>
                <Sparkles size={16} color="#EC4899" />
                <Text style={styles.predictionTitle}>Burn Rate Prediction</Text>
              </View>
              <Text style={styles.predictionDaysLarge}>
                {analytics.exhaustionDays !== null ? `${analytics.exhaustionDays} Days` : 'SAFE'}
              </Text>
              <Text style={styles.predictionBody}>
                {analytics.exhaustionDays !== null
                  ? `Your current budget for "${activeProjObj?.name}" will be depleted in ~${analytics.exhaustionDays} days at current spending pace.`
                  : 'Your budget is completely secure! No high depletion averages detected.'}
              </Text>
              <View style={styles.predictionBarContainer}>
                <View style={[
                  styles.predictionBarFill,
                  {
                    width: analytics.exhaustionDays !== null ? `${Math.max(5, Math.min(100, (30 - analytics.exhaustionDays) * 3.3))}%` : '5%',
                    backgroundColor: analytics.status === 'CRITICAL' ? '#EF4444' : '#EC4899'
                  }
                ]} />
              </View>
            </View>

            {/* Category Breakdown */}
            <View style={styles.categoryBreakdownCard}>
              <Text style={styles.breakdownHeaderTitle}>Category Breakdown</Text>
              {breakdown.length === 0 ? (
                <Text style={[styles.expenseLogTranscript, { textAlign: 'center', paddingVertical: 12 }]}>No data yet.</Text>
              ) : (
                breakdown.map(([cat, total], i) => {
                  const colors = ['#818CF8', '#2DD4BF', '#EC4899', '#F59E0B'];
                  const max = breakdown[0][1];
                  return (
                    <View key={cat} style={[styles.breakdownRow, i > 0 && { marginTop: 16 }]}>
                      <View style={[styles.breakdownIconCircle, { backgroundColor: `${colors[i]}22` }]}>
                        {renderCategoryIcon(cat, 16, colors[i])}
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={styles.breakdownLabelRow}>
                          <Text style={styles.breakdownLabel}>{cat}</Text>
                          <Text style={styles.breakdownValue}>₹{total.toLocaleString()}</Text>
                        </View>
                        <View style={styles.breakdownBarBg}>
                          <View style={[styles.breakdownBarFill, { width: `${(total / max) * 100}%`, backgroundColor: colors[i] }]} />
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            {/* Smart Insight */}
            <View style={styles.smartInsightCard}>
              <View style={styles.smartInsightHeaderRow}>
                <View style={styles.avatarOrbGradient}>
                  <Sparkles size={16} color="#2DD4BF" />
                </View>
                <Text style={styles.insightLabel}>Smart Insight</Text>
              </View>
              <Text style={styles.insightQuote}>
                {analytics.status === 'CRITICAL'
                  ? `"🚨 Critical alert: At ₹${analytics.dailyAverage}/day burn rate, your "${activeProjObj?.name}" budget will be exhausted in ${analytics.exhaustionDays} days. Immediate action recommended!"`
                  : analytics.status === 'WARNING'
                  ? `"⚠️ You are on track to exhaust your "${activeProjObj?.name}" budget in ${analytics.exhaustionDays} days. Consider reducing daily spending by 20%."`
                  : `"✅ Your spending for "${activeProjObj?.name}" looks healthy! Daily burn rate is ₹${analytics.dailyAverage}. Keep up the discipline!"`
                }
              </Text>
            </View>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: PROJECTS
        ══════════════════════════════════════════════════════════════════ */}
        {currentTab === 'PROJECTS' && (
          <View style={styles.tabContentBlock}>
            <Text style={styles.tabHeadingTitle}>Budgets</Text>
            <Text style={styles.tabSubtitleText}>Adjust and manage project spending rules</Text>

            {/* Add Project Form */}
            <View style={[styles.analyticsChartCard, { padding: 20, marginTop: 14 }]}>
              <Text style={styles.formTitle}>Add Budget Envelope</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Project Name (e.g. Goa Trip)"
                placeholderTextColor="rgba(255, 255, 255, 0.35)"
                value={newProjName}
                onChangeText={setNewProjName}
              />
              <TextInput
                style={styles.formInput}
                placeholder="Total Budget Limit (e.g. 5000)"
                placeholderTextColor="rgba(255, 255, 255, 0.35)"
                keyboardType="numeric"
                value={newProjBudget}
                onChangeText={setNewProjBudget}
              />
              <TextInput
                style={styles.formInput}
                placeholder="Type (e.g. Travel, Improvement)"
                placeholderTextColor="rgba(255, 255, 255, 0.35)"
                value={newProjType}
                onChangeText={setNewProjType}
              />
              <TouchableOpacity
                style={[styles.onboardingButton, { marginTop: 14, width: '100%', justifyContent: 'center' }]}
                onPress={handleCreateProject}
              >
                <Plus size={16} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.onboardingButtonText}>Save Envelope</Text>
              </TouchableOpacity>
            </View>

            {/* Project list */}
            <View style={{ marginTop: 20 }}>
              <Text style={styles.recentSectionTitle}>Active Envelopes</Text>
              {projects.length === 0 ? (
                <View style={styles.emptyExpensesState}>
                  <Text style={styles.emptyExpensesText}>No budget envelopes yet.</Text>
                  <Text style={styles.emptyExpensesSubtext}>Create one above to get started.</Text>
                </View>
              ) : (
                projects.map((p) => {
                  const projExpenses = expenses.filter(e => e.project_id === p.id);
                  const totalSpent = projExpenses.reduce((s, e) => s + e.amount, 0);
                  const pct = Math.min(100, Math.round((totalSpent / (p.total_budget || 1)) * 100));
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.expenseLogItem, { marginBottom: 12 }]}
                      onPress={() => { setActiveProjectId(p.id); setActiveProject(p); setCurrentTab('DASHBOARD'); }}
                    >
                      <View style={[styles.logIconBox, { backgroundColor: 'rgba(165, 180, 252, 0.15)' }]}>
                        <Folder size={18} color="#A5B4FC" />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[styles.expenseLogCategory, { color: '#FFF' }]}>{p.name}</Text>
                        <Text style={styles.expenseLogTranscript}>{p.type || 'Personal'}</Text>
                        <View style={[styles.breakdownBarBg, { marginTop: 6, width: '80%' }]}>
                          <View style={[styles.breakdownBarFill, { width: `${pct}%`, backgroundColor: pct > 80 ? '#EF4444' : '#818CF8' }]} />
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                        <Text style={[styles.expenseLogAmt, { color: '#2DD4BF' }]}>₹{totalSpent} / ₹{p.total_budget}</Text>
                        <Text style={styles.expenseLogDate}>{pct}% Used</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ══════════════════════════════════════════════════════════════════
          VOICE LISTENING OVERLAY
      ══════════════════════════════════════════════════════════════════ */}
      {isListening && (
        <View style={styles.listeningOverlayBg}>

          {/* Top row: project context label + cancel button side-by-side */}
          <View style={styles.overlayTopRow}>
            <Text style={styles.activeProjectContextLabel}>
              LOGGING FOR: {(activeProjObj?.name || 'BUDGET').toUpperCase()}
            </Text>
            <TouchableOpacity
              style={styles.cancelOverlayButton}
              onPress={async () => {
                if (isRecording && recordingRef.current) {
                  try {
                    await recordingRef.current.stopAndUnloadAsync();
                  } catch {}
                  recordingRef.current = null;
                  setIsRecording(false);
                  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
                }
                setIsListening(false);
              }}
            >
              <X size={16} color="#EF4444" style={{ marginRight: 6 }} />
              <Text style={styles.cancelButtonText}>CANCEL</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.listeningMicContainer}>
            <Animated.View style={[styles.breathingOuterRing, { transform: [{ scale: micPulse }] }]} />
            <TouchableOpacity
              style={[styles.recordingCenterButton, isRecording && { backgroundColor: '#EF4444' }]}
              onPress={isRecording ? stopRecordingAndProcess : startRecording}
            >
              {isRecording ? <Square size={40} color="#FFF" /> : <Mic size={48} color="#FFF" />}
            </TouchableOpacity>
          </View>

          <View style={styles.equalizerRow}>
            {equalizerHeights.map((h, i) => (
              <Animated.View key={i} style={[styles.eqBar, {
                height: h,
                backgroundColor: ['#2DD4BF', '#818CF8', '#EC4899', '#818CF8', '#2DD4BF'][i]
              }]} />
            ))}
          </View>

          <View style={styles.listeningTextWrapper}>
            <Text style={styles.listeningHeadline}>
              {isRecording ? 'Recording...' : 'Tap mic to start'}
            </Text>
            <Text style={styles.listeningSubtext}>
              {isRecording ? 'Tap the button again to stop & process' : 'Say something like'}
            </Text>
            {!isRecording && (
              <Text style={styles.listeningPromptExample}>"Spent ₹15 on coffee today"</Text>
            )}
          </View>

          {/* Spacer keeps bottom padding consistent */}
          <View style={{ height: 20 }} />
        </View>
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <View style={styles.listeningOverlayBg}>
          <ActivityIndicator size="large" color="#A5B4FC" />
          <Text style={[styles.listeningHeadline, { marginTop: 20 }]}>Processing Voice Note...</Text>
          <Text style={styles.listeningSubtext}>Gemini AI is categorizing your spending</Text>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM NAVIGATION
      ══════════════════════════════════════════════════════════════════ */}
      {!isListening && !isProcessing && (
        <View style={styles.navigationTabBar}>
          {[
            { key: 'DASHBOARD', icon: Grid, label: 'Dashboard' },
            { key: 'HISTORY', icon: Clock, label: 'History' },
          ].map(({ key, icon: Icon, label }) => (
            <TouchableOpacity key={key} style={styles.navigationTabButton} onPress={() => setCurrentTab(key)}>
              <Icon size={22} color={currentTab === key ? '#A5B4FC' : '#64748B'} />
              <Text style={[styles.tabButtonLabel, currentTab === key && styles.tabButtonLabelActive]}>{label}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.tabCenterFloatingMicButton}
            onPress={() => { setIsListening(true); }}
          >
            <Mic size={26} color="#FFF" />
          </TouchableOpacity>

          {[
            { key: 'ANALYTICS', icon: BarChart2, label: 'Analytics' },
            { key: 'PROJECTS', icon: Folder, label: 'Projects' },
          ].map(({ key, icon: Icon, label }) => (
            <TouchableOpacity key={key} style={styles.navigationTabButton} onPress={() => setCurrentTab(key)}>
              <Icon size={22} color={currentTab === key ? '#A5B4FC' : '#64748B'} />
              <Text style={[styles.tabButtonLabel, currentTab === key && styles.tabButtonLabelActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLES
// ═════════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  splashContainer: { flex: 1, backgroundColor: '#0F0F12', justifyContent: 'center', alignItems: 'center' },
  splashLogoContainer: {
    width: 100, height: 100, borderRadius: 26,
    backgroundColor: 'rgba(165, 180, 252, 0.08)',
    borderWidth: 1.5, borderColor: 'rgba(165, 180, 252, 0.3)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#A5B4FC', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 4,
  },
  splashAppName: { fontSize: 34, fontWeight: 'bold', color: '#FFF', letterSpacing: 1.2, marginBottom: 40 },
  splashLoaderBg: { width: '60%', height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginBottom: 100 },
  splashLoaderFill: { height: '100%', backgroundColor: '#A5B4FC', borderRadius: 3 },
  splashFooter: { fontSize: 10, fontWeight: 'bold', color: 'rgba(165, 180, 252, 0.5)', letterSpacing: 3, position: 'absolute', bottom: 50 },

  onboardingContainer: { flex: 1, backgroundColor: '#0F0F12', justifyContent: 'space-between', paddingTop: 40, paddingBottom: 20 },
  onboardingVisualCard: {
    height: SCREEN_HEIGHT * 0.42, marginHorizontal: 24, marginTop: 20,
    backgroundColor: 'rgba(30, 30, 45, 0.45)', borderRadius: 32,
    borderWidth: 1, borderColor: 'rgba(165, 180, 252, 0.08)',
    padding: 24, justifyContent: 'center', position: 'relative',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 16,
  },
  sparkleBadge: { position: 'absolute', top: 20, right: 20, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(45, 212, 191, 0.12)', justifyContent: 'center', alignItems: 'center' },
  cardHeaderSmall: { fontSize: 11, fontWeight: 'bold', color: 'rgba(165, 180, 252, 0.6)', letterSpacing: 2, marginBottom: 20 },
  onboardingShowcaseRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15, 15, 22, 0.6)', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.04)' },
  iconCircle: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  showcaseTextCol: { flex: 1, marginLeft: 12 },
  showcaseItemTitle: { fontSize: 12, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.8)', letterSpacing: 1 },
  showcaseItemAmt: { fontSize: 16, fontWeight: 'bold', color: '#FFF', marginTop: 2 },
  autoTagBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(45, 212, 191, 0.1)' },
  autoTagText: { fontSize: 8, fontWeight: 'bold', color: '#2DD4BF', letterSpacing: 0.5 },
  miniEqualizerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 8, marginTop: 34, height: 50 },
  miniEqBar: { width: 6, borderRadius: 3, opacity: 0.85 },
  onboardingTextContainer: { paddingHorizontal: 28, marginTop: 10 },
  onboardingTitle: { fontSize: 34, fontWeight: '800', color: '#FFF', letterSpacing: 0.5, lineHeight: 42 },
  onboardingDesc: { fontSize: 15, color: '#94A3B8', lineHeight: 24, marginTop: 14, fontWeight: '500' },
  onboardingFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, marginBottom: 10 },
  paginationDotsContainer: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.15)' },
  activeDot: { width: 18, backgroundColor: '#A5B4FC' },
  onboardingButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#2563EB',
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24,
    shadowColor: '#2563EB', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 3,
  },
  onboardingButtonText: { fontSize: 14, fontWeight: 'bold', color: '#FFF' },

  floatingProjectCard: {
    width: '80%', backgroundColor: 'rgba(15, 15, 22, 0.8)', borderRadius: 24, padding: 16,
    borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 12, zIndex: 1,
  },
  floatingProjectCardSecondary: { marginTop: -20, marginLeft: 30, opacity: 0.9, zIndex: 2, borderWidth: 1.5, borderColor: 'rgba(165, 180, 252, 0.15)' },
  floatingHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  projectIconBox: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  floatingProjTitle: { fontSize: 14, fontWeight: 'bold', color: '#FFF' },
  floatingProjType: { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  checkAddButton: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(165, 180, 252, 0.15)', justifyContent: 'center', alignItems: 'center' },
  horizontalProgressBarBg: { height: 6, backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 3, marginTop: 16, overflow: 'hidden' },
  horizontalProgressBarFill: { height: '100%', borderRadius: 3 },
  fundedPercentText: { fontSize: 10, fontWeight: 'bold', textAlign: 'right', marginTop: 8, letterSpacing: 0.5 },

  mainContainer: { flex: 1, backgroundColor: '#0F0F12', paddingTop: 10 },
  mainHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  profileAvatarBox: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', borderWidth: 1.5, borderColor: '#A5B4FC' },
  profileImage: { width: '100%', height: '100%' },
  headerAppName: { fontSize: 20, fontWeight: 'bold', color: '#FFF', letterSpacing: 0.5 },
  headerBellContainer: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255, 255, 255, 0.04)', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  backendStatusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },

  dataLoadingBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8, backgroundColor: 'rgba(165, 180, 252, 0.05)' },
  dataLoadingText: { fontSize: 12, color: '#A5B4FC', fontWeight: '600' },

  tabContentBlock: { paddingHorizontal: 24, paddingTop: 20 },
  tabHeadingTitle: { fontSize: 28, fontWeight: 'bold', color: '#FFF' },
  tabSubtitleText: { fontSize: 14, color: '#94A3B8', marginTop: 4, fontWeight: '500' },
  horizontalSwitcherList: { paddingVertical: 16, gap: 8 },
  switchCapsule: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.04)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.03)' },
  switchCapsuleActive: { backgroundColor: '#A5B4FC' },
  switchCapsuleText: { fontSize: 13, color: '#94A3B8', fontWeight: '600' },
  switchCapsuleTextActive: { color: '#0F0F12', fontWeight: 'bold' },

  dashboardMetricGrid: { flexDirection: 'row', gap: 12, marginTop: 4 },
  metricCardBox: { flex: 1, backgroundColor: 'rgba(30, 30, 45, 0.45)', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: 'rgba(165, 180, 252, 0.08)' },
  metricCardLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '600', letterSpacing: 0.5 },
  metricCardValue: { fontSize: 20, fontWeight: 'bold', color: '#FFF', marginTop: 6 },
  healthAlertBadge: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, marginTop: 12, borderWidth: 1 },
  healthSafe: { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.2)' },
  healthWarning: { backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.2)' },
  healthCritical: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)' },
  healthAlertText: { fontSize: 13, fontWeight: '700', color: '#E2E8F0' },

  recentActivityBlock: { marginTop: 24 },
  recentSectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#FFF', marginBottom: 12, letterSpacing: 0.5 },
  emptyExpensesState: { padding: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.01)', borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.05)' },
  emptyExpensesText: { fontSize: 14, fontWeight: 'bold', color: '#94A3B8', textAlign: 'center' },
  emptyExpensesSubtext: { fontSize: 12, color: '#64748B', marginTop: 6, textAlign: 'center' },
  expenseLogItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(30, 30, 45, 0.35)', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.03)', marginBottom: 8 },
  logIconBox: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  expenseLogCategory: { fontSize: 12, fontWeight: 'bold', color: '#FFF', letterSpacing: 0.5 },
  expenseLogTranscript: { fontSize: 12, color: '#64748B', marginTop: 3 },
  expenseLogAmt: { fontSize: 15, fontWeight: 'bold', color: '#EF4444' },
  expenseLogDate: { fontSize: 10, color: '#64748B', marginTop: 4 },

  pillSwitchContainer: { flexDirection: 'row', backgroundColor: 'rgba(255, 255, 255, 0.04)', borderRadius: 20, padding: 4, marginVertical: 16, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.02)' },
  pillOption: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 16 },
  pillOptionActive: { backgroundColor: '#2563EB', shadowColor: '#2563EB', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  pillText: { fontSize: 12, fontWeight: '600', color: '#94A3B8' },
  pillTextActive: { fontSize: 12, fontWeight: 'bold', color: '#FFF' },
  analyticsChartCard: { backgroundColor: 'rgba(30, 30, 45, 0.55)', borderRadius: 28, borderWidth: 1, borderColor: 'rgba(165, 180, 252, 0.08)', padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 16 },
  chartCardHeaderLabel: { fontSize: 10, fontWeight: 'bold', color: '#94A3B8', letterSpacing: 1.5 },
  chartCardHeaderValue: { fontSize: 30, fontWeight: 'bold', color: '#FFF', marginTop: 6 },
  svgContainer: { height: 150, marginTop: 20, alignItems: 'center', justifyContent: 'center' },
  chartTimelineLabelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 4 },
  timelineLabel: { fontSize: 10, color: '#64748B', fontWeight: '600' },

  analyticsPredictionCard: { backgroundColor: 'rgba(15, 15, 22, 0.8)', borderRadius: 24, padding: 20, borderWidth: 1.5, borderColor: 'rgba(165, 180, 252, 0.15)', marginTop: 16 },
  predictionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  predictionTitle: { fontSize: 13, fontWeight: 'bold', color: '#FFF', letterSpacing: 0.5 },
  predictionDaysLarge: { fontSize: 34, fontWeight: '800', color: '#2DD4BF', marginTop: 12 },
  predictionBody: { fontSize: 13, color: '#94A3B8', lineHeight: 20, marginTop: 8 },
  predictionBarContainer: { height: 6, backgroundColor: 'rgba(255, 255, 255, 0.06)', borderRadius: 3, marginTop: 16, overflow: 'hidden' },
  predictionBarFill: { height: '100%', borderRadius: 3 },

  categoryBreakdownCard: { backgroundColor: 'rgba(30, 30, 45, 0.45)', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(165, 180, 252, 0.06)', marginTop: 16 },
  breakdownHeaderTitle: { fontSize: 15, fontWeight: 'bold', color: '#FFF', marginBottom: 16, letterSpacing: 0.5 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center' },
  breakdownIconCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  breakdownLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  breakdownValue: { fontSize: 13, fontWeight: 'bold', color: '#94A3B8' },
  breakdownBarBg: { height: 4, backgroundColor: 'rgba(255, 255, 255, 0.06)', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  breakdownBarFill: { height: '100%', borderRadius: 2 },

  smartInsightCard: { backgroundColor: 'rgba(15, 15, 22, 0.7)', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.03)', marginTop: 16 },
  smartInsightHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatarOrbGradient: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(45, 212, 191, 0.12)', justifyContent: 'center', alignItems: 'center' },
  insightLabel: { fontSize: 11, fontWeight: 'bold', color: '#2DD4BF', letterSpacing: 1 },
  insightQuote: { fontSize: 13, color: '#94A3B8', lineHeight: 20, marginTop: 10, fontStyle: 'italic' },

  formTitle: { fontSize: 15, fontWeight: 'bold', color: '#FFF', marginBottom: 14 },
  formInput: { backgroundColor: 'rgba(15, 15, 22, 0.6)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.06)', padding: 12, color: '#FFF', fontSize: 13, marginBottom: 10 },

  listeningOverlayBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0F0F12', zIndex: 99, justifyContent: 'space-between', alignItems: 'center', paddingTop: 56, paddingBottom: 40 },
  overlayTopRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  activeProjectContextLabel: { fontSize: 10, fontWeight: 'bold', color: 'rgba(165, 180, 252, 0.6)', letterSpacing: 2 },
  listeningMicContainer: { width: 220, height: 220, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  breathingOuterRing: { position: 'absolute', width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(37, 99, 235, 0.18)', borderWidth: 1.5, borderColor: 'rgba(37, 99, 235, 0.3)' },
  recordingCenterButton: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#2563EB', justifyContent: 'center', alignItems: 'center', shadowColor: '#2563EB', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 18, elevation: 6 },
  equalizerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 10, height: 80, marginVertical: 10 },
  eqBar: { width: 8, borderRadius: 4 },
  listeningTextWrapper: { alignItems: 'center', paddingHorizontal: 40 },
  listeningHeadline: { fontSize: 26, fontWeight: 'bold', color: '#FFF', letterSpacing: 0.5 },
  listeningSubtext: { fontSize: 14, color: '#64748B', marginTop: 8, fontWeight: '600' },
  listeningPromptExample: { fontSize: 14, color: '#2DD4BF', fontWeight: 'bold', marginTop: 6, textAlign: 'center' },
  cancelOverlayButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)', paddingHorizontal: 22, paddingVertical: 10, borderRadius: 20 },
  cancelButtonText: { fontSize: 11, fontWeight: 'bold', color: '#EF4444', letterSpacing: 1 },

  navigationTabBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 74, backgroundColor: 'rgba(15, 15, 22, 0.95)', borderTopWidth: 1, borderColor: 'rgba(255, 255, 255, 0.04)', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 10 },
  navigationTabButton: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  tabButtonLabel: { fontSize: 9, fontWeight: 'bold', color: '#64748B', marginTop: 4 },
  tabButtonLabelActive: { color: '#A5B4FC' },
  tabCenterFloatingMicButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#2563EB', justifyContent: 'center', alignItems: 'center', marginTop: -30, shadowColor: '#2563EB', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 4, borderWidth: 3, borderColor: '#0F0F12' },

  stepProgressRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, width: '80%', justifyContent: 'center' },
  stepCircle: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: '#475569', justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E293B' },
  stepCircleActive: { borderColor: '#2DD4BF', shadowColor: '#2DD4BF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 10, elevation: 4, backgroundColor: 'rgba(45, 212, 191, 0.1)' },
  stepLine: { flex: 1, height: 2, backgroundColor: '#334155', marginHorizontal: 8 },
  stepLineActive: { backgroundColor: '#2DD4BF' },
  registerFormContainer: { width: '100%', paddingHorizontal: 4, marginTop: 12 },
  registerFormLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.8, textTransform: 'uppercase' },
  registerInputWrapper: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.1)', paddingVertical: 8, marginTop: 4 },
  registerInputIcon: { marginRight: 12 },
  registerTextInput: { flex: 1, color: '#FFF', fontSize: 14, fontWeight: '500', paddingVertical: 4 },
  checkboxRowContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 24, paddingRight: 10 },
  customCheckboxCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#475569', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  customCheckboxCircleActive: { borderColor: '#2DD4BF' },
  checkboxInnerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2DD4BF' },
  checkboxLabelText: { fontSize: 12, color: '#94A3B8', lineHeight: 18, flex: 1 },
  checkboxLinkText: { color: '#A5B4FC', fontWeight: 'bold' },
  loginRedirectFooter: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  loginRedirectText: { fontSize: 13, color: '#94A3B8' },
  loginRedirectLink: { fontSize: 13, color: '#2DD4BF', fontWeight: 'bold' },
});