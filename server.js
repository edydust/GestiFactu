const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const app = express();
const PORT = process.env.PORT || 8090;

// Multi-tenant Storage Paths
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'database.json');
const SEED_FILE = path.join(__dirname, 'seed_data.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });

// AsyncLocalStorage for Request Scoped User Context
const asyncLocalStorage = new AsyncLocalStorage();

// Security: Password Hashing with PBKDF2
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const check = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return check === hash;
}

// User Accounts Management
function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    const initialAccounts = [];
    let initialAdminDb = null;

    if (fs.existsSync(LEGACY_DB_FILE)) {
      try {
        initialAdminDb = JSON.parse(fs.readFileSync(LEGACY_DB_FILE, 'utf8'));
      } catch (e) {
        console.error('Error reading legacy db:', e);
      }
    }

    const { hash, salt } = hashPassword('admin');
    const adminUser = {
      id: 'usr_admin',
      email: (initialAdminDb?.auth?.username || 'admin@gestifactu.com').toLowerCase(),
      name: initialAdminDb?.company?.legalName || 'Administrador',
      passwordHash: hash,
      salt: salt,
      createdAt: new Date().toISOString()
    };
    initialAccounts.push(adminUser);
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(initialAccounts, null, 2), 'utf8');

    // Create user db file for admin from legacy data if available
    const adminDbFile = path.join(USERS_DIR, `${adminUser.id}.json`);
    if (initialAdminDb && !fs.existsSync(adminDbFile)) {
      fs.writeFileSync(adminDbFile, JSON.stringify(initialAdminDb, null, 2), 'utf8');
    }
    return initialAccounts;
  }

  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error al leer accounts.json:', err);
    return [];
  }
}

function saveAccounts(accounts) {
  const tmp = ACCOUNTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2), 'utf8');
  fs.renameSync(tmp, ACCOUNTS_FILE);
}

// Sessions Store (persisted across server restarts)
function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return new Map();
  try {
    const arr = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return new Map(arr.map(s => [s.token, s]));
  } catch {
    return new Map();
  }
}

let activeSessions = loadSessions();

function saveSessions() {
  try {
    const arr = Array.from(activeSessions.values());
    const tmp = SESSIONS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
    fs.renameSync(tmp, SESSIONS_FILE);
  } catch (e) {
    console.error('Error saving sessions:', e);
  }
}

function getUserFilePath(userId) {
  const safeId = (userId || 'usr_admin').replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(USERS_DIR, `${safeId}.json`);
}

function createEmptyUserDb(userInfo = {}) {
  return {
    company: {
      legalName: userInfo.name || userInfo.legalName || "Mi Negocio",
      tin: userInfo.tin || "",
      address: userInfo.address || "",
      postcode: userInfo.postcode || "",
      city: userInfo.city || "",
      phone: userInfo.phone || "",
      email: userInfo.email || "",
      iban: userInfo.iban || ""
    },
    invoices: [],
    budgets: [],
    deliveryNotes: [],
    purchases: [],
    contacts: [],
    products: [],
    deals: [],
    timeTracking: [],
    settings: {
      theme: 'light',
      language: 'es',
      defaultPaymentMethod: 'Transferencia bancaria',
      defaultIban: '',
      autoEmailSender: userInfo.email || ''
    }
  };
}

// Helper: Convert Budget to Invoice
function convertBudgetToInvoiceHelper(db, budget) {
  db.invoices = db.invoices || [];
  const existingInv = db.invoices.find(i => 
    (budget.id && i.originBudgetId === budget.id) || 
    (budget.invoiceNumber && i.number === budget.invoiceNumber) ||
    (budget.number && i.originBudgetNumber === budget.number)
  );
  if (existingInv) {
    budget.status = 'facturado';
    budget.invoiceNumber = existingInv.number;
    budget.invoiceId = existingInv.id;
    return existingInv;
  }

  const currentYear = new Date().getFullYear().toString();
  const yearSuffix = currentYear.slice(-2);
  const prefix = `1-${yearSuffix}-`;
  let maxSeq = 0;
  (db.invoices || []).forEach(inv => {
    if (inv.number && inv.number.startsWith(prefix)) {
      const part = inv.number.replace(prefix, '');
      const num = parseInt(part, 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  });
  const nextSeq = maxSeq + 1;
  const nextNumber = `${prefix}${nextSeq.toString().padStart(6, '0')}`;

  const issueDate = new Date().toISOString().slice(0, 10);
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const dueDate = d.toISOString().slice(0, 10);

  const newInvoice = {
    id: 'inv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    number: nextNumber,
    originBudgetId: budget.id || null,
    originBudgetNumber: budget.number || null,
    client: budget.client || {},
    date: issueDate,
    dueDate: dueDate,
    status: 'emitida',
    items: JSON.parse(JSON.stringify(budget.items || [])),
    baseAmount: budget.baseAmount || 0,
    ivaAmount: budget.ivaAmount || 0,
    irpfAmount: budget.irpfAmount || 0,
    totalAmount: budget.totalAmount || 0,
    irpfPercent: budget.irpfPercent !== undefined ? budget.irpfPercent : 15,
    paymentMethod: budget.paymentMethod || 'Transferencia bancaria',
    notes: budget.notes ? `${budget.notes} (Procedente de Presupuesto ${budget.number || ''})` : `Factura correspondiente al Presupuesto ${budget.number || ''}`,
    createdAt: new Date().toISOString()
  };

  budget.status = 'facturado';
  budget.invoiceNumber = nextNumber;
  budget.invoiceId = newInvoice.id;

  db.invoices.unshift(newInvoice);
  return newInvoice;
}

// Scoped Multi-Tenant Database Loader
function loadDb(explicitUserId) {
  const userId = explicitUserId || asyncLocalStorage.getStore()?.userId || 'usr_admin';
  const filePath = getUserFilePath(userId);

  if (!fs.existsSync(filePath)) {
    if (userId === 'usr_admin' && fs.existsSync(LEGACY_DB_FILE)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_FILE, 'utf8'));
        saveDb(legacy, userId);
        return legacy;
      } catch (err) {
        console.error('Error al migrar base de datos legacy:', err);
      }
    }
    const empty = createEmptyUserDb();
    saveDb(empty, userId);
    return empty;
  }

  try {
    const db = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let dbChanged = false;
    (db.budgets || []).forEach(b => {
      if (b.status === 'facturado') {
        const hasInv = (db.invoices || []).some(i => 
          (b.id && i.originBudgetId === b.id) || 
          (b.invoiceNumber && i.number === b.invoiceNumber) ||
          (b.number && i.originBudgetNumber === b.number)
        );
        if (!hasInv) {
          convertBudgetToInvoiceHelper(db, b);
          dbChanged = true;
        }
      }
    });
    if (dbChanged) {
      saveDb(db, userId);
    }
    return db;
  } catch (err) {
    console.error(`Error al leer base de datos del usuario ${userId}:`, err);
    return createEmptyUserDb();
  }
}

// Scoped Multi-Tenant Database Saver
function saveDb(db, explicitUserId) {
  const userId = explicitUserId || asyncLocalStorage.getStore()?.userId || 'usr_admin';
  const filePath = getUserFilePath(userId);
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpFile, filePath);
}

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'allow',
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Digital Asset Links for Android TWA (Trusted Web Activity)
app.get('/.well-known/assetlinks.json', (req, res) => {
  const assetlinksPath = path.join(__dirname, 'public', '.well-known', 'assetlinks.json');
  if (fs.existsSync(assetlinksPath)) {
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(assetlinksPath);
  } else {
    res.status(404).send('Assetlinks not found');
  }
});

// System Status (Public)
app.get('/api/status', (req, res) => {
  res.json({ ok: true, version: '2.0.0-multiuser', time: new Date().toISOString() });
});

// Registration (Public - Creates isolated user account)
app.post('/api/auth/register', (req, res) => {
  const { email, password, name, legalName, tin } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña requeridos" });
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes('@') || password.length < 5) {
    return res.status(400).json({ error: "El email debe ser válido y la contraseña tener al menos 5 caracteres" });
  }

  const accounts = loadAccounts();
  const exists = accounts.find(a => a.email.toLowerCase() === cleanEmail);
  if (exists) {
    return res.status(409).json({ error: "Ya existe una cuenta registrada con este correo electrónico" });
  }

  const { hash, salt } = hashPassword(password);
  const userId = 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  const displayName = (name || legalName || cleanEmail.split('@')[0]).trim();

  const newAccount = {
    id: userId,
    email: cleanEmail,
    name: displayName,
    passwordHash: hash,
    salt: salt,
    createdAt: new Date().toISOString()
  };

  accounts.push(newAccount);
  saveAccounts(accounts);

  // Initialize brand new clean database for this user
  const initialDb = createEmptyUserDb({
    name: displayName,
    email: cleanEmail,
    legalName: legalName || displayName,
    tin: tin || ""
  });
  saveDb(initialDb, userId);

  // Generate session token
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    userId,
    email: cleanEmail,
    name: displayName,
    createdAt: new Date().toISOString()
  };
  activeSessions.set(token, session);
  saveSessions();

  res.status(201).json({
    ok: true,
    token,
    user: {
      id: userId,
      email: cleanEmail,
      name: displayName
    }
  });
});

// Login (Public)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Introduce tu usuario o email y la contraseña" });
  }

  const cleanUser = username.trim().toLowerCase();
  const accounts = loadAccounts();

  const account = accounts.find(a => 
    a.email.toLowerCase() === cleanUser || 
    (a.username && a.username.toLowerCase() === cleanUser)
  );

  let isValid = false;
  if (account) {
    if (account.passwordHash && account.salt) {
      isValid = verifyPassword(password, account.passwordHash, account.salt);
    } else if (account.password && account.password === password) {
      isValid = true;
    }
  }

  if (isValid && account) {
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      token,
      userId: account.id,
      email: account.email,
      name: account.name || account.email,
      createdAt: new Date().toISOString()
    };
    activeSessions.set(token, session);
    saveSessions();

    return res.json({
      ok: true,
      token,
      user: {
        id: account.id,
        email: account.email,
        name: account.name || account.email
      }
    });
  }

  res.status(401).json({ error: "Usuario o contraseña incorrectos" });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    activeSessions.delete(token);
    saveSessions();
  }
  res.json({ ok: true });
});

// Verify Active Session
app.get('/api/auth/check', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const session = activeSessions.get(token);
    if (session) {
      const userDb = loadDb(session.userId);
      return res.json({
        ok: true,
        user: {
          id: session.userId,
          email: session.email,
          name: userDb.company?.legalName || session.name || session.email
        }
      });
    }
  }
  res.status(401).json({ error: "No autenticado" });
});

// Protected Multi-Tenant Middleware
app.use('/api', (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso no autorizado. Inicie sesión.' });
  }
  const token = authHeader.slice(7);
  const session = activeSessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'Sesión caducada o inválida' });
  }

  req.userId = session.userId;
  req.user = session;

  asyncLocalStorage.run({ userId: session.userId }, () => {
    next();
  });
});

// 1. Dashboard
app.get('/api/dashboard', (req, res) => {
  const db = loadDb();
  const currentYear = new Date().getFullYear().toString();
  const currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
  const yearPrefix = currentYear.slice(-2);

  const invoices = db.invoices || [];
  const purchases = db.purchases || [];

  const yearInvoices = invoices.filter(i => (i.date && i.date.startsWith(currentYear)) || (i.number && i.number.includes(`-${yearPrefix}-`)));
  const totalSalesYear = yearInvoices.reduce((acc, i) => acc + (Number(i.baseAmount) || 0), 0);
  const totalSalesPending = invoices.filter(i => i.status !== 'cobrada').reduce((acc, i) => acc + (Number(i.totalAmount) || 0), 0);
  
  const monthInvoices = invoices.filter(i => i.date && i.date.startsWith(`${currentYear}-${currentMonth}`));
  const totalSalesMonth = monthInvoices.reduce((acc, i) => acc + (Number(i.baseAmount) || 0), 0);

  const totalPurchasesMonth = purchases.filter(p => p.date && p.date.startsWith(`${currentYear}-${currentMonth}`))
                                       .reduce((acc, p) => acc + (Number(p.baseAmount) || 0), 0);

  res.json({
    company: db.company,
    stats: {
      totalSalesYear,
      totalSalesMonth,
      totalSalesPending,
      totalPurchasesMonth,
      invoicesCount: invoices.length,
      contactsCount: (db.contacts || []).length,
      productsCount: (db.products || []).length
    },
    recentInvoices: invoices.slice(0, 5),
    recentPurchases: purchases.slice(0, 5)
  });
});

// 2. Invoices (Facturas de Venta)
app.get('/api/invoices', (req, res) => {
  const db = loadDb();
  res.json(db.invoices || []);
});

app.get('/api/invoices/next-number', (req, res) => {
  const db = loadDb();
  const series = req.query.series || '1';
  const currentYear2Digits = new Date().getFullYear().toString().slice(-2);
  
  const prefix = `${series}-${currentYear2Digits}-`;
  let maxSeq = 0;
  (db.invoices || []).forEach(inv => {
    if (inv.number && inv.number.startsWith(prefix)) {
      const parts = inv.number.split('-');
      if (parts.length === 3) {
        const num = parseInt(parts[2], 10);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    }
  });

  const nextSeq = maxSeq + 1;
  const nextNumber = `${series}-${currentYear2Digits}-${nextSeq.toString().padStart(6, '0')}`;
  res.json({ nextNumber, nextSeq, series, year: currentYear2Digits });
});

app.post('/api/invoices', (req, res) => {
  const db = loadDb();
  db.invoices = db.invoices || [];

  const newInv = {
    id: Date.now(),
    number: req.body.number,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    dueDate: req.body.dueDate || "",
    issuedAt: new Date().toISOString(),
    customer: req.body.customer || {},
    baseAmount: Number(req.body.baseAmount) || 0,
    taxPercentage: Number(req.body.taxPercentage) || 21,
    taxAmount: Number(req.body.taxAmount) || 0,
    incomeTaxPercentage: Number(req.body.incomeTaxPercentage) || 0,
    incomeTaxAmount: Number(req.body.incomeTaxAmount) || 0,
    totalAmount: Number(req.body.totalAmount) || 0,
    paymentMethod: req.body.paymentMethod || "Transferencia bancaria",
    iban: req.body.iban || db.company?.iban || "",
    status: req.body.status || "pendiente",
    lines: req.body.lines || []
  };

  db.invoices.unshift(newInv);
  saveDb(db);
  res.json({ ok: true, invoice: newInv });
});

app.put('/api/invoices/:id', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  const idx = (db.invoices || []).findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: "Factura no encontrada" });

  db.invoices[idx] = { ...db.invoices[idx], ...req.body, id };
  saveDb(db);
  res.json({ ok: true, invoice: db.invoices[idx] });
});

app.delete('/api/invoices/:id', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  db.invoices = (db.invoices || []).filter(i => i.id !== id);
  saveDb(db);
  res.json({ ok: true });
});

// 3. Budgets (Presupuestos)
app.get('/api/budgets', (req, res) => {
  const db = loadDb();
  res.json(db.budgets || []);
});

app.get('/api/budgets/next-number', (req, res) => {
  const db = loadDb();
  const year2 = new Date().getFullYear().toString().slice(-2);
  const prefix = `PRE-${year2}-`;
  let maxSeq = 0;
  (db.budgets || []).forEach(b => {
    if (b.number && b.number.startsWith(prefix)) {
      const parts = b.number.split('-');
      if (parts.length === 3) {
        const num = parseInt(parts[2], 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    }
  });
  const nextSeq = maxSeq + 1;
  const nextNumber = `PRE-${year2}-${nextSeq.toString().padStart(4, '0')}`;
  res.json({ nextNumber, nextSeq });
});

function convertBudgetToInvoiceHelper(db, budget) {
  db.invoices = db.invoices || [];
  const existingInv = db.invoices.find(i => 
    (budget.id && i.originBudgetId === budget.id) || 
    (budget.invoiceNumber && i.number === budget.invoiceNumber) ||
    (budget.number && i.originBudgetNumber === budget.number)
  );
  if (existingInv) {
    budget.status = "facturado";
    budget.invoiceNumber = existingInv.number;
    budget.invoiceId = existingInv.id;
    return existingInv;
  }

  // Generar número de factura correlativo
  const currentYear2Digits = new Date().getFullYear().toString().slice(-2);
  const prefix = `1-${currentYear2Digits}-`;
  let maxSeq = 0;
  (db.invoices || []).forEach(inv => {
    if (inv.number && inv.number.startsWith(prefix)) {
      const parts = inv.number.split('-');
      if (parts.length === 3) {
        const num = parseInt(parts[2], 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    }
  });
  const nextSeq = maxSeq + 1;
  const invNumber = `1-${currentYear2Digits}-${nextSeq.toString().padStart(6, '0')}`;

  const today = new Date().toISOString().slice(0, 10);
  const dueDateObj = new Date();
  dueDateObj.setDate(dueDateObj.getDate() + 30);
  const dueDate = dueDateObj.toISOString().slice(0, 10);

  const baseAmt = Number(budget.baseAmount) || 0;
  const taxPct = budget.taxPercentage !== undefined ? Number(budget.taxPercentage) : 21;
  const taxAmt = Number(budget.taxAmount) || (baseAmt * (taxPct / 100));
  const totalAmt = Number(budget.totalAmount) || (baseAmt + taxAmt);

  const newInvoice = {
    id: Date.now(),
    number: invNumber,
    date: today,
    dueDate: dueDate,
    issuedAt: new Date().toISOString(),
    customer: budget.customer || {},
    baseAmount: baseAmt,
    taxPercentage: taxPct,
    taxAmount: taxAmt,
    incomeTaxPercentage: Number(budget.incomeTaxPercentage) || 0,
    incomeTaxAmount: Number(budget.incomeTaxAmount) || 0,
    totalAmount: totalAmt,
    paymentMethod: budget.paymentMethod || "Transferencia bancaria",
    iban: db.company?.iban || "",
    status: "pendiente",
    originBudgetId: budget.id,
    originBudgetNumber: budget.number,
    lines: (budget.lines && budget.lines.length > 0) ? budget.lines : [
      {
        concept: budget.concept || ("Servicios según presupuesto " + (budget.number || '')),
        quantity: 1,
        price: baseAmt,
        amount: baseAmt,
        taxPercentage: taxPct
      }
    ]
  };

  db.invoices.unshift(newInvoice);
  budget.status = "facturado";
  budget.invoiceNumber = invNumber;
  budget.invoiceId = newInvoice.id;

  return newInvoice;
}

app.post('/api/budgets', (req, res) => {
  const db = loadDb();
  db.budgets = db.budgets || [];
  const newBudget = {
    id: Date.now(),
    number: req.body.number,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    validUntil: req.body.validUntil || "",
    customer: req.body.customer || {},
    baseAmount: Number(req.body.baseAmount) || 0,
    taxPercentage: Number(req.body.taxPercentage) || 21,
    taxAmount: Number(req.body.taxAmount) || 0,
    incomeTaxPercentage: Number(req.body.incomeTaxPercentage) || 0,
    incomeTaxAmount: Number(req.body.incomeTaxAmount) || 0,
    totalAmount: Number(req.body.totalAmount) || 0,
    paymentMethod: req.body.paymentMethod || "Transferencia bancaria",
    notes: req.body.notes || "Presupuesto válido durante 30 días.",
    status: req.body.status || "pendiente", // pendiente, aceptado, rechazado, facturado
    lines: req.body.lines || [],
    createdAt: new Date().toISOString()
  };

  if (newBudget.status === 'facturado') {
    convertBudgetToInvoiceHelper(db, newBudget);
  }

  db.budgets.unshift(newBudget);
  saveDb(db);
  res.json({ ok: true, budget: newBudget });
});

app.put('/api/budgets/:id', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  const idx = (db.budgets || []).findIndex(b => b.id === id);
  if (idx === -1) return res.status(404).json({ error: "Presupuesto no encontrado" });

  db.budgets[idx] = { ...db.budgets[idx], ...req.body, id };

  if (db.budgets[idx].status === 'facturado') {
    convertBudgetToInvoiceHelper(db, db.budgets[idx]);
  }

  saveDb(db);
  res.json({ ok: true, budget: db.budgets[idx] });
});

app.post('/api/budgets/:id/convert-to-invoice', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  const budget = (db.budgets || []).find(b => b.id === id);
  if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado" });

  const newInvoice = convertBudgetToInvoiceHelper(db, budget);
  saveDb(db);
  res.json({ ok: true, invoice: newInvoice, budget });
});

app.delete('/api/budgets/:id', (req, res) => {
  const db = loadDb();
  db.budgets = (db.budgets || []).filter(b => b.id !== Number(req.params.id));
  saveDb(db);
  res.json({ ok: true });
});

// 4. Delivery Notes (Albaranes)
app.get('/api/delivery-notes', (req, res) => {
  const db = loadDb();
  res.json(db.deliveryNotes || []);
});

app.post('/api/delivery-notes', (req, res) => {
  const db = loadDb();
  db.deliveryNotes = db.deliveryNotes || [];
  const newNote = { id: Date.now(), ...req.body, createdAt: new Date().toISOString() };
  db.deliveryNotes.unshift(newNote);
  saveDb(db);
  res.json({ ok: true, deliveryNote: newNote });
});

// 5. Purchases (Compras y Gastos)
app.get('/api/purchases', (req, res) => {
  const db = loadDb();
  res.json(db.purchases || []);
});

app.post('/api/purchases', (req, res) => {
  const db = loadDb();
  db.purchases = db.purchases || [];
  const newPurchase = {
    id: Date.now(),
    date: req.body.date || new Date().toISOString().slice(0, 10),
    supplier: req.body.supplier || "",
    cif: req.body.cif || "",
    concept: req.body.concept || "Gasto general",
    category: req.body.category || "General",
    baseAmount: Number(req.body.baseAmount) || 0,
    taxPercentage: Number(req.body.taxPercentage) || 21,
    taxAmount: Number(req.body.taxAmount) || 0,
    totalAmount: Number(req.body.totalAmount) || 0,
    paymentMethod: req.body.paymentMethod || "Tarjeta",
    status: req.body.status || "pagado",
    attachment: req.body.attachment || null
  };
  db.purchases.unshift(newPurchase);
  saveDb(db);
  res.json({ ok: true, purchase: newPurchase });
});

app.put('/api/purchases/:id', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  const idx = (db.purchases || []).findIndex(p => p.id === id);
  if (idx !== -1) {
    db.purchases[idx] = {
      ...db.purchases[idx],
      date: req.body.date || db.purchases[idx].date,
      supplier: req.body.supplier || db.purchases[idx].supplier,
      cif: req.body.cif !== undefined ? req.body.cif : db.purchases[idx].cif,
      concept: req.body.concept || db.purchases[idx].concept,
      category: req.body.category || db.purchases[idx].category,
      baseAmount: Number(req.body.baseAmount) || 0,
      taxPercentage: Number(req.body.taxPercentage) !== undefined ? Number(req.body.taxPercentage) : 21,
      taxAmount: Number(req.body.taxAmount) || 0,
      totalAmount: Number(req.body.totalAmount) || 0,
      paymentMethod: req.body.paymentMethod || db.purchases[idx].paymentMethod || "Tarjeta",
      status: req.body.status || db.purchases[idx].status || "pagado",
      attachment: req.body.attachment !== undefined ? req.body.attachment : db.purchases[idx].attachment
    };
    saveDb(db);
    return res.json({ ok: true, purchase: db.purchases[idx] });
  }
  res.status(404).json({ error: "Gasto no encontrado" });
});

app.delete('/api/purchases/:id', (req, res) => {
  const db = loadDb();
  db.purchases = (db.purchases || []).filter(p => p.id !== Number(req.params.id));
  saveDb(db);
  res.json({ ok: true });
});

// 6. Contacts (Clientes y Proveedores)
app.get('/api/contacts', (req, res) => {
  const db = loadDb();
  res.json(db.contacts || []);
});

app.post('/api/contacts', (req, res) => {
  const db = loadDb();
  db.contacts = db.contacts || [];
  const newContact = { id: Date.now(), ...req.body };
  db.contacts.push(newContact);
  saveDb(db);
  res.json({ ok: true, contact: newContact });
});

app.put('/api/contacts/:id', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  const idx = (db.contacts || []).findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: "Contacto no encontrado" });
  db.contacts[idx] = { ...db.contacts[idx], ...req.body, id };
  saveDb(db);
  res.json({ ok: true, contact: db.contacts[idx] });
});

app.delete('/api/contacts/:id', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  db.contacts = (db.contacts || []).filter(c => c.id !== id);
  saveDb(db);
  res.json({ ok: true });
});

// 7. Products & Services (Catálogo)
app.get('/api/products', (req, res) => {
  const db = loadDb();
  res.json(db.products || []);
});

app.post('/api/products', (req, res) => {
  const db = loadDb();
  db.products = db.products || [];
  const newProd = { id: Date.now(), ...req.body };
  db.products.push(newProd);
  saveDb(db);
  res.json({ ok: true, product: newProd });
});

app.put('/api/products/:id', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  const idx = (db.products || []).findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Servicio o producto no encontrado" });
  db.products[idx] = { ...db.products[idx], ...req.body, id };
  saveDb(db);
  res.json({ ok: true, product: db.products[idx] });
});

app.delete('/api/products/:id', (req, res) => {
  const db = loadDb();
  const id = Number(req.params.id);
  db.products = (db.products || []).filter(p => p.id !== id);
  saveDb(db);
  res.json({ ok: true });
});

// 8. Time Tracking (Control Horario / Fichaje)
app.get('/api/timetracking', (req, res) => {
  const db = loadDb();
  res.json(db.timeTracking || []);
});

app.post('/api/timetracking', (req, res) => {
  const db = loadDb();
  db.timeTracking = db.timeTracking || [];
  const record = {
    id: Date.now(),
    date: req.body.date || new Date().toISOString().slice(0, 10),
    time: req.body.time || new Date().toLocaleTimeString('es-ES'),
    type: req.body.type || 'entrada',
    employee: req.body.employee || db.company?.legalName || "Empleado",
    notes: req.body.notes || ""
  };
  db.timeTracking.unshift(record);
  saveDb(db);
  res.json({ ok: true, record });
});

// 9. Fiscal Reports (Resumen Trimestral IVA 303 / IRPF 130)
app.get('/api/reports/fiscal', (req, res) => {
  const db = loadDb();
  const year = req.query.year || new Date().getFullYear().toString();
  const quarter = req.query.quarter ? parseInt(req.query.quarter, 10) : Math.ceil((new Date().getMonth() + 1) / 3);

  const qMonths = {
    1: ['01', '02', '03'],
    2: ['04', '05', '06'],
    3: ['07', '08', '09'],
    4: ['10', '11', '12']
  }[quarter] || ['10', '11', '12'];

  const invoices = (db.invoices || []).filter(i => {
    if (!i.date) return false;
    const [y, m] = i.date.split('-');
    return y === year && qMonths.includes(m);
  });

  const purchases = (db.purchases || []).filter(p => {
    if (!p.date) return false;
    const [y, m] = p.date.split('-');
    return y === year && qMonths.includes(m);
  });

  const salesBase = invoices.reduce((acc, i) => acc + (Number(i.baseAmount) || 0), 0);
  const salesIvaRepercutido = invoices.reduce((acc, i) => acc + (Number(i.taxAmount) || 0), 0);
  const salesIrpfRetenido = invoices.reduce((acc, i) => acc + (Number(i.incomeTaxAmount) || 0), 0);

  const purchasesBase = purchases.reduce((acc, p) => acc + (Number(p.baseAmount) || 0), 0);
  const purchasesIvaSoportado = purchases.reduce((acc, p) => acc + (Number(p.taxAmount) || 0), 0);

  const resultadoIva = salesIvaRepercutido - purchasesIvaSoportado;
  const rendimientoNeto = salesBase - purchasesBase;

  res.json({
    year,
    quarter,
    salesBase,
    salesIvaRepercutido,
    salesIrpfRetenido,
    purchasesBase,
    purchasesIvaSoportado,
    resultadoIva,
    rendimientoNeto,
    invoicesCount: invoices.length,
    purchasesCount: purchases.length
  });
});

// 10. Settings & Company Profile & Auth Updates
app.get('/api/settings', (req, res) => {
  const db = loadDb();
  res.json({
    company: db.company || {},
    settings: db.settings || {},
    auth: { username: req.user?.email || "usuario@gestifactu.com" }
  });
});

app.put('/api/settings', (req, res) => {
  const db = loadDb();
  if (req.body.company) db.company = { ...db.company, ...req.body.company };
  if (req.body.settings) db.settings = { ...db.settings, ...req.body.settings };
  if (req.body.auth) {
    if (req.body.auth.password) {
      const accounts = loadAccounts();
      const acc = accounts.find(a => a.id === req.userId);
      if (acc) {
        const { hash, salt } = hashPassword(req.body.auth.password);
        acc.passwordHash = hash;
        acc.salt = salt;
        saveAccounts(accounts);
      }
    }
  }
  saveDb(db);
  res.json({ ok: true, company: db.company, settings: db.settings, auth: { username: req.user?.email } });
});

// 11. Backup & Restore
app.get('/api/backup/export', (req, res) => {
  const db = loadDb();
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `gestifactu-backup-${dateStr}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(JSON.stringify(db, null, 2));
});

app.post('/api/backup/import', (req, res) => {
  try {
    const backupData = req.body;
    if (!backupData || typeof backupData !== 'object') {
      return res.status(400).json({ error: "Formato de archivo de copia de seguridad no válido" });
    }
    // Crear copia de seguridad preventiva antes de sobreescribir
    if (fs.existsSync(DB_FILE)) {
      const backupOld = `${DB_FILE}.pre-restore-${Date.now()}.bak`;
      fs.copyFileSync(DB_FILE, backupOld);
    }
    // Asegurar estructura mínima
    const restoredDb = {
      company: backupData.company || {},
      auth: backupData.auth || { username: "admin@gestifactu.com", password: "admin" },
      invoices: backupData.invoices || [],
      budgets: backupData.budgets || [],
      deliveryNotes: backupData.deliveryNotes || [],
      purchases: backupData.purchases || [],
      contacts: backupData.contacts || [],
      products: backupData.products || [],
      deals: backupData.deals || [],
      timeTracking: backupData.timeTracking || [],
      settings: backupData.settings || {}
    };
    saveDb(restoredDb);
    res.json({ ok: true, message: "Copia de seguridad restaurada correctamente" });
  } catch (err) {
    console.error("Error al restaurar backup:", err);
    res.status(500).json({ error: "Error interno al restaurar la copia de seguridad" });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[GestiFactu Pro Multi-User] Servidor ejecutándose en http://0.0.0.0:${PORT}`);
  console.log(`[GestiFactu Pro Multi-User] Datos de usuarios en: ${USERS_DIR}`);
});
