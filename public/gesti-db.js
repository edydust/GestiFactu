/**
 * GestiFactu Local SQLite & Offline Database Controller
 * Works seamlessly with Android Native SQLite Bridge (AndroidBridge)
 * and falls back to Web LocalStorage/IndexedDB for browser testing.
 */

const GestiDb = (function() {
  const isAndroid = typeof window.AndroidBridge !== 'undefined';

  // Low-level query execution
  function query(sql, params = []) {
    if (isAndroid) {
      try {
        const json = window.AndroidBridge.querySql(sql, JSON.stringify(params));
        return JSON.parse(json);
      } catch (e) {
        console.error("SQL Query Error:", e, sql);
        return [];
      }
    } else {
      return webFallbackQuery(sql, params);
    }
  }

  function execute(sql, params = []) {
    if (isAndroid) {
      try {
        const json = window.AndroidBridge.executeSql(sql, JSON.stringify(params));
        return JSON.parse(json);
      } catch (e) {
        console.error("SQL Execute Error:", e, sql);
        return { ok: false, error: e.message };
      }
    } else {
      return webFallbackExecute(sql, params);
    }
  }

  // Web Fallback Store using localStorage for development/browser preview
  const WEB_KEY = 'gestifactu_deca_local_db';
  function getWebDb() {
    try {
      const s = localStorage.getItem(WEB_KEY);
      if (s) return JSON.parse(s);
    } catch {}
    const initial = {
      company: { legalName: "", tin: "", address: "", city: "", phone: "", email: "", iban: "" },
      settings: { theme: "light", language: "es", defaultPaymentMethod: "Transferencia bancaria", defaultIban: "" },
      invoices: [],
      budgets: [],
      purchases: [],
      contacts: [],
      products: [],
      timetracking: [],
      delivery_notes: []
    };
    localStorage.setItem(WEB_KEY, JSON.stringify(initial));
    return initial;
  }

  function saveWebDb(db) {
    localStorage.setItem(WEB_KEY, JSON.stringify(db));
  }

  function webFallbackQuery(sql, params) {
    const db = getWebDb();
    const lower = sql.toLowerCase().trim();
    if (lower.includes('from config')) {
      const rows = [];
      for (const k of ['company', 'settings']) {
        if (db[k]) rows.push({ key: k, value: JSON.stringify(db[k]) });
      }
      return rows;
    }
    if (lower.includes('from invoices')) {
      return db.invoices.map(i => ({
        ...i,
        client_json: JSON.stringify(i.client || {}),
        items_json: JSON.stringify(i.items || [])
      }));
    }
    if (lower.includes('from budgets')) {
      return db.budgets.map(b => ({
        ...b,
        client_json: JSON.stringify(b.client || {}),
        items_json: JSON.stringify(b.items || [])
      }));
    }
    if (lower.includes('from purchases')) return db.purchases;
    if (lower.includes('from contacts')) return db.contacts;
    if (lower.includes('from products')) return db.products;
    if (lower.includes('from timetracking')) return db.timetracking;
    if (lower.includes('from delivery_notes')) return (db.delivery_notes || []).map(dn => ({
      ...dn,
      client_json: JSON.stringify(dn.client || {}),
      items_json: JSON.stringify(dn.items || [])
    }));
    return [];
  }

  function webFallbackExecute(sql, params) {
    return { ok: true };
  }

  // --- API HIGH LEVEL METHODS ---

  async function getCompany() {
    const rows = query("SELECT value FROM config WHERE key = 'company'");
    if (rows && rows.length > 0 && rows[0].value) {
      try { return JSON.parse(rows[0].value); } catch {}
    }
    return { legalName: "Mi Empresa", tin: "", address: "", city: "", phone: "", email: "", iban: "" };
  }

  async function saveCompany(company) {
    execute("INSERT OR REPLACE INTO config (key, value) VALUES ('company', ?)", [JSON.stringify(company)]);
    if (!isAndroid) {
      const db = getWebDb();
      db.company = company;
      saveWebDb(db);
    }
  }

  async function getSettings() {
    const rows = query("SELECT value FROM config WHERE key = 'settings'");
    if (rows && rows.length > 0 && rows[0].value) {
      try { return JSON.parse(rows[0].value); } catch {}
    }
    return { theme: 'light', language: 'es', defaultPaymentMethod: 'Transferencia bancaria', defaultIban: '' };
  }

  async function saveSettings(settings) {
    execute("INSERT OR REPLACE INTO config (key, value) VALUES ('settings', ?)", [JSON.stringify(settings)]);
    if (!isAndroid) {
      const db = getWebDb();
      db.settings = settings;
      saveWebDb(db);
    }
  }

  // Invoices
  function normalizeInvoice(r) {
    let client = r.client || r.customer || {};
    let items = r.items || r.lines || [];
    if (r.client_json) {
      try { client = JSON.parse(r.client_json || '{}'); } catch {}
    }
    if (r.items_json) {
      try { items = JSON.parse(r.items_json || '[]'); } catch {}
    }
    const baseAmount = Number(r.baseAmount) || 0;
    const ivaAmount = Number(r.ivaAmount !== undefined ? r.ivaAmount : r.taxAmount) || 0;
    const irpfAmount = Number(r.irpfAmount !== undefined ? r.irpfAmount : r.incomeTaxAmount) || 0;
    const totalAmount = Number(r.totalAmount) || 0;
    const irpfPercent = Number(r.irpfPercent !== undefined ? r.irpfPercent : r.incomeTaxPercentage) || 0;
    let taxPercentage = r.taxPercentage !== undefined ? Number(r.taxPercentage) : (baseAmount > 0 ? Math.round((ivaAmount / baseAmount) * 100) : 21);

    return {
      ...r,
      client,
      customer: client,
      items,
      lines: items,
      baseAmount,
      ivaAmount,
      taxAmount: ivaAmount,
      taxPercentage,
      irpfAmount,
      incomeTaxAmount: irpfAmount,
      irpfPercent,
      incomeTaxPercentage: irpfPercent,
      totalAmount,
      isRecurring: Boolean(Number(r.isRecurring) || r.isRecurring === true)
    };
  }

  async function getInvoices() {
    const rows = query("SELECT * FROM invoices ORDER BY date DESC, id DESC");
    return (rows || []).map(normalizeInvoice);
  }

  async function getNextInvoiceNumber() {
    const currentYear = new Date().getFullYear().toString();
    const yearSuffix = currentYear.slice(-2);
    const prefix = `1-${yearSuffix}-`;
    const rows = query("SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC", [`${prefix}%`]);
    let maxSeq = 0;
    (rows || []).forEach(r => {
      if (r.number && r.number.startsWith(prefix)) {
        const num = parseInt(r.number.replace(prefix, ''), 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    });
    const nextSeq = maxSeq + 1;
    return `${prefix}${nextSeq.toString().padStart(6, '0')}`;
  }

  async function saveInvoice(invInput) {
    let existing = null;
    if (invInput.id) {
      const existingRows = query("SELECT * FROM invoices WHERE id = ?", [String(invInput.id)]);
      if (existingRows && existingRows.length > 0) {
        existing = normalizeInvoice(existingRows[0]);
      } else if (!isAndroid) {
        const db = getWebDb();
        const found = db.invoices.find(i => String(i.id) === String(invInput.id));
        if (found) existing = normalizeInvoice(found);
      }
    }
    const inv = existing ? { ...existing, ...invInput } : invInput;
    const id = String(inv.id || ('inv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)));
    const number = inv.number || await getNextInvoiceNumber();
    const clientObj = invInput.customer || invInput.client || (existing ? existing.client : {}) || {};
    const itemsArr = invInput.lines || invInput.items || (existing ? existing.items : []) || [];
    const clientJson = JSON.stringify(clientObj);
    const itemsJson = JSON.stringify(itemsArr);

    const baseAmount = Number(inv.baseAmount) || 0;
    const ivaAmount = Number(invInput.taxAmount !== undefined ? invInput.taxAmount : (invInput.ivaAmount !== undefined ? invInput.ivaAmount : inv.ivaAmount)) || 0;
    const irpfAmount = Number(invInput.incomeTaxAmount !== undefined ? invInput.incomeTaxAmount : (invInput.irpfAmount !== undefined ? invInput.irpfAmount : inv.irpfAmount)) || 0;
    const totalAmount = Number(inv.totalAmount) || 0;
    const irpfPercent = Number(invInput.incomeTaxPercentage !== undefined ? invInput.incomeTaxPercentage : (invInput.irpfPercent !== undefined ? invInput.irpfPercent : inv.irpfPercent)) || 0;

    execute("INSERT OR REPLACE INTO invoices (id, number, date, dueDate, status, client_json, items_json, baseAmount, ivaAmount, irpfAmount, totalAmount, irpfPercent, paymentMethod, notes, originBudgetId, originBudgetNumber, createdAt, isRecurring, recurrenceFrequency, nextRecurrenceDate, template, accentColor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      id,
      number,
      inv.date || new Date().toISOString().slice(0, 10),
      inv.dueDate || '',
      inv.status || 'emitida',
      clientJson,
      itemsJson,
      baseAmount,
      ivaAmount,
      irpfAmount,
      totalAmount,
      irpfPercent,
      inv.paymentMethod || 'Transferencia bancaria',
      inv.notes || '',
      inv.originBudgetId || null,
      inv.originBudgetNumber || null,
      inv.createdAt || new Date().toISOString(),
      inv.isRecurring ? 1 : 0,
      inv.recurrenceFrequency || 'mensual',
      inv.nextRecurrenceDate || '',
      inv.template || 'modern',
      inv.accentColor || '#1E40AF'
    ]);

    const normalized = normalizeInvoice({
      ...inv,
      id,
      number,
      client: clientObj,
      items: itemsArr,
      baseAmount,
      ivaAmount,
      irpfAmount,
      totalAmount,
      irpfPercent
    });

    if (!isAndroid) {
      const db = getWebDb();
      const idx = db.invoices.findIndex(i => String(i.id) === String(id));
      if (idx >= 0) db.invoices[idx] = normalized; else db.invoices.unshift(normalized);
      saveWebDb(db);
    }

    return { ok: true, ...normalized };
  }

  async function deleteInvoice(id) {
    execute("DELETE FROM invoices WHERE id = ?", [String(id)]);
    if (!isAndroid) {
      const db = getWebDb();
      db.invoices = db.invoices.filter(i => String(i.id) !== String(id));
      saveWebDb(db);
    }
  }

  // Budgets
  function normalizeBudget(r) {
    let client = r.client || r.customer || {};
    let items = r.items || r.lines || [];
    if (r.client_json) {
      try { client = JSON.parse(r.client_json || '{}'); } catch {}
    }
    if (r.items_json) {
      try { items = JSON.parse(r.items_json || '[]'); } catch {}
    }
    const baseAmount = Number(r.baseAmount) || 0;
    const ivaAmount = Number(r.ivaAmount !== undefined ? r.ivaAmount : r.taxAmount) || 0;
    const irpfAmount = Number(r.irpfAmount !== undefined ? r.irpfAmount : r.incomeTaxAmount) || 0;
    const totalAmount = Number(r.totalAmount) || 0;
    const irpfPercent = Number(r.irpfPercent !== undefined ? r.irpfPercent : r.incomeTaxPercentage) || 0;
    const taxPercentage = r.taxPercentage !== undefined ? Number(r.taxPercentage) : (baseAmount > 0 ? Math.round((ivaAmount / baseAmount) * 100) : 21);

    return {
      ...r,
      client,
      customer: client,
      items,
      lines: items,
      baseAmount,
      ivaAmount,
      taxAmount: ivaAmount,
      taxPercentage,
      irpfAmount,
      incomeTaxAmount: irpfAmount,
      irpfPercent,
      incomeTaxPercentage: irpfPercent,
      totalAmount
    };
  }

  async function getBudgets() {
    const rows = query("SELECT * FROM budgets ORDER BY date DESC, id DESC");
    return (rows || []).map(normalizeBudget);
  }

  async function getNextBudgetNumber() {
    const currentYear = new Date().getFullYear().toString();
    const yearSuffix = currentYear.slice(-2);
    const prefix = `P-${yearSuffix}-`;
    const rows = query("SELECT number FROM budgets WHERE number LIKE ? ORDER BY number DESC", [`${prefix}%`]);
    let maxSeq = 0;
    (rows || []).forEach(r => {
      if (r.number && r.number.startsWith(prefix)) {
        const num = parseInt(r.number.replace(prefix, ''), 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    });
    const nextSeq = maxSeq + 1;
    return `${prefix}${nextSeq.toString().padStart(6, '0')}`;
  }

  async function saveBudget(budgetInput) {
    let existing = null;
    if (budgetInput.id) {
      const existingRows = query("SELECT * FROM budgets WHERE id = ?", [String(budgetInput.id)]);
      if (existingRows && existingRows.length > 0) {
        existing = normalizeBudget(existingRows[0]);
      } else if (!isAndroid) {
        const db = getWebDb();
        const found = db.budgets.find(b => String(b.id) === String(budgetInput.id));
        if (found) existing = normalizeBudget(found);
      }
    }
    const budget = existing ? { ...existing, ...budgetInput } : budgetInput;
    const id = String(budget.id || ('bud_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)));
    const number = budget.number || await getNextBudgetNumber();
    let invoiceNumber = budget.invoiceNumber || null;
    let invoiceId = budget.invoiceId || null;

    const clientObj = budgetInput.customer || budgetInput.client || (existing ? existing.client : {}) || {};
    const itemsArr = budgetInput.lines || budgetInput.items || (existing ? existing.items : []) || [];
    const baseAmount = Number(budget.baseAmount) || 0;
    const ivaAmount = Number(budgetInput.taxAmount !== undefined ? budgetInput.taxAmount : (budgetInput.ivaAmount !== undefined ? budgetInput.ivaAmount : budget.ivaAmount)) || 0;
    const irpfAmount = Number(budgetInput.incomeTaxAmount !== undefined ? budgetInput.incomeTaxAmount : (budgetInput.irpfAmount !== undefined ? budgetInput.irpfAmount : budget.irpfAmount)) || 0;
    const totalAmount = Number(budget.totalAmount) || 0;
    const irpfPercent = Number(budgetInput.incomeTaxPercentage !== undefined ? budgetInput.incomeTaxPercentage : (budgetInput.irpfPercent !== undefined ? budgetInput.irpfPercent : budget.irpfPercent)) || 0;

    // Auto-create invoice if status is "facturado"
    if (budget.status === 'facturado' && !invoiceNumber) {
      const newInv = await saveInvoice({
        originBudgetId: id,
        originBudgetNumber: number,
        client: clientObj,
        items: itemsArr,
        baseAmount,
        ivaAmount,
        irpfAmount,
        totalAmount,
        irpfPercent,
        paymentMethod: budget.paymentMethod,
        notes: `Factura procedente del Presupuesto ${number}`
      });
      invoiceNumber = newInv.number;
      invoiceId = newInv.id;
    }

    const clientJson = JSON.stringify(clientObj);
    const itemsJson = JSON.stringify(itemsArr);

    execute("INSERT OR REPLACE INTO budgets (id, number, date, validUntil, status, client_json, items_json, baseAmount, ivaAmount, irpfAmount, totalAmount, irpfPercent, paymentMethod, notes, invoiceNumber, invoiceId, signature, signedAt, signedByName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      id,
      number,
      budget.date || new Date().toISOString().slice(0, 10),
      budget.validUntil || '',
      budget.status || 'borrador',
      clientJson,
      itemsJson,
      baseAmount,
      ivaAmount,
      irpfAmount,
      totalAmount,
      irpfPercent,
      budget.paymentMethod || 'Transferencia bancaria',
      budget.notes || '',
      invoiceNumber,
      invoiceId,
      budget.signature || null,
      budget.signedAt || null,
      budget.signedByName || null,
      budget.createdAt || new Date().toISOString()
    ]);

    const normalized = normalizeBudget({
      ...budget,
      id,
      number,
      client: clientObj,
      items: itemsArr,
      baseAmount,
      ivaAmount,
      irpfAmount,
      totalAmount,
      irpfPercent,
      invoiceNumber,
      invoiceId
    });

    if (!isAndroid) {
      const db = getWebDb();
      const idx = db.budgets.findIndex(b => String(b.id) === String(id));
      if (idx >= 0) db.budgets[idx] = normalized; else db.budgets.unshift(normalized);
      saveWebDb(db);
    }

    return { ok: true, ...normalized };
  }

  async function deleteBudget(id) {
    execute("DELETE FROM budgets WHERE id = ?", [String(id)]);
    if (!isAndroid) {
      const db = getWebDb();
      db.budgets = db.budgets.filter(b => String(b.id) !== String(id));
      saveWebDb(db);
    }
  }

  // Purchases / Expenses
  function normalizePurchase(r) {
    let attachment = r.attachment || null;
    if (!attachment && r.receiptImage) {
      try {
        if (r.receiptImage.trim().startsWith('{')) {
          attachment = JSON.parse(r.receiptImage);
        } else {
          attachment = { name: 'Ticket.jpg', type: 'image/jpeg', data: r.receiptImage };
        }
      } catch {
        attachment = { name: 'Ticket.jpg', type: 'image/jpeg', data: r.receiptImage };
      }
    }
    const baseAmount = Number(r.baseAmount) || 0;
    const ivaAmount = Number(r.ivaAmount !== undefined ? r.ivaAmount : r.taxAmount) || 0;
    const ivaPercent = Number(r.ivaPercent !== undefined ? r.ivaPercent : r.taxPercentage) || 21;
    const totalAmount = Number(r.totalAmount) || 0;
    const concept = r.concept !== undefined ? r.concept : (r.notes || '');
    return {
      ...r,
      concept,
      notes: concept,
      baseAmount,
      ivaAmount,
      taxAmount: ivaAmount,
      ivaPercent,
      taxPercentage: ivaPercent,
      totalAmount,
      status: r.status || 'pagado',
      attachment,
      receiptImage: attachment ? (attachment.data || '') : (r.receiptImage || '')
    };
  }

  async function getPurchases() {
    const rows = query("SELECT * FROM purchases ORDER BY date DESC, id DESC");
    return (rows || []).map(normalizePurchase);
  }

  async function savePurchase(p) {
    const id = String(p.id || ('pur_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)));
    const baseAmount = Number(p.baseAmount) || 0;
    const ivaAmount = Number(p.taxAmount !== undefined ? p.taxAmount : p.ivaAmount) || 0;
    const totalAmount = Number(p.totalAmount) || 0;
    const ivaPercent = Number(p.taxPercentage !== undefined ? p.taxPercentage : p.ivaPercent) || 21;
    const concept = p.concept !== undefined ? p.concept : (p.notes || '');
    const receiptStr = p.attachment ? JSON.stringify(p.attachment) : (p.receiptImage || '');

    execute("INSERT OR REPLACE INTO purchases (id, number, date, supplier, cif, category, baseAmount, ivaAmount, totalAmount, ivaPercent, paymentMethod, notes, receiptImage, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      id,
      p.number || '',
      p.date || new Date().toISOString().slice(0, 10),
      p.supplier || '',
      p.cif || '',
      p.category || 'General',
      baseAmount,
      ivaAmount,
      totalAmount,
      ivaPercent,
      p.paymentMethod || 'Tarjeta',
      concept,
      receiptStr,
      p.createdAt || new Date().toISOString()
    ]);

    const normalized = normalizePurchase({
      ...p,
      id,
      baseAmount,
      ivaAmount,
      totalAmount,
      ivaPercent,
      notes: concept,
      receiptImage: receiptStr
    });

    if (!isAndroid) {
      const db = getWebDb();
      const idx = db.purchases.findIndex(x => String(x.id) === String(id));
      if (idx >= 0) db.purchases[idx] = normalized; else db.purchases.unshift(normalized);
      saveWebDb(db);
    }

    return { ok: true, ...normalized };
  }

  async function deletePurchase(id) {
    execute("DELETE FROM purchases WHERE id = ?", [String(id)]);
    if (!isAndroid) {
      const db = getWebDb();
      db.purchases = db.purchases.filter(p => String(p.id) !== String(id));
      saveWebDb(db);
    }
  }

  // Contacts
  function normalizeContact(r) {
    const legalName = r.legalName || r.name || '';
    const tin = r.tin || r.nif || '';
    let paymentMethod = r.paymentMethod || 'Transferencia bancaria';
    let notes = r.notes || '';
    if (notes && notes.startsWith('{')) {
      try {
        const meta = JSON.parse(notes);
        if (meta.paymentMethod) paymentMethod = meta.paymentMethod;
        notes = meta.notes || '';
      } catch {}
    }
    return {
      ...r,
      name: legalName,
      legalName,
      nif: tin,
      tin,
      paymentMethod,
      notes
    };
  }

  async function getContacts() {
    const rows = query("SELECT * FROM contacts ORDER BY name ASC");
    return (rows || []).map(normalizeContact);
  }

  async function saveContact(c) {
    const id = String(c.id || ('cont_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)));
    const name = c.legalName || c.name || '';
    const nif = c.tin || c.nif || '';
    const paymentMethod = c.paymentMethod || 'Transferencia bancaria';
    const metaNotes = JSON.stringify({ paymentMethod, notes: c.notes || '' });

    execute("INSERT OR REPLACE INTO contacts (id, name, nif, type, email, phone, address, city, postcode, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      id,
      name,
      nif,
      c.type || 'cliente',
      c.email || '',
      c.phone || '',
      c.address || '',
      c.city || '',
      c.postcode || '',
      metaNotes
    ]);

    const normalized = normalizeContact({
      ...c,
      id,
      name,
      nif,
      notes: metaNotes
    });

    if (!isAndroid) {
      const db = getWebDb();
      const idx = db.contacts.findIndex(x => String(x.id) === String(id));
      if (idx >= 0) db.contacts[idx] = normalized; else db.contacts.push(normalized);
      saveWebDb(db);
    }

    return { ok: true, ...normalized };
  }

  async function deleteContact(id) {
    execute("DELETE FROM contacts WHERE id = ?", [String(id)]);
    if (!isAndroid) {
      const db = getWebDb();
      db.contacts = db.contacts.filter(c => String(c.id) !== String(id));
      saveWebDb(db);
    }
  }

  // Products
  function normalizeProduct(r) {
    const code = r.code || r.reference || '';
    const taxPercentage = Number(r.taxPercentage !== undefined ? r.taxPercentage : r.ivaPercent) || 21;
    let type = r.type || 'servicio';
    let incomeTaxPercentage = Number(r.incomeTaxPercentage) || 0;
    let description = r.description || '';
    if (description && description.startsWith('{')) {
      try {
        const meta = JSON.parse(description);
        if (meta.type) type = meta.type;
        if (meta.incomeTaxPercentage !== undefined) incomeTaxPercentage = Number(meta.incomeTaxPercentage) || 0;
        description = meta.description || '';
      } catch {}
    }
    return {
      ...r,
      code,
      reference: code,
      type,
      price: Number(r.price) || 0,
      ivaPercent: taxPercentage,
      taxPercentage,
      incomeTaxPercentage,
      description
    };
  }

  async function getProducts() {
    const rows = query("SELECT * FROM products ORDER BY name ASC");
    return (rows || []).map(normalizeProduct);
  }

  async function saveProduct(p) {
    const id = String(p.id || ('prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)));
    const reference = p.code || p.reference || '';
    const ivaPercent = Number(p.taxPercentage !== undefined ? p.taxPercentage : p.ivaPercent) || 21;
    const type = p.type || 'servicio';
    const incomeTaxPercentage = Number(p.incomeTaxPercentage) || 0;
    const metaDesc = JSON.stringify({ type, incomeTaxPercentage, description: p.description || '' });

    execute("INSERT OR REPLACE INTO products (id, name, reference, price, ivaPercent, description) VALUES (?, ?, ?, ?, ?, ?)", [
      id,
      p.name || '',
      reference,
      Number(p.price) || 0,
      ivaPercent,
      metaDesc
    ]);

    const normalized = normalizeProduct({
      ...p,
      id,
      reference,
      ivaPercent,
      description: metaDesc
    });

    if (!isAndroid) {
      const db = getWebDb();
      const idx = db.products.findIndex(x => String(x.id) === String(id));
      if (idx >= 0) db.products[idx] = normalized; else db.products.push(normalized);
      saveWebDb(db);
    }

    return { ok: true, ...normalized };
  }

  async function deleteProduct(id) {
    execute("DELETE FROM products WHERE id = ?", [String(id)]);
    if (!isAndroid) {
      const db = getWebDb();
      db.products = db.products.filter(p => String(p.id) !== String(id));
      saveWebDb(db);
    }
  }

  // Time Tracking
  function normalizeTimeTracking(r) {
    const ts = r.timestamp || new Date().toISOString();
    let date = r.date || ts.slice(0, 10);
    let time = r.time || (ts.includes('T') ? ts.slice(11, 16) : ts);
    let employee = r.employee || 'Usuario Principal';
    let notes = r.notes || '';
    if (notes && notes.startsWith('{')) {
      try {
        const meta = JSON.parse(notes);
        if (meta.date) date = meta.date;
        if (meta.time) time = meta.time;
        if (meta.employee) employee = meta.employee;
        notes = meta.notes || '';
      } catch {}
    }
    return {
      ...r,
      date,
      time,
      employee,
      notes,
      timestamp: ts
    };
  }

  async function getTimeTracking() {
    const rows = query("SELECT * FROM timetracking ORDER BY timestamp DESC");
    return (rows || []).map(normalizeTimeTracking);
  }

  async function saveTimeTracking(entry) {
    const id = String(entry.id || ('tt_' + Date.now()));
    const nowIso = new Date().toISOString();
    const date = entry.date || nowIso.slice(0, 10);
    const time = entry.time || new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const employee = entry.employee || 'Usuario Principal';
    const timestamp = entry.timestamp || `${date}T${time}:00`;
    const metaNotes = JSON.stringify({ date, time, employee, notes: entry.notes || '' });

    execute("INSERT OR REPLACE INTO timetracking (id, type, timestamp, notes) VALUES (?, ?, ?, ?)", [
      id,
      entry.type || 'entrada',
      timestamp,
      metaNotes
    ]);

    const normalized = normalizeTimeTracking({
      ...entry,
      id,
      timestamp,
      notes: metaNotes
    });

    if (!isAndroid) {
      const db = getWebDb();
      db.timetracking.unshift(normalized);
      saveWebDb(db);
    }

    return { ok: true, ...normalized };
  }

  
  // Delivery Notes (Albaranes & Partes de Trabajo)
  async function getDeliveryNotes() {
    const rows = query("SELECT * FROM delivery_notes ORDER BY date DESC, id DESC");
    return rows.map(r => {
      let client = {};
      let items = [];
      try { client = JSON.parse(r.client_json || '{}'); } catch {}
      try { items = JSON.parse(r.items_json || '[]'); } catch {}
      return {
        ...r,
        client,
        items
      };
    });
  }

  async function getNextDeliveryNoteNumber() {
    const currentYear = new Date().getFullYear().toString();
    const yearSuffix = currentYear.slice(-2);
    const prefix = `ALB-${yearSuffix}-`;
    const rows = query("SELECT number FROM delivery_notes WHERE number LIKE ? ORDER BY number DESC", [`${prefix}%`]);
    let maxSeq = 0;
    (rows || []).forEach(r => {
      if (r.number && r.number.startsWith(prefix)) {
        const num = parseInt(r.number.replace(prefix, ''), 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    });
    const nextSeq = maxSeq + 1;
    return `${prefix}${nextSeq.toString().padStart(6, '0')}`;
  }

  async function saveDeliveryNote(dn) {
    const id = dn.id || 'dn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const number = dn.number || await getNextDeliveryNoteNumber();
    const clientJson = JSON.stringify(dn.client || {});
    const itemsJson = JSON.stringify(dn.items || []);

    execute("INSERT OR REPLACE INTO delivery_notes (id, number, date, status, client_json, items_json, notes, signature, signedAt, signedByName, invoiceId, invoiceNumber, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      id,
      number,
      dn.date || new Date().toISOString().slice(0, 10),
      dn.status || 'pendiente',
      clientJson,
      itemsJson,
      dn.notes || '',
      dn.signature || null,
      dn.signedAt || null,
      dn.signedByName || null,
      dn.invoiceId || null,
      dn.invoiceNumber || null,
      dn.createdAt || new Date().toISOString()
    ]);

    if (!isAndroid) {
      const db = getWebDb();
      if (!db.delivery_notes) db.delivery_notes = [];
      const idx = db.delivery_notes.findIndex(i => i.id === id);
      const full = { ...dn, id, number, client: dn.client || {}, items: dn.items || [] };
      if (idx >= 0) db.delivery_notes[idx] = full; else db.delivery_notes.unshift(full);
      saveWebDb(db);
    }

    return { ...dn, id, number };
  }

  async function deleteDeliveryNote(id) {
    execute("DELETE FROM delivery_notes WHERE id = ?", [id]);
    if (!isAndroid) {
      const db = getWebDb();
      if (db.delivery_notes) {
        db.delivery_notes = db.delivery_notes.filter(i => i.id !== id);
        saveWebDb(db);
      }
    }
  }

  // Dashboard calculations
  async function getDashboard() {
    const invoices = await getInvoices();
    const purchases = await getPurchases();

    const currentYear = new Date().getFullYear().toString();
    const currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const yearPrefix = currentYear.slice(-2);

    const yearInvoices = invoices.filter(i => (i.date && i.date.startsWith(currentYear)) || (i.number && i.number.includes(`-${yearPrefix}-`)));
    const totalSalesYear = yearInvoices.reduce((acc, i) => acc + (Number(i.baseAmount) || 0), 0);
    const totalSalesPending = invoices.filter(i => i.status !== 'cobrada').reduce((acc, i) => acc + (Number(i.totalAmount) || 0), 0);

    const monthInvoices = invoices.filter(i => i.date && i.date.startsWith(`${currentYear}-${currentMonth}`));
    const totalSalesMonth = monthInvoices.reduce((acc, i) => acc + (Number(i.baseAmount) || 0), 0);

    const yearPurchases = purchases.filter(p => p.date && p.date.startsWith(currentYear));
    const totalPurchasesYear = yearPurchases.reduce((acc, p) => acc + (Number(p.baseAmount) || 0), 0);

    const monthPurchases = purchases.filter(p => p.date && p.date.startsWith(`${currentYear}-${currentMonth}`));
    const totalPurchasesMonth = monthPurchases.reduce((acc, p) => acc + (Number(p.baseAmount) || 0), 0);

    // Sales by month chart data
    const monthlySales = Array(12).fill(0);
    yearInvoices.forEach(i => {
      if (i.date) {
        const m = parseInt(i.date.split('-')[1], 10) - 1;
        if (m >= 0 && m < 12) monthlySales[m] += Number(i.baseAmount) || 0;
      }
    });

    // Calculate 6-month trend (Income vs Expenses vs Profit)
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const now = new Date();
    const last6Months = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      const yStr = d.getFullYear().toString();
      const mStr = (d.getMonth() + 1).toString().padStart(2, '0');
      const prefix = `${yStr}-${mStr}`;
      const mIncome = invoices
        .filter(i => i.date && i.date.startsWith(prefix))
        .reduce((sum, i) => sum + (Number(i.baseAmount) || 0), 0);
      const mExpense = purchases
        .filter(p => p.date && p.date.startsWith(prefix))
        .reduce((sum, p) => sum + (Number(p.baseAmount) || 0), 0);
      last6Months.push({
        key: prefix,
        label: `${monthNames[d.getMonth()]} ${yStr.slice(-2)}`,
        income: mIncome,
        expense: mExpense,
        profit: mIncome - mExpense
      });
    }

    return {
      totalSalesYear,
      totalSalesMonth,
      totalSalesPending,
      totalPurchasesYear,
      totalPurchasesMonth,
      monthlySales,
      last6Months,
      recentInvoices: invoices.slice(0, 5),
      recentPurchases: purchases.slice(0, 5)
    };
  }

  // Tax Summary (Modelos 303 & 130)
  async function getTaxSummary(year) {
    const invoices = await getInvoices();
    const purchases = await getPurchases();
    const currentYear = year || new Date().getFullYear().toString();

    const yearInvoices = invoices.filter(i => i.date && i.date.startsWith(currentYear));
    const yearPurchases = purchases.filter(p => p.date && p.date.startsWith(currentYear));

    const salesBase = yearInvoices.reduce((acc, i) => acc + (Number(i.baseAmount) || 0), 0);
    const salesIvaDevengado = yearInvoices.reduce((acc, i) => acc + (Number(i.ivaAmount) || 0), 0);
    const salesIrpfRetenido = yearInvoices.reduce((acc, i) => acc + (Number(i.irpfAmount) || 0), 0);

    const purchasesBase = yearPurchases.reduce((acc, p) => acc + (Number(p.baseAmount) || 0), 0);
    const purchasesIvaSoportado = yearPurchases.reduce((acc, p) => acc + (Number(p.ivaAmount) || 0), 0);

    const resultadoIva = salesIvaDevengado - purchasesIvaSoportado;
    const rendimientoNeto = salesBase - purchasesBase;

    return {
      year: currentYear,
      salesBase,
      salesIvaDevengado,
      salesIrpfRetenido,
      purchasesBase,
      purchasesIvaSoportado,
      resultadoIva,
      rendimientoNeto,
      invoicesCount: yearInvoices.length,
      purchasesCount: yearPurchases.length
    };
  }

  // DeCA SQLite Persistence Helpers
  const DECA_KEYS = ['deca_docs', 'deca_clientes', 'deca_config_fija', 'deca_facturas_verifactu'];

  function getDecaKey(key, fallback = null) {
    if (isAndroid) {
      const rows = query("SELECT value FROM config WHERE key = ?", [key]);
      if (rows && rows.length > 0 && rows[0].value) {
        try {
          const parsed = JSON.parse(rows[0].value);
          localStorage.setItem(key, rows[0].value);
          return parsed;
        } catch {}
      }
    }
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch {}
    return fallback;
  }

  function saveDecaKey(key, valueObj) {
    const jsonStr = typeof valueObj === 'string' ? valueObj : JSON.stringify(valueObj);
    localStorage.setItem(key, jsonStr);
    if (isAndroid) {
      execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, jsonStr]);
    }
  }

  const origSetItem = Storage.prototype.setItem;

  function syncDecaStorageOnBoot() {
    for (const key of DECA_KEYS) {
      if (isAndroid) {
        const rows = query("SELECT value FROM config WHERE key = ?", [key]);
        if (rows && rows.length > 0 && rows[0].value) {
          origSetItem.call(localStorage, key, rows[0].value);
        } else {
          const localVal = localStorage.getItem(key);
          if (localVal) {
            execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, localVal]);
          }
        }
      }
    }
  }

  // Automatically mirror any localStorage.setItem('deca_*') into native SQLite
  Storage.prototype.setItem = function(key, value) {
    origSetItem.call(this, key, value);
    if (this === window.localStorage && isAndroid && DECA_KEYS.includes(key)) {
      try {
        execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, String(value)]);
      } catch (e) {
        console.error("Error syncing DeCA key to SQLite:", key, e);
      }
    }
  };

  syncDecaStorageOnBoot();

  // Backup Export/Import
  async function exportAllData() {
    return {
      app: "GestiFactu+DeCA",
      version: "1.5",
      company: await getCompany(),
      settings: await getSettings(),
      invoices: await getInvoices(),
      budgets: await getBudgets(),
      purchases: await getPurchases(),
      contacts: await getContacts(),
      products: await getProducts(),
      timetracking: await getTimeTracking(),
      deliveryNotes: await getDeliveryNotes(),
      deca_docs: getDecaKey('deca_docs', []),
      deca_clientes: getDecaKey('deca_clientes', []),
      deca_config_fija: getDecaKey('deca_config_fija', null),
      deca_facturas_verifactu: getDecaKey('deca_facturas_verifactu', []),
      exportedAt: new Date().toISOString()
    };
  }

  async function importAllData(data) {
    if (!data) return false;
    if (data.company) await saveCompany(data.company);
    if (data.settings) await saveSettings(data.settings);
    if (Array.isArray(data.invoices)) {
      for (const inv of data.invoices) await saveInvoice(inv);
    }
    if (Array.isArray(data.budgets)) {
      for (const b of data.budgets) await saveBudget(b);
    }
    if (Array.isArray(data.purchases)) {
      for (const p of data.purchases) await savePurchase(p);
    }
    if (Array.isArray(data.contacts)) {
      for (const c of data.contacts) await saveContact(c);
    }
    if (Array.isArray(data.deliveryNotes)) {
      for (const dn of data.deliveryNotes) await saveDeliveryNote(dn);
    }
    if (Array.isArray(data.products)) {
      for (const pr of data.products) await saveProduct(pr);
    }
    // Support both unified GestiFactu+DeCA backup keys and legacy DeCA backup keys
    if (Array.isArray(data.deca_docs)) saveDecaKey('deca_docs', data.deca_docs);
    else if (Array.isArray(data.documentos)) saveDecaKey('deca_docs', data.documentos);

    if (Array.isArray(data.deca_clientes)) saveDecaKey('deca_clientes', data.deca_clientes);
    else if (Array.isArray(data.clientesHabituales)) saveDecaKey('deca_clientes', data.clientesHabituales);

    if (data.deca_config_fija) saveDecaKey('deca_config_fija', data.deca_config_fija);
    else if (data.configFija) saveDecaKey('deca_config_fija', data.configFija);

    if (Array.isArray(data.deca_facturas_verifactu)) saveDecaKey('deca_facturas_verifactu', data.deca_facturas_verifactu);
    else if (Array.isArray(data.facturasVerifactu)) saveDecaKey('deca_facturas_verifactu', data.facturasVerifactu);

    return true;
  }

  // Google Drive Native Sync Triggers
  function syncGoogleDrive() {
    if (isAndroid) {
      window.AndroidBridge.syncGoogleDrive();
    } else {
      alert("La sincronización nativa de Google Drive está disponible en la app Android.");
    }
  }

  function restoreGoogleDrive() {
    if (isAndroid) {
      window.AndroidBridge.restoreGoogleDrive();
    } else {
      alert("La restauración nativa de Google Drive está disponible en la app Android.");
    }
  }

  return {
    isAndroid,
    getCompany,
    saveCompany,
    getSettings,
    saveSettings,
    getInvoices,
    saveInvoice,
    deleteInvoice,
    getNextInvoiceNumber,
    getDeliveryNotes,
    saveDeliveryNote,
    deleteDeliveryNote,
    getNextDeliveryNoteNumber,
    getBudgets,
    saveBudget,
    deleteBudget,
    getNextBudgetNumber,
    getPurchases,
    savePurchase,
    deletePurchase,
    getContacts,
    saveContact,
    deleteContact,
    getProducts,
    saveProduct,
    deleteProduct,
    getTimeTracking,
    saveTimeTracking,
    getDashboard,
    getTaxSummary,
    exportAllData,
    importAllData,
    getDecaKey,
    saveDecaKey,
    syncDecaStorageOnBoot,
    syncGoogleDrive,
    restoreGoogleDrive
  };
})();

if (typeof window !== 'undefined') window.GestiDb = GestiDb;
if (typeof module !== 'undefined' && module.exports) module.exports = GestiDb;
