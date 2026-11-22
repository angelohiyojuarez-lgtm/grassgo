// Configuración y conexión de Firebase para GRASSGO
const firebaseConfig = {
  apiKey: "AIzaSyDF-WDpEfuv1LgLa3Leqr5zNV4bWYgmnyQ",
  authDomain: "grassgoo.firebaseapp.com",
  projectId: "grassgoo",
  storageBucket: "grassgoo.firebasestorage.app",
  messagingSenderId: "89014521711",
  appId: "1:89014521711:web:0b173e3810775faeada29a",
  measurementId: "G-BDMMB0ZPW9"
};

// Inicializar Firebase
let auth = null;
let db = null;

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    auth = firebase.auth();
    db = firebase.firestore();
  }
} catch (e) {
  console.warn("Aviso inicializando Firebase:", e);
}

// Utilidad de Timeout para evitar que cualquier llamada de red o Firestore se quede colgada
function withTimeout(promise, ms = 2500, fallbackVal = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackVal), ms))
  ]);
}

// Base de Datos Local (Garantiza persistencia y respuesta inmediata)
const LOCAL_DB_KEY = 'grassgo_users_db';
const ACTIVE_USER_KEY = 'grassgo_active_user';

function getLocalUsers() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_DB_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveLocalUser(userData) {
  try {
    const users = getLocalUsers();
    const existingIdx = users.findIndex(u => u.email.toLowerCase() === userData.email.toLowerCase());
    if (existingIdx >= 0) {
      users[existingIdx] = { ...users[existingIdx], ...userData };
    } else {
      users.push(userData);
    }
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(users));
  } catch (e) {}
}

function setActiveUser(userData) {
  try {
    sessionStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(userData));
    localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(userData));
  } catch (e) {}
}

function getActiveUser() {
  try {
    const session = sessionStorage.getItem(ACTIVE_USER_KEY) || localStorage.getItem(ACTIVE_USER_KEY);
    return session ? JSON.parse(session) : null;
  } catch (e) {
    return null;
  }
}

function clearActiveUser() {
  try {
    sessionStorage.removeItem(ACTIVE_USER_KEY);
    localStorage.removeItem(ACTIVE_USER_KEY);
  } catch (e) {}
}

// 1. REGISTRO DE USUARIO EN LA BASE DE DATOS
async function registerUser({ nombre, email, password, telefono }) {
  const cleanEmail = email.trim().toLowerCase();
  const trimmedName = nombre.trim();
  const primerNombre = trimmedName.split(' ')[0];

  let firebaseUid = null;
  let firebaseSuccess = false;

  // 1. Intentar registrar en Firebase Auth (Cloud Database de usuarios)
  if (auth) {
    try {
      const cred = await withTimeout(
        auth.createUserWithEmailAndPassword(cleanEmail, password),
        3500,
        null
      );

      if (cred && cred.user) {
        const user = cred.user;
        firebaseUid = user.uid;

        // Guardar nombre directamente en el perfil de Firebase Auth
        try {
          await withTimeout(
            user.updateProfile({ displayName: trimmedName }),
            2000,
            null
          );
          console.log("Nombre guardado en Firebase Auth:", trimmedName);
        } catch (profileErr) {
          console.warn("Aviso updateProfile:", profileErr);
        }

        // Intentar guardar en Firestore con timeout de seguridad (no bloqueante)
        if (db) {
          try {
            await withTimeout(
              db.collection('users').doc(firebaseUid).set({
                uid: firebaseUid,
                nombre: primerNombre,
                nombreCompleto: trimmedName,
                email: cleanEmail,
                telefono: telefono ? telefono.trim() : '',
                fechaRegistro: new Date().toISOString()
              }),
              1200,
              null
            );
          } catch (dbErr) {
            console.warn("Firestore aviso (no bloqueante):", dbErr);
          }
        }

        firebaseSuccess = true;
      } else {
        console.warn("Firebase Auth excedió tiempo o no respondió, usando persistencia local");
        firebaseUid = 'usr_' + Date.now();
      }
    } catch (fbErr) {
      console.warn("Error en Firebase Auth:", fbErr);
      if (fbErr.code === 'auth/email-already-in-use') {
        throw new Error('Este correo ya está registrado en la base de datos.');
      } else if (fbErr.code === 'auth/weak-password') {
        throw new Error('La contraseña es muy débil (mínimo 6 caracteres).');
      } else if (fbErr.code === 'auth/invalid-email') {
        throw new Error('El correo electrónico es inválido.');
      }
      firebaseUid = 'usr_' + Date.now();
    }
  } else {
    firebaseUid = 'usr_' + Date.now();
  }

  // 2. Guardar en Base de Datos Local
  const userRecord = {
    uid: firebaseUid || ('usr_' + Date.now()),
    nombre: primerNombre,
    nombreCompleto: trimmedName,
    email: cleanEmail,
    password: password,
    telefono: telefono ? telefono.trim() : '',
    fechaRegistro: new Date().toISOString()
  };
  saveLocalUser(userRecord);

  // 3. Establecer sesión activa
  setActiveUser(userRecord);

  return { success: true, user: userRecord, firebase: firebaseSuccess };
}

// 2. INICIO DE SESIÓN
async function loginUser(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  let userRecord = null;

  // 1. Intentar con Firebase Auth
  if (auth) {
    try {
      const cred = await withTimeout(
        auth.signInWithEmailAndPassword(cleanEmail, password),
        3500,
        null
      );

      if (cred && cred.user) {
        const user = cred.user;
        const displayName = user.displayName || '';
        const namePart = displayName ? displayName.split(' ')[0] : cleanEmail.split('@')[0];
        const capitalName = namePart.charAt(0).toUpperCase() + namePart.slice(1);

        userRecord = {
          uid: user.uid,
          nombre: capitalName,
          nombreCompleto: displayName || capitalName,
          email: cleanEmail
        };

        // Intentar leer de Firestore con timeout
        if (db) {
          try {
            const docSnap = await withTimeout(
              db.collection('users').doc(user.uid).get(),
              1200,
              null
            );
            if (docSnap && docSnap.exists) {
              const data = docSnap.data();
              if (data) {
                userRecord = { ...userRecord, ...data };
              }
            }
          } catch (e) {}
        }
      }
    } catch (fbErr) {
      console.warn("Firebase Auth error:", fbErr);
      if (fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/invalid-credential' || fbErr.code === 'auth/user-not-found') {
        // Verificar también en BD local por si se registró offline
        const localUsers = getLocalUsers();
        const found = localUsers.find(u => u.email === cleanEmail && u.password === password);
        if (found) {
          userRecord = found;
        } else {
          throw new Error('Correo o contraseña incorrectos.');
        }
      }
    }
  }

  // 2. Si no se autenticó por Firebase, verificar en la BD Local
  if (!userRecord) {
    const localUsers = getLocalUsers();
    const found = localUsers.find(u => u.email === cleanEmail && u.password === password);
    if (found) {
      userRecord = found;
    } else {
      // Buscar si el correo existe pero la clave es incorrecta
      const userExists = localUsers.find(u => u.email === cleanEmail);
      if (userExists) {
        throw new Error('Contraseña incorrecta.');
      } else {
        // Si no existe, crear sesión rápida con su correo
        const primerNombre = cleanEmail.split('@')[0];
        const capital = primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1);
        userRecord = {
          uid: 'usr_' + Date.now(),
          nombre: capital,
          nombreCompleto: capital,
          email: cleanEmail,
          password: password,
          fechaRegistro: new Date().toISOString()
        };
        saveLocalUser(userRecord);
      }
    }
  }

  setActiveUser(userRecord);
  return userRecord;
}

// 3. JALAR NOMBRE DESDE LA BASE DE DATOS
async function fetchCurrentUserName() {
  // 1. Revisar sesión activa (datos en memoria y local DB)
  const active = getActiveUser();
  if (active) {
    if (active.nombre) return active.nombre;
    if (active.nombreCompleto) return active.nombreCompleto.split(' ')[0];
  }

  // 2. Si Firebase Auth tiene un usuario activo
  if (auth && auth.currentUser) {
    const user = auth.currentUser;
    if (user.displayName) {
      return user.displayName.split(' ')[0];
    }
    if (db) {
      try {
        const doc = await withTimeout(
          db.collection('users').doc(user.uid).get(),
          1200,
          null
        );
        if (doc && doc.exists) {
          const data = doc.data();
          if (data && data.nombre) return data.nombre;
          if (data && data.nombreCompleto) return data.nombreCompleto.split(' ')[0];
        }
      } catch (e) {}
    }
  }

  return "Carlos";
}

// 4. OBTENER PERFIL COMPLETO DESDE LA BASE DE DATOS
async function getUserProfile() {
  const active = getActiveUser();
  let profile = {
    nombre: 'Carlos',
    nombreCompleto: 'Carlos Mendoza',
    email: 'carlos.mendoza@email.com',
    telefono: '987 654 321',
    avatarUrl: '',
    partidos: 0,
    reservasActivas: 0,
    canchaFavorita: 'Ninguna'
  };

  if (active) {
    profile = { ...profile, ...active };
  }

  if (auth && auth.currentUser) {
    const user = auth.currentUser;
    profile.email = user.email || profile.email;
    if (user.displayName) {
      profile.nombreCompleto = user.displayName;
      profile.nombre = user.displayName.split(' ')[0];
    }
    if (db) {
      try {
        const doc = await withTimeout(db.collection('users').doc(user.uid).get(), 1200, null);
        if (doc && doc.exists) {
          profile = { ...profile, ...doc.data() };
        }
      } catch (e) {}
    }
  }

  // Calcular reservas reales
  const reservas = getUserReservations(profile.email || profile.uid);
  profile.reservasActivas = reservas.length;
  profile.partidos = profile.partidos || reservas.length;

  return profile;
}

// 5. ACTUALIZAR PERFIL EN LA BASE DE DATOS
async function updateUserProfile({ nombreCompleto, telefono, email, avatarUrl }) {
  const active = getActiveUser() || {};
  const trimmedName = (nombreCompleto || active.nombreCompleto || '').trim();
  const primerNombre = trimmedName ? trimmedName.split(' ')[0] : 'Carlos';

  const updatedData = {
    ...active,
    nombreCompleto: trimmedName,
    nombre: primerNombre,
    telefono: (telefono || '').trim(),
    email: (email || active.email || '').trim().toLowerCase()
  };

  if (avatarUrl) {
    updatedData.avatarUrl = avatarUrl;
  }

  // 1. Actualizar en Firebase Auth si está autenticado
  if (auth && auth.currentUser) {
    try {
      await withTimeout(
        auth.currentUser.updateProfile({ displayName: trimmedName }),
        2000,
        null
      );
    } catch (e) {
      console.warn("Aviso actualizando Firebase Auth profile:", e);
    }

    // 2. Intentar actualizar en Firestore
    if (db) {
      try {
        await withTimeout(
          db.collection('users').doc(auth.currentUser.uid).set(updatedData, { merge: true }),
          1200,
          null
        );
      } catch (e) {}
    }
  }

  // 3. Guardar en Base de Datos Local
  saveLocalUser(updatedData);
  setActiveUser(updatedData);

  return updatedData;
}

// 6. GESTIÓN DE RESERVAS DEL USUARIO
function getUserReservations(userKey) {
  if (!userKey) {
    const active = getActiveUser();
    userKey = active ? (active.email || active.uid) : 'default';
  }
  try {
    const key = 'grassgo_reservas_' + userKey.toLowerCase();
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    return [];
  }
}

function addReservation(reservationData) {
  const active = getActiveUser();
  const userKey = active ? (active.email || active.uid) : 'default';
  const reservas = getUserReservations(userKey);
  const newRes = {
    id: 'res_' + Date.now(),
    fecha: new Date().toLocaleDateString(),
    estado: 'activa',
    ...reservationData
  };
  reservas.push(newRes);
  localStorage.setItem('grassgo_reservas_' + userKey.toLowerCase(), JSON.stringify(reservas));
  return newRes;
}

// 7. CERRAR SESIÓN
async function logoutUser() {
  if (auth) {
    try {
      await auth.signOut();
    } catch (e) {}
  }
  clearActiveUser();
}

window.Grassgo = {
  auth,
  db,
  registerUser,
  loginUser,
  fetchCurrentUserName,
  getUserProfile,
  updateUserProfile,
  getUserReservations,
  addReservation,
  getActiveUser,
  logoutUser
};
